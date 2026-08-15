-- ---------------------------------------------------------------------------
-- DreamDestination — Phase 3: city intelligence
--
-- Additive only. Nothing in the Phase 1 schema is dropped or altered
-- destructively; existing rows, constraints and RLS policies are untouched.
--
-- Why this is needed at all:
--
-- `city_metrics` can hold a normalised 0-1 score per dimension, but it cannot
-- hold (a) the raw measurement behind that score, (b) its unit, or (c) where
-- it came from. Phase 3 requires every displayed number to be traceable to a
-- named dataset, year and unit, so raw observations get their own table and
-- `city_metrics` stays what it always was: a derived snapshot.
--
-- `recommendations` gains an algorithm version so a stored ranking can always
-- be attributed to the scoring model that produced it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- metric_sources — provenance, one row per dataset vintage
-- ---------------------------------------------------------------------------

create table public.metric_sources (
  id uuid primary key default gen_random_uuid(),

  -- Stable identifier used by the ingestion scripts, e.g. `acs-2023-5yr`.
  key text not null unique
    constraint metric_sources_key_format
      check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  organization text not null
    constraint metric_sources_organization_length
      check (char_length(organization) between 1 and 160),
  dataset text not null
    constraint metric_sources_dataset_length
      check (char_length(dataset) between 1 and 200),
  url text not null
    constraint metric_sources_url_format check (url ~ '^https?://'),

  -- Reporting period as published, e.g. `2019-2023` or `1991-2020`. Text
  -- because sources publish ranges, not single years.
  period text not null
    constraint metric_sources_period_length
      check (char_length(period) between 1 and 40),

  -- When we pulled it. Distinct from `period`: a 2023 dataset can be
  -- retrieved in 2026.
  retrieved_on date not null,

  -- Geographic unit the source reports at. Mixing units is a documented
  -- decision, never an accident, so it is recorded per source.
  geography_level text not null
    constraint metric_sources_geography_level_allowed
      check (geography_level in ('cbsa', 'county', 'place', 'state', 'station')),

  notes text
    constraint metric_sources_notes_length check (char_length(notes) <= 2000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.metric_sources is
  'Provenance for city metrics: who published it, which dataset, which period.';

create trigger metric_sources_set_updated_at
  before update on public.metric_sources
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- city_metric_observations — raw measurements, never normalised
-- ---------------------------------------------------------------------------

create table public.city_metric_observations (
  id uuid primary key default gen_random_uuid(),

  city_id uuid not null
    references public.cities (id) on delete cascade,

  -- What was actually measured, e.g. `median_gross_rent`. Names the source
  -- quantity, not the thing we turn it into.
  metric_key text not null
    constraint city_metric_observations_metric_key_format
      check (metric_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),

  -- Which scoring dimension this feeds. Mirrors PREFERENCE_WEIGHT_KEYS in
  -- lib/constants.ts; keep the two in step.
  dimension text not null
    constraint city_metric_observations_dimension_allowed
      check (
        dimension in (
          'career', 'housing', 'cost', 'safety', 'education',
          'social', 'transport', 'climate', 'family', 'healthcare'
        )
      ),

  -- The measurement in its published unit. Deliberately unbounded: rents,
  -- percentages, minutes and degrees all live here, and normalisation happens
  -- in the application, not in storage.
  raw_value numeric not null,

  unit text not null
    constraint city_metric_observations_unit_allowed
      check (
        unit in (
          'usd', 'usd_per_month', 'percent', 'minutes',
          'degrees_fahrenheit', 'count', 'per_100k', 'index'
        )
      ),

  source_id uuid not null
    references public.metric_sources (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One observation per metric per city; re-seeding updates in place.
  constraint city_metric_observations_unique_metric_per_city
    unique (city_id, metric_key)
);

comment on table public.city_metric_observations is
  'Raw, un-normalised city measurements with provenance. Source of truth for scoring.';
comment on column public.city_metric_observations.raw_value is
  'Value in the published unit. Normalisation is applied at scoring time, never stored here.';

create index city_metric_observations_dimension_idx
  on public.city_metric_observations (dimension);
create index city_metric_observations_source_id_idx
  on public.city_metric_observations (source_id);

create trigger city_metric_observations_set_updated_at
  before update on public.city_metric_observations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- recommendations — record which scoring model produced a row
-- ---------------------------------------------------------------------------

alter table public.recommendations
  add column algorithm_version text not null default 'v1'
    constraint recommendations_algorithm_version_format
      check (algorithm_version ~ '^v[0-9]+$');

comment on column public.recommendations.algorithm_version is
  'Scoring model that produced this row, so old rankings stay attributable.';

create index recommendations_algorithm_version_idx
  on public.recommendations (algorithm_version);

-- ---------------------------------------------------------------------------
-- Atomic replacement of a profile's recommendation set
--
-- `recommendations` carries unique (profile_id, rank) and
-- (profile_id, city_id). Regenerating by deleting and re-inserting in two
-- round trips would leave a window where a concurrent run sees a half-written
-- set, or collides on those constraints. One function call keeps it atomic.
--
-- SECURITY INVOKER on purpose: this is granted only to service_role, which
-- already bypasses RLS. Making it SECURITY DEFINER would hand out that
-- privilege more widely than necessary.
-- ---------------------------------------------------------------------------

create or replace function public.replace_recommendations(
  p_profile_id uuid,
  p_algorithm_version text,
  p_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array, got %', jsonb_typeof(p_rows);
  end if;

  delete from public.recommendations where profile_id = p_profile_id;

  insert into public.recommendations (
    profile_id, city_id, dream_score, "rank", reason_json, algorithm_version
  )
  select
    p_profile_id,
    (row_data->>'city_id')::uuid,
    (row_data->>'dream_score')::numeric,
    (row_data->>'rank')::integer,
    coalesce(row_data->'reason_json', '{}'::jsonb),
    p_algorithm_version
  from jsonb_array_elements(p_rows) as row_data;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on function public.replace_recommendations(uuid, text, jsonb) is
  'Atomically replaces one profile''s recommendation set. service_role only.';

-- Locked down: users must not be able to author their own rankings.
revoke all on function public.replace_recommendations(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_recommendations(uuid, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
--
-- Same posture as `cities` / `city_metrics`: reference data is world-readable
-- and writable by nobody. Ingestion runs with the service-role key.
-- ---------------------------------------------------------------------------

grant select on public.metric_sources to anon, authenticated;
grant select on public.city_metric_observations to anon, authenticated;
grant all on public.metric_sources to service_role;
grant all on public.city_metric_observations to service_role;

alter table public.metric_sources enable row level security;
alter table public.city_metric_observations enable row level security;

create policy "Metric sources are publicly readable"
  on public.metric_sources for select to anon, authenticated
  using (true);

create policy "City metric observations are publicly readable"
  on public.city_metric_observations for select to anon, authenticated
  using (true);

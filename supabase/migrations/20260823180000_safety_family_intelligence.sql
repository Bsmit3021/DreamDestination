-- ---------------------------------------------------------------------------
-- Phase 6B — Safety + Family Intelligence
--
-- Activates the two priorities onboarding has always collected but nothing
-- could score. Both are metro-level reference data with the same read model as
-- `metro_occupation_stats` and `housing_market_stats`: publicly readable,
-- never user-writable, seeded offline.
--
-- Two tables rather than `city_metric_observations` rows because both
-- dimensions need more than one number per metro, and that table is
-- deliberately one observation per (city, metric_key) with the loader keeping
-- exactly one observation per dimension.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- metro_safety_stats — FBI CIUS Table 6 metropolitan-statistical-area rates
--
-- One row per metro the FBI actually published. A metro absent from Table 6
-- has no row: missing crime data is recorded as absence, never as zero and
-- never as a national average. Rates are the FBI's own published MSA rates,
-- not a sum over police agencies and not a principal city standing in for its
-- metro.
-- ---------------------------------------------------------------------------

create table public.metro_safety_stats (
  id uuid primary key default gen_random_uuid(),

  city_id uuid not null references public.cities (id) on delete cascade,

  -- The name exactly as the FBI printed it, kept so a mapping can always be
  -- audited back to the source row it came from.
  fbi_metro_name text not null
    constraint safety_fbi_metro_name_length
      check (char_length(fbi_metro_name) between 1 and 200),

  data_year integer not null
    constraint safety_data_year_range check (data_year between 1960 and 2100),

  -- Nullable: the FBI publishes a rate only where its criteria are met.
  violent_crime_rate numeric(10, 2)
    constraint safety_violent_rate_nonnegative check (violent_crime_rate >= 0),
  property_crime_rate numeric(10, 2)
    constraint safety_property_rate_nonnegative check (property_crime_rate >= 0),

  -- The MSA population the FBI used as the rate denominator. Kept because it
  -- is the source's own denominator, which may differ from `cities.population`.
  source_population bigint
    constraint safety_population_positive check (source_population > 0),

  -- Share of the metro population covered by agencies that actually reported,
  -- from the "Total area actually reporting" row. 1.0 means full coverage.
  reporting_coverage numeric(5, 4)
    constraint safety_reporting_coverage_range
      check (reporting_coverage >= 0 and reporting_coverage <= 1),

  -- True when the FBI printed an "Estimated total" row for this metro, i.e.
  -- the published rate includes estimation for non-reporting agencies. This is
  -- the source's own distinction between reported and estimated, not ours.
  is_estimated boolean not null default false,

  source_id uuid not null references public.metric_sources (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint metro_safety_stats_unique unique (city_id, data_year)
);

comment on table public.metro_safety_stats is
  'FBI CIUS Table 6 metro-level crime rates per 100,000 inhabitants. Metro/MSA geography only — these figures describe an entire metropolitan area and say nothing about a neighbourhood or an individual. NULL means the FBI published no rate, never zero crime.';

comment on column public.metro_safety_stats.is_estimated is
  'True when the FBI published an "Estimated total" row, meaning the rate accounts for agencies that did not report a full year.';

create index metro_safety_stats_city_idx on public.metro_safety_stats (city_id);

create trigger metro_safety_stats_set_updated_at
  before update on public.metro_safety_stats
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- metro_school_stats — NCES public-school counts and the ACS denominator
--
-- Counts of public schools located in the metro, joined on CBSA identifiers.
-- This measures how many public schools exist, and nothing about how good they
-- are: NCES EDGE publishes locations, not quality, achievement or ratings.
-- ---------------------------------------------------------------------------

create table public.metro_school_stats (
  id uuid primary key default gen_random_uuid(),

  city_id uuid not null references public.cities (id) on delete cascade,

  -- e.g. '2024-2025', exactly as NCES labels the collection.
  school_year text not null
    constraint school_year_length check (char_length(school_year) between 4 and 20),

  -- Distinct NCESSCH identifiers in this CBSA. Zero is a real, meaningful
  -- count here (a metro with no public schools), unlike a missing crime rate.
  public_school_count integer not null
    constraint school_count_nonnegative check (public_school_count >= 0),

  -- ACS B01001 population aged 5-17, the denominator for the access rate.
  -- Nullable: without it no rate can be formed, and a rate must not be
  -- invented from the total population instead.
  school_age_population integer
    constraint school_age_population_nonnegative check (school_age_population >= 0),

  -- ACS reporting period for `school_age_population`, e.g. '2019-2023'.
  population_period text not null
    constraint school_population_period_length
      check (char_length(population_period) between 1 and 40),

  source_id uuid not null references public.metric_sources (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint metro_school_stats_unique unique (city_id, school_year)
);

comment on table public.metro_school_stats is
  'NCES EDGE public-school counts per metro with the ACS 5-17 population denominator. Measures school availability only — never school quality, achievement, ranking or teaching.';

create index metro_school_stats_city_idx on public.metro_school_stats (city_id);

create trigger metro_school_stats_set_updated_at
  before update on public.metro_school_stats
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Same model as every other canonical reference dataset: readable by everyone,
-- writable by nobody through the API. Seeding happens offline with the service
-- role, which bypasses RLS and never runs in the application.
-- ---------------------------------------------------------------------------

alter table public.metro_safety_stats enable row level security;
alter table public.metro_school_stats enable row level security;

create policy "Metro safety stats are publicly readable"
  on public.metro_safety_stats for select to anon, authenticated using (true);

create policy "Metro school stats are publicly readable"
  on public.metro_school_stats for select to anon, authenticated using (true);

-- Explicit grants, so the migration is self-describing rather than relying on
-- whatever default privileges happen to be in force. Read-only for the API
-- roles; only the offline seeder writes.

grant select on public.metro_safety_stats to anon, authenticated;
grant select on public.metro_school_stats to anon, authenticated;

grant all on public.metro_safety_stats to service_role;
grant all on public.metro_school_stats to service_role;

-- ---------------------------------------------------------------------------
-- Algorithm version format
--
-- Phase 6B ships as v2.1: two previously unscored dimensions became
-- measurable, but no existing dimension's definition changed, so a minor bump
-- describes it more honestly than v3 would.
--
-- The original constraint allowed `^v[0-9]+$` only. Widening it to accept an
-- optional minor component is additive — every stored value (`v1`, `v2`) still
-- matches, so no historical snapshot is invalidated or rewritten.
-- ---------------------------------------------------------------------------

alter table public.recommendations
  drop constraint recommendations_algorithm_version_format;

alter table public.recommendations
  add constraint recommendations_algorithm_version_format
    check (algorithm_version ~ '^v[0-9]+(\.[0-9]+)?$');

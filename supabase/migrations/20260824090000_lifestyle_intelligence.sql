-- ---------------------------------------------------------------------------
-- Phase 6C — Lifestyle Intelligence
--
-- Activates Social, the last priority onboarding collected with nothing behind
-- it, and adds the optional lifestyle preferences that make it personal.
--
-- Forward-only. No historical migration is touched and no existing row is
-- rewritten: the new profile column is nullable with no default, so every
-- profile written before this migration stays valid and reads as "never asked".
-- ---------------------------------------------------------------------------

create type public.lifestyle_category as enum (
  'food_drink',
  'nightlife',
  'arts_culture',
  'live_entertainment',
  'fitness_recreation',
  'parks_outdoors',
  'shopping',
  'community_spaces'
);

-- Postgres arrays permit duplicates, and a duplicate would double-weight a
-- category in the mean. A CHECK cannot contain a subquery, so the test lives
-- in an IMMUTABLE helper instead of being left to the application to remember.
create function public.lifestyle_preferences_are_distinct(
  arr public.lifestyle_category[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select arr is null
      or cardinality(arr) = (select count(distinct e) from unnest(arr) as e)
$$;

comment on function public.lifestyle_preferences_are_distinct is
  'True when a lifestyle preference array has no repeated category. Used by a CHECK constraint, which cannot contain a subquery directly.';

-- An array rather than a join table: this is a short, closed, unordered set of
-- at most five values that is always read whole with the profile.
alter table public.profiles
  add column lifestyle_preferences public.lifestyle_category[]
    constraint profiles_lifestyle_preferences_size
      check (
        lifestyle_preferences is null
        or cardinality(lifestyle_preferences) <= 5
      )
    constraint profiles_lifestyle_preferences_distinct
      check (public.lifestyle_preferences_are_distinct(lifestyle_preferences));

comment on column public.profiles.lifestyle_preferences is
  'Optional lifestyle categories the user cares about. NULL means never asked; an empty array means asked and nothing in particular. Both are scored as a broad lifestyle mix, never penalised.';

-- ---------------------------------------------------------------------------
-- metro_lifestyle_stats — Overture place counts per metro per category
--
-- Normalised one row per (metro, category) rather than eight wide columns, so
-- adding or narrowing a category is data rather than a schema change.
--
-- Only derived counts are stored. No raw Overture place record is persisted.
-- ---------------------------------------------------------------------------

create table public.metro_lifestyle_stats (
  id uuid primary key default gen_random_uuid(),

  city_id uuid not null references public.cities (id) on delete cascade,

  category public.lifestyle_category not null,

  -- Distinct Overture place ids inside the metro's CBSA polygon. Zero is a
  -- real measurement — a metro with none of this category — and is different
  -- from the absence of a row.
  place_count integer not null
    constraint lifestyle_place_count_nonnegative check (place_count >= 0),

  -- The ACS metro population used as the per-capita denominator. Kept so the
  -- rate can always be recomputed from what produced it.
  population bigint not null
    constraint lifestyle_population_positive check (population > 0),

  places_per_100k numeric(12, 4) not null
    constraint lifestyle_rate_nonnegative check (places_per_100k >= 0),

  -- The pinned Overture release, e.g. '2026-08-19.0'.
  source_release text not null
    constraint lifestyle_source_release_length
      check (char_length(source_release) between 1 and 40),

  -- Version of the committed Overture-to-DreamDestination category mapping, so
  -- a re-classification is visible rather than silent.
  taxonomy_mapping_version text not null
    constraint lifestyle_mapping_version_length
      check (char_length(taxonomy_mapping_version) between 1 and 40),

  extracted_on date not null,

  source_id uuid not null references public.metric_sources (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint metro_lifestyle_stats_unique unique (city_id, category, source_release)
);

comment on table public.metro_lifestyle_stats is
  'Overture Maps place counts per metro per lifestyle category, joined by point-in-polygon against Census TIGER/Line CBSA boundaries. Measures availability and breadth only — never quality, popularity, ratings or walkability.';

create index metro_lifestyle_stats_city_idx on public.metro_lifestyle_stats (city_id);

create trigger metro_lifestyle_stats_set_updated_at
  before update on public.metro_lifestyle_stats
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security — same model as every other canonical reference dataset.
-- ---------------------------------------------------------------------------

alter table public.metro_lifestyle_stats enable row level security;

create policy "Metro lifestyle stats are publicly readable"
  on public.metro_lifestyle_stats for select to anon, authenticated using (true);

grant select on public.metro_lifestyle_stats to anon, authenticated;
grant all on public.metro_lifestyle_stats to service_role;

-- ---------------------------------------------------------------------------
-- Algorithm version
--
-- Phase 6C ships as v2.2. The format constraint already accepts an optional
-- minor component (widened in Phase 6B), so no change is needed here and no
-- stored snapshot is affected.
-- ---------------------------------------------------------------------------

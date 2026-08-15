-- ---------------------------------------------------------------------------
-- DreamDestination — initial schema
--
-- Targets Supabase (PostgreSQL). Depends on `auth.users` and the `anon`,
-- `authenticated` and `service_role` roles, all of which Supabase provides.
--
-- Scope: structure only. No city reference data is inserted here; ingestion is
-- a later work package.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Enumerated types
--
-- These mirror the closed value sets in `lib/constants.ts`. Adding a value
-- requires a matching `alter type ... add value` migration.
-- ---------------------------------------------------------------------------

create type public.age_range as enum (
  '18-24', '25-34', '35-44', '45-54', '55-64', '65+'
);

create type public.relationship_status as enum (
  'single', 'partnered', 'married', 'divorced', 'widowed'
);

create type public.work_preference as enum (
  'remote', 'hybrid', 'onsite', 'flexible'
);

-- A domain rather than an enum: state codes are referenced from two tables and
-- a domain keeps the value list defined exactly once.
create domain public.us_state_code as text
  check (
    value in (
      'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
      'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
      'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
      'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
      'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI',
      'WY'
    )
  );

-- ---------------------------------------------------------------------------
-- Shared trigger function
-- ---------------------------------------------------------------------------

-- `search_path = ''` prevents resolution of unqualified names against a
-- caller-controlled schema.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per user, holding structured onboarding answers
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key default gen_random_uuid(),

  -- Deleting the auth user removes their profile and, by cascade, everything
  -- derived from it.
  user_id uuid not null unique
    references auth.users (id) on delete cascade,

  age_range public.age_range not null,
  household_income numeric(12, 2) not null
    constraint profiles_household_income_non_negative
      check (household_income >= 0),
  occupation text not null
    constraint profiles_occupation_length
      check (char_length(occupation) between 1 and 120),
  relationship_status public.relationship_status not null,
  children integer not null default 0
    constraint profiles_children_non_negative check (children >= 0),
  household_size integer not null
    constraint profiles_household_size_positive check (household_size >= 1),
  current_city text not null
    constraint profiles_current_city_length
      check (char_length(current_city) between 1 and 120),
  current_state public.us_state_code not null,
  housing_budget numeric(12, 2) not null
    constraint profiles_housing_budget_non_negative
      check (housing_budget >= 0),
  work_preference public.work_preference not null,
  free_text_goals text
    constraint profiles_free_text_goals_length
      check (char_length(free_text_goals) <= 2000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The household is at least the user plus every child.
  constraint profiles_household_size_covers_children
    check (household_size >= children + 1)
);

comment on table public.profiles is
  'Structured onboarding answers. One row per authenticated user.';
comment on column public.profiles.household_income is
  'Annual gross household income in USD.';
comment on column public.profiles.housing_budget is
  'Monthly housing budget in USD.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- preferences — how much each scoring dimension matters to a user
-- ---------------------------------------------------------------------------

create table public.preferences (
  id uuid primary key default gen_random_uuid(),

  -- Unique: exactly one weighting per profile.
  profile_id uuid not null unique
    references public.profiles (id) on delete cascade,

  career_weight numeric(4, 3) not null default 0.5
    constraint preferences_career_weight_range
      check (career_weight between 0 and 1),
  housing_weight numeric(4, 3) not null default 0.5
    constraint preferences_housing_weight_range
      check (housing_weight between 0 and 1),
  cost_weight numeric(4, 3) not null default 0.5
    constraint preferences_cost_weight_range
      check (cost_weight between 0 and 1),
  safety_weight numeric(4, 3) not null default 0.5
    constraint preferences_safety_weight_range
      check (safety_weight between 0 and 1),
  education_weight numeric(4, 3) not null default 0.5
    constraint preferences_education_weight_range
      check (education_weight between 0 and 1),
  social_weight numeric(4, 3) not null default 0.5
    constraint preferences_social_weight_range
      check (social_weight between 0 and 1),
  transport_weight numeric(4, 3) not null default 0.5
    constraint preferences_transport_weight_range
      check (transport_weight between 0 and 1),
  climate_weight numeric(4, 3) not null default 0.5
    constraint preferences_climate_weight_range
      check (climate_weight between 0 and 1),
  family_weight numeric(4, 3) not null default 0.5
    constraint preferences_family_weight_range
      check (family_weight between 0 and 1),
  healthcare_weight numeric(4, 3) not null default 0.5
    constraint preferences_healthcare_weight_range
      check (healthcare_weight between 0 and 1),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.preferences is
  'Per-profile weighting of the scoring dimensions. Every weight is 0-1.';

create trigger preferences_set_updated_at
  before update on public.preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- cities — curated reference data, readable by everyone
-- ---------------------------------------------------------------------------

create table public.cities (
  id uuid primary key default gen_random_uuid(),

  slug text not null unique
    constraint cities_slug_format
      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  city text not null
    constraint cities_city_length check (char_length(city) between 1 and 120),
  state public.us_state_code not null,
  metro text
    constraint cities_metro_length check (char_length(metro) between 1 and 160),
  population integer
    constraint cities_population_non_negative check (population >= 0),
  latitude numeric(8, 6) not null
    constraint cities_latitude_range check (latitude between -90 and 90),
  longitude numeric(9, 6) not null
    constraint cities_longitude_range check (longitude between -180 and 180),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cities is
  'Curated city / metro reference data. Not populated yet.';

-- Supports "cities in state X" browsing; the unique index on slug covers
-- lookups by slug.
create index cities_state_idx on public.cities (state);

create trigger cities_set_updated_at
  before update on public.cities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- city_metrics — raw measurements plus normalised 0-1 scores
-- ---------------------------------------------------------------------------

create table public.city_metrics (
  id uuid primary key default gen_random_uuid(),

  -- Unique: one metrics row per city. Metrics are meaningless without their
  -- city, so they cascade.
  city_id uuid not null unique
    references public.cities (id) on delete cascade,

  -- Raw measurements, in their original units.
  median_rent numeric(10, 2)
    constraint city_metrics_median_rent_non_negative check (median_rent >= 0),
  median_income numeric(12, 2)
    constraint city_metrics_median_income_non_negative
      check (median_income >= 0),

  -- Normalised scores. Nullable because no data has been ingested: NULL means
  -- "not loaded", never "zero".
  career_score numeric(4, 3)
    constraint city_metrics_career_score_range
      check (career_score between 0 and 1),
  housing_score numeric(4, 3)
    constraint city_metrics_housing_score_range
      check (housing_score between 0 and 1),
  education_score numeric(4, 3)
    constraint city_metrics_education_score_range
      check (education_score between 0 and 1),
  safety_score numeric(4, 3)
    constraint city_metrics_safety_score_range
      check (safety_score between 0 and 1),
  transport_score numeric(4, 3)
    constraint city_metrics_transport_score_range
      check (transport_score between 0 and 1),
  climate_score numeric(4, 3)
    constraint city_metrics_climate_score_range
      check (climate_score between 0 and 1),
  healthcare_score numeric(4, 3)
    constraint city_metrics_healthcare_score_range
      check (healthcare_score between 0 and 1),
  cost_score numeric(4, 3)
    constraint city_metrics_cost_score_range
      check (cost_score between 0 and 1),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.city_metrics is
  'Raw and normalised metrics per city. NULL means not yet ingested.';

create trigger city_metrics_set_updated_at
  before update on public.city_metrics
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- recommendations — ranked city suggestions produced for a profile
-- ---------------------------------------------------------------------------

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),

  -- Recommendations belong to the profile and die with it.
  profile_id uuid not null
    references public.profiles (id) on delete cascade,

  -- RESTRICT, not CASCADE: curating reference data must not silently delete a
  -- user's saved results. Removing a city requires dealing with its
  -- recommendations first, deliberately.
  city_id uuid not null
    references public.cities (id) on delete restrict,

  dream_score numeric(5, 4) not null
    constraint recommendations_dream_score_range
      check (dream_score between 0 and 1),
  "rank" integer not null
    constraint recommendations_rank_positive check ("rank" >= 1),

  -- Structured explanation; shape defined by `types/recommendation.ts`.
  reason_json jsonb not null default '{}'::jsonb
    constraint recommendations_reason_json_is_object
      check (jsonb_typeof(reason_json) = 'object'),

  created_at timestamptz not null default now(),

  -- One city may appear only once in a profile's result set...
  constraint recommendations_unique_city_per_profile
    unique (profile_id, city_id),
  -- ...and each rank position is occupied at most once.
  constraint recommendations_unique_rank_per_profile
    unique (profile_id, "rank")
);

comment on table public.recommendations is
  'Ranked results for a profile. Written by trusted server-side code only.';

-- The (profile_id, ...) unique constraints already index profile_id; city_id
-- needs its own index so ON DELETE RESTRICT checks and joins stay cheap.
create index recommendations_city_id_idx on public.recommendations (city_id);

-- No updated_at: a recommendation is immutable once written. Re-running
-- scoring replaces the row set for that profile.

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Explicit grants so the migration is self-describing rather than relying on
-- Supabase's default privileges. RLS still applies on top of these.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.preferences to authenticated;

-- Users read their results but never write them.
grant select on public.recommendations to authenticated;

-- Reference data is world-readable.
grant select on public.cities to anon, authenticated;
grant select on public.city_metrics to anon, authenticated;

grant all on public.profiles to service_role;
grant all on public.preferences to service_role;
grant all on public.cities to service_role;
grant all on public.city_metrics to service_role;
grant all on public.recommendations to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- RLS is enabled on every table. Where no policy grants an action, that action
-- is denied — which is the intent, not an oversight.
--
-- IMPORTANT (Day 1): authentication is not wired up yet, so `auth.uid()` is
-- NULL for every request the app currently makes. Consequence: the
-- user-scoped policies below evaluate to false and profiles, preferences and
-- recommendations return zero rows to the anon key. That is the correct,
-- fail-closed behaviour. These policies only become *useful* once Supabase
-- Auth is wired in, and they are deliberately not loosened in the meantime.
--
-- The `(select auth.uid())` form lets Postgres evaluate the call once per
-- statement instead of once per row.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.preferences enable row level security;
alter table public.cities enable row level security;
alter table public.city_metrics enable row level security;
alter table public.recommendations enable row level security;

-- profiles: a user reads and writes only their own row.

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own profile"
  on public.profiles for delete to authenticated
  using ((select auth.uid()) = user_id);

-- preferences: ownership is inherited through the parent profile.

create policy "Users can read their own preferences"
  on public.preferences for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = preferences.profile_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "Users can create their own preferences"
  on public.preferences for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = preferences.profile_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "Users can update their own preferences"
  on public.preferences for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = preferences.profile_id
        and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = preferences.profile_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own preferences"
  on public.preferences for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = preferences.profile_id
        and p.user_id = (select auth.uid())
    )
  );

-- recommendations: read-only for users.
--
-- No insert/update/delete policy exists on purpose. Recommendations are
-- derived data; letting a client write them would let a user fabricate their
-- own results. Scoring runs server-side with the service-role key, which
-- bypasses RLS.

create policy "Users can read their own recommendations"
  on public.recommendations for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = recommendations.profile_id
        and p.user_id = (select auth.uid())
    )
  );

-- Reference data: readable by everyone, writable by no one.
--
-- Ingestion runs with the service-role key, so no write policy is needed here
-- either.

create policy "City reference data is publicly readable"
  on public.cities for select to anon, authenticated
  using (true);

create policy "City metrics are publicly readable"
  on public.city_metrics for select to anon, authenticated
  using (true);

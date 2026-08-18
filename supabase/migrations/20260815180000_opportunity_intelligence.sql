-- ---------------------------------------------------------------------------
-- DreamDestination — Phase 4: opportunity intelligence
--
-- Additive only. No existing table is dropped, no column removed, no Phase 3
-- migration edited. The Phase 3 matching tables and the Fit Score are
-- untouched: nothing here feeds back into scoring.
--
-- Provenance reuses the existing `metric_sources` table rather than inventing a
-- parallel abstraction — it already records organization, dataset, url, period,
-- retrieval date and geography level, which is exactly what BLS and ACS
-- attribution needs.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Geography: give cities a stable identifier
--
-- Phase 3 stored city/state/metro names but not the CBSA code, even though the
-- ingestion pipeline knew it. Career and housing sources publish by CBSA, and
-- joining those on a metro *name* would be fragile in exactly the way that
-- produces silently wrong data ("Austin, TX" vs "Austin-Round Rock, TX").
-- Adding the code makes every Phase 4 join exact.
--
-- Nullable so the column can be backfilled by the seed script without a
-- chicken-and-egg failure; uniqueness is still enforced where present.
-- ---------------------------------------------------------------------------

alter table public.cities
  add column cbsa_geoid text
    constraint cities_cbsa_geoid_format check (cbsa_geoid ~ '^[0-9]{5}$');

comment on column public.cities.cbsa_geoid is
  'Census CBSA code. The join key for BLS OEWS and ACS metro data; never join on metro name.';

create unique index cities_cbsa_geoid_key
  on public.cities (cbsa_geoid) where cbsa_geoid is not null;

-- ---------------------------------------------------------------------------
-- occupations — the SOC/O*NET taxonomy users are matched against
-- ---------------------------------------------------------------------------

create table public.occupations (
  soc_code text primary key
    constraint occupations_soc_format check (soc_code ~ '^[0-9]{2}-[0-9]{4}$'),

  title text not null
    constraint occupations_title_length check (char_length(title) between 1 and 200),
  description text,

  -- O*NET codes are more granular than SOC (e.g. 15-1252.00). Recorded for
  -- traceability, never derived by truncating one into the other.
  onet_code text
    constraint occupations_onet_format check (onet_code ~ '^[0-9]{2}-[0-9]{4}\.[0-9]{2}$'),

  source_id uuid not null references public.metric_sources (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.occupations is
  'SOC occupations from the O*NET taxonomy. Reference data; users cannot modify it.';

create index occupations_title_idx on public.occupations (lower(title));

create trigger occupations_set_updated_at
  before update on public.occupations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- occupation_titles — alternate/lay titles used by the resolver
--
-- Separate from `occupations` because the relationship is one-to-many: a single
-- SOC code has many colloquial titles ("software engineer", "programmer").
-- ---------------------------------------------------------------------------

create table public.occupation_titles (
  id uuid primary key default gen_random_uuid(),

  soc_code text not null references public.occupations (soc_code) on delete cascade,

  title text not null
    constraint occupation_titles_length check (char_length(title) between 1 and 200),

  -- Lower-cased, punctuation-stripped form the resolver matches against.
  normalized_title text not null
    constraint occupation_titles_normalized_length
      check (char_length(normalized_title) between 1 and 200),

  -- Where the title came from, so a match can explain itself.
  title_kind text not null
    constraint occupation_titles_kind_allowed
      check (title_kind in ('primary', 'alternate', 'reported')),

  created_at timestamptz not null default now(),

  constraint occupation_titles_unique unique (soc_code, normalized_title)
);

comment on table public.occupation_titles is
  'Primary and alternate occupation titles. Input to the deterministic resolver.';

create index occupation_titles_normalized_idx
  on public.occupation_titles (normalized_title);

-- ---------------------------------------------------------------------------
-- metro_occupation_stats — BLS OEWS estimates per metro per occupation
--
-- Every measure is nullable: OEWS suppresses estimates that do not meet
-- publication criteria, and a suppressed wage must stay NULL rather than
-- becoming a zero that would read as "this job pays nothing here".
-- ---------------------------------------------------------------------------

create table public.metro_occupation_stats (
  id uuid primary key default gen_random_uuid(),

  city_id uuid not null references public.cities (id) on delete cascade,
  soc_code text not null references public.occupations (soc_code) on delete restrict,

  -- Total jobs in the occupation in this metro. NOT a count of job openings.
  employment integer
    constraint metro_occupation_stats_employment_non_negative
      check (employment >= 0),

  -- Jobs in this occupation per 1,000 jobs in the metro.
  employment_per_1000 numeric(10, 3)
    constraint metro_occupation_stats_per_1000_non_negative
      check (employment_per_1000 >= 0),

  -- Concentration relative to the national average. 1.0 = national average.
  -- Measures how concentrated the occupation is here, not hiring odds.
  location_quotient numeric(10, 3)
    constraint metro_occupation_stats_lq_non_negative
      check (location_quotient >= 0),

  mean_annual_wage numeric(12, 2)
    constraint metro_occupation_stats_mean_wage_non_negative
      check (mean_annual_wage >= 0),
  median_annual_wage numeric(12, 2)
    constraint metro_occupation_stats_median_wage_non_negative
      check (median_annual_wage >= 0),
  p25_annual_wage numeric(12, 2)
    constraint metro_occupation_stats_p25_non_negative check (p25_annual_wage >= 0),
  p75_annual_wage numeric(12, 2)
    constraint metro_occupation_stats_p75_non_negative check (p75_annual_wage >= 0),

  -- Reporting period as published, e.g. 'May 2025'.
  period text not null
    constraint metro_occupation_stats_period_length
      check (char_length(period) between 1 and 40),

  source_id uuid not null references public.metric_sources (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint metro_occupation_stats_unique unique (city_id, soc_code, period),

  -- If both are published, the quartiles must not be inverted.
  constraint metro_occupation_stats_quartiles_ordered
    check (p25_annual_wage is null or p75_annual_wage is null
           or p25_annual_wage <= p75_annual_wage)
);

comment on table public.metro_occupation_stats is
  'BLS OEWS metro estimates. `employment` is total jobs, not openings; `location_quotient` is concentration, not hiring probability. NULL means suppressed or unpublished, never zero.';

create index metro_occupation_stats_city_idx on public.metro_occupation_stats (city_id);
create index metro_occupation_stats_soc_idx on public.metro_occupation_stats (soc_code);
create index metro_occupation_stats_city_soc_idx
  on public.metro_occupation_stats (city_id, soc_code);

create trigger metro_occupation_stats_set_updated_at
  before update on public.metro_occupation_stats
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- housing_market_stats — ACS rent and value benchmarks per metro
--
-- Bedroom-specific rents are nullable and are only populated where the source
-- actually publishes them; they are never interpolated from the overall median.
-- ---------------------------------------------------------------------------

create table public.housing_market_stats (
  id uuid primary key default gen_random_uuid(),

  city_id uuid not null references public.cities (id) on delete cascade,

  median_gross_rent numeric(10, 2)
    constraint housing_median_rent_positive check (median_gross_rent > 0),
  studio_rent numeric(10, 2)
    constraint housing_studio_rent_positive check (studio_rent > 0),
  one_bedroom_rent numeric(10, 2)
    constraint housing_one_bedroom_positive check (one_bedroom_rent > 0),
  two_bedroom_rent numeric(10, 2)
    constraint housing_two_bedroom_positive check (two_bedroom_rent > 0),
  three_bedroom_rent numeric(10, 2)
    constraint housing_three_bedroom_positive check (three_bedroom_rent > 0),
  four_bedroom_rent numeric(10, 2)
    constraint housing_four_bedroom_positive check (four_bedroom_rent > 0),

  median_home_value numeric(14, 2)
    constraint housing_home_value_positive check (median_home_value > 0),

  period text not null
    constraint housing_period_length check (char_length(period) between 1 and 40),

  source_id uuid not null references public.metric_sources (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint housing_market_stats_unique unique (city_id, period)
);

comment on table public.housing_market_stats is
  'ACS metro housing benchmarks. Bedroom rents are published values only, never interpolated. NULL means not published.';

create index housing_market_stats_city_idx on public.housing_market_stats (city_id);

create trigger housing_market_stats_set_updated_at
  before update on public.housing_market_stats
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- profile_career_targets — the user's confirmed occupation
--
-- Additive: `profiles.occupation` free text is preserved untouched. This table
-- records the structured interpretation alongside it, including the raw text
-- that produced the match, so a user's own words are never overwritten.
--
-- One target per profile for now; a multi-career model is not needed yet.
-- ---------------------------------------------------------------------------

create table public.profile_career_targets (
  id uuid primary key default gen_random_uuid(),

  profile_id uuid not null unique
    references public.profiles (id) on delete cascade,

  -- Exactly what the user typed, captured at match time.
  source_text text not null
    constraint career_target_source_text_length
      check (char_length(source_text) between 1 and 200),

  soc_code text not null references public.occupations (soc_code) on delete restrict,

  -- How the match was made, so a weak guess is auditable after the fact.
  match_method text not null
    constraint career_target_match_method_allowed
      check (match_method in ('exact', 'alternate_title', 'token_overlap', 'user_selected')),

  match_confidence numeric(4, 3) not null
    constraint career_target_confidence_range
      check (match_confidence between 0 and 1),

  -- True only when the user explicitly picked or approved this occupation.
  confirmed_by_user boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profile_career_targets is
  'Structured occupation for a profile. profiles.occupation free text is preserved separately and never overwritten.';

create trigger profile_career_targets_set_updated_at
  before update on public.profile_career_targets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
--
-- Reference data (occupations, titles, occupation stats, housing stats) follows
-- the existing `cities` posture exactly: world-readable, writable by nobody.
-- A user must not be able to invent a wage or edit rent data.
--
-- `profile_career_targets` is user-owned and follows the `preferences` posture:
-- full CRUD, scoped through the owning profile to auth.uid().
-- ---------------------------------------------------------------------------

grant select on public.occupations to anon, authenticated;
grant select on public.occupation_titles to anon, authenticated;
grant select on public.metro_occupation_stats to anon, authenticated;
grant select on public.housing_market_stats to anon, authenticated;
grant select, insert, update, delete on public.profile_career_targets to authenticated;

grant all on public.occupations to service_role;
grant all on public.occupation_titles to service_role;
grant all on public.metro_occupation_stats to service_role;
grant all on public.housing_market_stats to service_role;
grant all on public.profile_career_targets to service_role;

alter table public.occupations enable row level security;
alter table public.occupation_titles enable row level security;
alter table public.metro_occupation_stats enable row level security;
alter table public.housing_market_stats enable row level security;
alter table public.profile_career_targets enable row level security;

create policy "Occupations are publicly readable"
  on public.occupations for select to anon, authenticated using (true);

create policy "Occupation titles are publicly readable"
  on public.occupation_titles for select to anon, authenticated using (true);

create policy "Metro occupation stats are publicly readable"
  on public.metro_occupation_stats for select to anon, authenticated using (true);

create policy "Housing market stats are publicly readable"
  on public.housing_market_stats for select to anon, authenticated using (true);

-- Career target: ownership inherited through the profile, exactly as
-- `preferences` does. auth.uid() is the only source of ownership.

create policy "Users can read their own career target"
  on public.profile_career_targets for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = profile_career_targets.profile_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "Users can create their own career target"
  on public.profile_career_targets for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = profile_career_targets.profile_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "Users can update their own career target"
  on public.profile_career_targets for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = profile_career_targets.profile_id
        and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = profile_career_targets.profile_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own career target"
  on public.profile_career_targets for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = profile_career_targets.profile_id
        and p.user_id = (select auth.uid())
    )
  );

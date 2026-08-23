-- ---------------------------------------------------------------------------
-- DreamDestination — Phase 6A: explicit housing-size and climate preferences
--
-- Additive and forward-only. No earlier migration is edited, no column is
-- dropped, no data is rewritten, and no policy is changed: the existing
-- profiles RLS (owner = auth.uid()) already covers these columns, because they
-- live on a table whose row-level rules are defined once for the whole row.
--
-- Both columns are nullable with no default. Every profile created before this
-- migration therefore stays valid and keeps producing recommendations; NULL
-- means "the user was never asked", which the engine reads as "no preference
-- stated" rather than inventing an answer. A default would silently attribute
-- a housing size or a climate to people who never chose one.
-- ---------------------------------------------------------------------------

-- Mirrors DESIRED_BEDROOMS in lib/constants.ts. Each value maps to exactly one
-- bedroom-specific ACS rent column already stored in housing_market_stats:
--   studio -> studio_rent, one -> one_bedroom_rent, two -> two_bedroom_rent,
--   three -> three_bedroom_rent, four_plus -> four_bedroom_rent.
-- ACS B25031 publishes no category above "4 bedrooms", so four_plus maps to it
-- rather than pretending a five-bedroom estimate exists.
create type public.desired_bedrooms as enum (
  'studio', 'one', 'two', 'three', 'four_plus'
);

-- Mirrors CLIMATE_PREFERENCES in lib/constants.ts. 'no_preference' is a stored
-- answer, distinct from NULL ("never asked"), even though matching treats the
-- two the same way: it removes climate from the score instead of scoring every
-- metro against a target the user did not pick.
create type public.climate_preference as enum (
  'warm', 'mild', 'four_seasons', 'cool', 'no_preference'
);

alter table public.profiles
  add column desired_bedrooms public.desired_bedrooms,
  add column climate_preference public.climate_preference;

comment on column public.profiles.desired_bedrooms is
  'Housing size the user explicitly asked for. NULL means unstated; matching then uses the overall median gross rent. Never inferred from household size.';
comment on column public.profiles.climate_preference is
  'Climate the user explicitly asked for. NULL and ''no_preference'' both mean climate carries no weight in their score.';

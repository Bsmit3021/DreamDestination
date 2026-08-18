-- ---------------------------------------------------------------------------
-- DreamDestination — record BLS wage top-coding
--
-- Additive. OEWS uses three markers where a number would otherwise appear:
--
--   **  employment estimate not available
--   *   wage estimate not released
--   #   wage is at or above $115.00/hour ($239,200/year)
--
-- The first two are genuinely missing and become NULL. The third is different:
-- the wage is *known to be very high*, just not published as a point estimate.
-- Collapsing it into NULL alongside the others would report surgeons and chief
-- executives as "no wage data", which misleads in the opposite direction from
-- the usual suppression problem.
--
-- The wage columns stay NULL (there is no point estimate to store), but this
-- flag lets the UI say "at or above $239,200" instead of "not published".
-- ---------------------------------------------------------------------------

alter table public.metro_occupation_stats
  add column wage_top_coded boolean not null default false;

comment on column public.metro_occupation_stats.wage_top_coded is
  'True when BLS reported "#": the wage is at or above the published top code ($239,200/yr as of May 2025), so the wage columns are NULL by necessity rather than by suppression.';

import { clampScore, SCORE_MAX } from "@/lib/matching/normalization";
import type { ClimatePreference } from "@/types/profile";

/**
 * Climate scored against the climate the user actually asked for.
 *
 * Before Phase 6A every user was scored against a single 57 °F target, which
 * was a stated modelling assumption standing in for a question onboarding did
 * not ask. It now asks, so the assumption is gone: a metro's climate score
 * depends on the user's answer and on nothing else.
 *
 * Only NOAA's annual mean temperature (1991–2020 normals) is available in the
 * scored dataset, so every band below is expressed in those terms. That is a
 * real limit and is not papered over — see `four_seasons`.
 */

/**
 * A preferred range, plus how far outside it the score reaches zero.
 *
 * `low`/`high` may be infinite for open-ended preferences ("as warm as
 * possible"). Inside the band every metro scores 100: two metros that both
 * satisfy "warm" should not be separated by a fabricated ranking.
 */
export interface ClimateBand {
  low: number;
  high: number;
  /** °F beyond the band at which the score reaches 0. */
  tolerance: number;
}

/**
 * Tolerance in °F, shared by every band.
 *
 * Kept at the 20 °F the v1 climate target used, so the falloff a user
 * experiences is unchanged in shape — only the target moves. Across the 100
 * candidate metros (45.5 °F Spokane to 77.3 °F Miami, median 59.1 °F) a 20 °F
 * tolerance spreads the field without flattening it: no band collapses to a
 * single value, and only the most extreme mismatches reach 0.
 */
export const CLIMATE_TOLERANCE_FAHRENHEIT = 20;

/**
 * Preferred annual-mean bands, chosen from the observed distribution of the
 * candidate metros rather than from a general definition of "warm".
 *
 *   min 45.5   p25 52.2   median 59.1   p75 66.0   max 77.3
 *
 * The bands are therefore quartile-anchored and deliberately coarse: annual
 * mean temperature is a single summary statistic, and a threshold quoted to a
 * tenth of a degree would imply precision it does not carry.
 */
export const CLIMATE_BANDS = {
  /** Top quartile and above: Miami, Phoenix, McAllen. */
  warm: { low: 66, high: Infinity, tolerance: CLIMATE_TOLERANCE_FAHRENHEIT },
  /** Around the middle of the field. */
  mild: { low: 55, high: 65, tolerance: CLIMATE_TOLERANCE_FAHRENHEIT },
  /**
   * Bottom-to-middle of the field: Minneapolis, Chicago, Boston, Denver.
   *
   * Honest caveat: seasonality is a spread, not a mean, and the scored dataset
   * holds only the annual mean. This band is the best available proxy — the
   * metros with distinctly cold winters and warm summers cluster here — not a
   * measurement of how distinct the seasons are. Fixing that properly needs
   * monthly normals, which Phase 6A deliberately does not ingest.
   */
  four_seasons: {
    low: 47,
    high: 57,
    tolerance: CLIMATE_TOLERANCE_FAHRENHEIT,
  },
  /** Bottom quartile and below: Spokane, Minneapolis, Madison. */
  cool: { low: -Infinity, high: 52, tolerance: CLIMATE_TOLERANCE_FAHRENHEIT },
} as const satisfies Record<
  Exclude<ClimatePreference, "no_preference">,
  ClimateBand
>;

/**
 * Whether climate should influence this user's score at all.
 *
 * `no_preference` — and a legacy profile that was never asked — means it
 * should not. The caller removes the dimension's weight instead of scoring
 * every metro 50, or 100, or anything else invented.
 */
export function climateAffectsScoring(
  preference: ClimatePreference | null,
): preference is Exclude<ClimatePreference, "no_preference"> {
  return preference !== null && preference !== "no_preference";
}

export function bandFor(
  preference: Exclude<ClimatePreference, "no_preference">,
): ClimateBand {
  return CLIMATE_BANDS[preference];
}

/**
 * 0–100 for one metro's annual mean temperature against one preference.
 *
 * 100 anywhere inside the preferred band, then a linear falloff to 0 at
 * `tolerance` degrees outside it. Continuous, deterministic, and symmetric —
 * being 5 °F too cold costs exactly what being 5 °F too warm costs.
 */
export function climateBandScore(
  annualMeanTemperature: number,
  band: ClimateBand,
): number {
  if (!Number.isFinite(annualMeanTemperature)) {
    throw new RangeError(
      `Cannot score a non-finite temperature (${annualMeanTemperature})`,
    );
  }

  const distance =
    annualMeanTemperature < band.low
      ? band.low - annualMeanTemperature
      : annualMeanTemperature > band.high
        ? annualMeanTemperature - band.high
        : 0;

  return clampScore((1 - distance / band.tolerance) * SCORE_MAX);
}

/** What the explanation layer needs to describe a climate score honestly. */
export interface ClimateDetail {
  kind: "climate";
  preference: Exclude<ClimatePreference, "no_preference">;
  annualMeanTemperature: number;
  band: ClimateBand;
  /** True when the temperature sits inside the preferred band. */
  withinBand: boolean;
}

export function scoreClimate(
  annualMeanTemperature: number,
  preference: ClimatePreference | null,
): { score: number; detail: ClimateDetail } | null {
  if (!climateAffectsScoring(preference)) return null;

  const band = bandFor(preference);

  return {
    score: climateBandScore(annualMeanTemperature, band),
    detail: {
      kind: "climate",
      preference,
      annualMeanTemperature,
      band,
      withinBand:
        annualMeanTemperature >= band.low && annualMeanTemperature <= band.high,
    },
  };
}

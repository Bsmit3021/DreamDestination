import type { MetricSourceRef } from "@/lib/matching/types";
import type { DestinationOpportunity } from "@/lib/opportunity/types";

/**
 * The evidence registry: the model's entire factual world.
 *
 * Every number the advisor may state about a recommendation exists here as a
 * discrete, addressable item built from the database before the model is
 * called. The model may cite these ids; it can never introduce new ones,
 * because validation runs against the exact registry sent in that request.
 *
 * Ids are therefore *not* database selectors. They are opaque handles into a
 * pre-authorised set — a cited id can only ever resolve to something the user
 * was already entitled to see.
 *
 * Pure: no I/O, no database, fully testable.
 */

export type EvidenceCategory =
  "fit" | "preference" | "career" | "housing" | "source" | "tradeoff";

export interface EvidenceItem {
  id: string;
  category: EvidenceCategory;
  /** Present for city-scoped facts; absent for user-level ones. */
  citySlug?: string;
  label: string;
  /** null means "we do not have this", never "zero". */
  value: string | number | null;
  unit?: string;
  /** Extra qualification, e.g. why a wage is absent. */
  note?: string;
  source?: { organization: string; dataset: string; period: string };
}

/** Stable, human-auditable id. Slug-based so ids never leak database uuids. */
export function evidenceId(
  category: EvidenceCategory,
  parts: readonly string[],
): string {
  return [category, ...parts]
    .map((part) =>
      String(part)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter((part) => part.length > 0)
    .join(":");
}

function sourceOf(ref: MetricSourceRef | null | undefined) {
  return ref
    ? {
        organization: ref.organization,
        dataset: ref.dataset,
        period: ref.period,
      }
    : undefined;
}

/** Phase 3 fit facts, attributed to the matching algorithm rather than a dataset. */
function fitEvidence(
  destination: DestinationOpportunity,
  algorithmVersion: string,
): EvidenceItem[] {
  const slug = destination.city.slug;
  const algorithmSource = {
    organization: "DreamDestination",
    dataset: "Matching Algorithm",
    period: algorithmVersion,
  };

  const items: EvidenceItem[] = [
    {
      id: evidenceId("fit", [slug, "rank"]),
      category: "fit",
      citySlug: slug,
      label: `${destination.city.city} recommendation rank`,
      value: destination.fit.rank,
      source: algorithmSource,
    },
    {
      id: evidenceId("fit", [slug, "score"]),
      category: "fit",
      citySlug: slug,
      label: `${destination.city.city} Fit Score`,
      value: Math.round(destination.fit.score),
      unit: "out of 100",
      note: "Similarity between the user's stated priorities and measured metro data. Not a probability of happiness or relocation success.",
      source: algorithmSource,
    },
    {
      id: evidenceId("fit", [slug, "data-coverage"]),
      category: "fit",
      citySlug: slug,
      label: `${destination.city.city} data coverage`,
      value: Math.round(destination.fit.dataCoverage * 100),
      unit: "percent of weighted priorities measured",
      source: algorithmSource,
    },
  ];

  destination.fit.reasons.forEach((reason, index) => {
    items.push({
      id: evidenceId("fit", [slug, "strength", String(index + 1)]),
      category: "fit",
      citySlug: slug,
      label: `${destination.city.city} strength: ${reason.label}`,
      value: reason.detail,
      source: algorithmSource,
    });
  });

  destination.fit.tradeoffs.forEach((tradeoff, index) => {
    items.push({
      id: evidenceId("tradeoff", [slug, String(index + 1)]),
      category: "tradeoff",
      citySlug: slug,
      label: `${destination.city.city} tradeoff: ${tradeoff.label}`,
      value: tradeoff.detail,
      source: algorithmSource,
    });
  });

  return items;
}

/**
 * Career facts.
 *
 * Suppression is expressed as a labelled absence with a note, never as 0 and
 * never omitted silently — the model needs to be able to say "BLS does not
 * publish this" rather than guess.
 */
function careerEvidence(destination: DestinationOpportunity): EvidenceItem[] {
  const career = destination.career;
  if (!career) return [];

  const slug = destination.city.slug;
  const soc = career.occupation.socCode;
  const source = sourceOf(career.source);
  const items: EvidenceItem[] = [];

  const add = (
    key: string,
    label: string,
    value: string | number | null,
    unit?: string,
    note?: string,
  ) => {
    items.push({
      id: evidenceId("career", [slug, soc, key]),
      category: "career",
      citySlug: slug,
      label,
      value,
      unit,
      note,
      source,
    });
  };

  add(
    "employment",
    `${career.occupation.title} employment in ${destination.city.city}`,
    career.employment,
    "people employed",
    "Total people employed in this occupation. This is NOT a count of current job openings or vacancies.",
  );

  add(
    "employment-per-1000",
    `${career.occupation.title} jobs per 1,000 jobs in ${destination.city.city}`,
    career.employmentPer1000,
    "per 1,000 jobs",
  );

  add(
    "location-quotient",
    `${career.occupation.title} location quotient in ${destination.city.city}`,
    career.locationQuotient,
    "ratio vs national average",
    "Measures how concentrated this occupation is locally compared with the nation. 1.0 is typical. It is NOT a probability of being hired.",
  );

  const wages = career.wages;

  if (wages.availability === "top_coded") {
    add(
      "median-annual-wage",
      `${career.occupation.title} median annual wage in ${destination.city.city}`,
      wages.topCodeAnnual,
      "USD per year, lower bound",
      "BLS reported '#': the wage is AT OR ABOVE this figure. No exact point estimate exists. Never state this as an exact wage.",
    );
  } else if (wages.availability === "not_released") {
    add(
      "median-annual-wage",
      `${career.occupation.title} median annual wage in ${destination.city.city}`,
      null,
      "USD per year",
      "BLS suppressed this estimate for this metro and occupation. It is not published. This does not mean the wage is zero or that no such jobs exist.",
    );
  } else {
    add(
      "median-annual-wage",
      `${career.occupation.title} median annual wage in ${destination.city.city}`,
      wages.medianAnnual,
      "USD per year",
      "A published market statistic for the occupation in this metro. It is not a prediction of what this user would be paid.",
    );
    add(
      "mean-annual-wage",
      `${career.occupation.title} mean annual wage in ${destination.city.city}`,
      wages.meanAnnual,
      "USD per year",
    );
    add(
      "wage-p25",
      `${career.occupation.title} 25th percentile annual wage in ${destination.city.city}`,
      wages.percentile25,
      "USD per year",
    );
    add(
      "wage-p75",
      `${career.occupation.title} 75th percentile annual wage in ${destination.city.city}`,
      wages.percentile75,
      "USD per year",
    );
  }

  return items;
}

/** Housing benchmarks. Never described as available inventory. */
function housingEvidence(destination: DestinationOpportunity): EvidenceItem[] {
  const housing = destination.housing;
  if (!housing) return [];

  const slug = destination.city.slug;
  const source = sourceOf(housing.source);
  const items: EvidenceItem[] = [];

  const add = (
    key: string,
    label: string,
    value: number | null,
    unit: string,
    note?: string,
  ) => {
    items.push({
      id: evidenceId("housing", [slug, key]),
      category: "housing",
      citySlug: slug,
      label,
      value,
      unit,
      note,
      source,
    });
  };

  add(
    "median-gross-rent",
    `${destination.city.city} median gross rent`,
    housing.medianGrossRent,
    "USD per month",
    "A published market benchmark including utilities. It is not a listing, an available unit, or a quoted price.",
  );

  const bedroomLabels: [keyof typeof housing.bedrooms, string][] = [
    ["studio", "studio"],
    ["one", "1-bedroom"],
    ["two", "2-bedroom"],
    ["three", "3-bedroom"],
    ["four", "4-bedroom"],
  ];

  for (const [key, label] of bedroomLabels) {
    add(
      `rent-${label}`,
      `${destination.city.city} median ${label} rent`,
      housing.bedrooms[key],
      "USD per month",
    );
  }

  add(
    "median-home-value",
    `${destination.city.city} median home value`,
    housing.medianHomeValue,
    "USD",
  );

  if (housing.budgetComparison) {
    const comparison = housing.budgetComparison;
    add(
      "budget-difference",
      `${destination.city.city} difference between the user's monthly housing budget and the rent benchmark`,
      comparison.difference,
      "USD per month",
      "Positive means the stated budget exceeds the benchmark; negative means it falls short. Arithmetic only — it does not establish that housing is affordable or available.",
    );
    add(
      "benchmark-percent-of-budget",
      `${destination.city.city} rent benchmark as a share of the user's budget`,
      Math.round(comparison.benchmarkPercentOfBudget),
      "percent",
    );
  }

  return items;
}

export interface EvidenceRegistry {
  items: EvidenceItem[];
  byId: Map<string, EvidenceItem>;
}

/** Builds the registry for a user's destination set. Deterministic. */
export function buildEvidenceRegistry(
  destinations: readonly DestinationOpportunity[],
  userFacts: {
    housingBudget: number | null;
    confirmedOccupation: { socCode: string; title: string } | null;
    topPriorities: { label: string; weightPercent: number }[];
  },
  algorithmVersion: string,
): EvidenceRegistry {
  const items: EvidenceItem[] = [];

  if (userFacts.housingBudget !== null && userFacts.housingBudget > 0) {
    items.push({
      id: evidenceId("preference", ["user", "housing-budget"]),
      category: "preference",
      label: "User's stated monthly housing budget",
      value: userFacts.housingBudget,
      unit: "USD per month",
    });
  }

  if (userFacts.confirmedOccupation) {
    items.push({
      id: evidenceId("preference", ["user", "occupation"]),
      category: "preference",
      label: "User's confirmed occupation",
      value: `${userFacts.confirmedOccupation.title} (SOC ${userFacts.confirmedOccupation.socCode})`,
    });
  }

  userFacts.topPriorities.forEach((priority) => {
    items.push({
      id: evidenceId("preference", ["user", "priority", priority.label]),
      category: "preference",
      label: `User priority weight: ${priority.label}`,
      value: priority.weightPercent,
      unit: "percent of total weight",
    });
  });

  for (const destination of destinations) {
    items.push(...fitEvidence(destination, algorithmVersion));
    items.push(...careerEvidence(destination));
    items.push(...housingEvidence(destination));
  }

  // Ids must be unique: a duplicate would make a citation ambiguous and could
  // resolve to the wrong source label in the UI.
  const byId = new Map<string, EvidenceItem>();
  for (const item of items) {
    if (byId.has(item.id)) {
      throw new Error(`Duplicate evidence id generated: ${item.id}`);
    }
    byId.set(item.id, item);
  }

  return { items, byId };
}

/**
 * Keeps only ids that were genuinely present in this request's registry.
 *
 * Model output is untrusted. An unknown id is dropped rather than looked up,
 * which is what stops a fabricated citation from ever reaching the database or
 * appearing as a real source in the UI.
 */
export function validateCitations(
  citedIds: readonly string[],
  registry: EvidenceRegistry,
): { valid: string[]; rejected: string[] } {
  const valid: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const id of citedIds) {
    if (seen.has(id)) continue;
    seen.add(id);

    if (registry.byId.has(id)) valid.push(id);
    else rejected.push(id);
  }

  return { valid, rejected };
}

/** Distinct source labels for the cited evidence, resolved from our own data. */
export function resolveSources(
  validIds: readonly string[],
  registry: EvidenceRegistry,
): { organization: string; dataset: string; period: string }[] {
  const seen = new Map<
    string,
    { organization: string; dataset: string; period: string }
  >();

  for (const id of validIds) {
    const source = registry.byId.get(id)?.source;
    if (!source) continue;
    seen.set(
      `${source.organization}|${source.dataset}|${source.period}`,
      source,
    );
  }

  return [...seen.values()].sort(
    (a, b) =>
      a.organization.localeCompare(b.organization) ||
      a.dataset.localeCompare(b.dataset),
  );
}

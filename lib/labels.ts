import type {
  AgeRange,
  PreferenceWeightKey,
  RelationshipStatus,
  WorkPreference,
} from "@/types/profile";

/**
 * Human-readable text for the closed value sets in `lib/constants.ts`.
 *
 * Kept apart from the constants themselves so the stored values stay stable
 * while wording can change freely. `satisfies Record<Union, …>` means adding a
 * value without adding its label is a compile error.
 */

export const AGE_RANGE_LABELS = {
  "18-24": "18 to 24",
  "25-34": "25 to 34",
  "35-44": "35 to 44",
  "45-54": "45 to 54",
  "55-64": "55 to 64",
  "65+": "65 or older",
} satisfies Record<AgeRange, string>;

export const RELATIONSHIP_STATUS_LABELS = {
  single: "Single",
  partnered: "Partnered",
  married: "Married",
  divorced: "Divorced",
  widowed: "Widowed",
} satisfies Record<RelationshipStatus, string>;

export const WORK_PREFERENCE_LABELS = {
  remote: "Fully remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  flexible: "Flexible / no strong preference",
} satisfies Record<WorkPreference, string>;

/** Label and explanation for each scoring dimension. */
export const PREFERENCE_LABELS = {
  career: {
    label: "Career opportunity",
    description: "Strength of the job market in your field.",
  },
  housing: {
    label: "Housing",
    description: "Availability and quality of homes you could actually get.",
  },
  cost: {
    label: "Cost of living",
    description: "Day-to-day affordability beyond housing.",
  },
  safety: {
    label: "Safety",
    description: "How secure the area feels day to day.",
  },
  education: {
    label: "Schools and education",
    description: "Quality of schools and access to further education.",
  },
  social: {
    label: "Social life",
    description: "Things to do, and the chance to build a circle of people.",
  },
  transport: {
    label: "Getting around",
    description: "Public transit, walkability and commute times.",
  },
  climate: {
    label: "Climate",
    description: "Weather and seasons you would be living with.",
  },
  family: {
    label: "Family friendliness",
    description: "How well the place suits raising or hosting a family.",
  },
  healthcare: {
    label: "Healthcare",
    description: "Access to hospitals, clinics and specialists.",
  },
} satisfies Record<PreferenceWeightKey, { label: string; description: string }>;

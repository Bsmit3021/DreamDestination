# The matching engine

How DreamDestination turns a user's stated priorities and published federal
statistics into a ranked, explainable list of metros. No model decides the
ranking; the arithmetic below does, and the same inputs always produce the same
output.

## Candidate universe

**The 100 most populous U.S. Metropolitan Statistical Areas**, ranked by ACS
2023 5-year total population.

Metro (CBSA), not city limits, because that is the unit every metric here is
published at. City boundaries are administrative artefacts — the Atlanta city
limit holds well under a tenth of the people who live in "Atlanta" — so
city-level rent and commute figures would describe a different population than
the one a mover actually joins.

Excluded, explicitly:

- **Micropolitan areas** — below the ACS 1-year publication threshold, thinner
  coverage.
- **Puerto Rico (San Juan)** — the existing `us_state_code` domain covers the 50
  states plus DC, so a PR metro cannot be stored. The universe is over-selected
  to 110 and truncated back to 100 so the exclusion does not shrink it.

## Data sources

Every scored metric, its source, and how it becomes a score:

| Dimension  | Raw metric                                                     | Source                    | Period    | Geography           | Unit    | Direction        | Normalisation   |
| ---------- | -------------------------------------------------------------- | ------------------------- | --------- | ------------------- | ------- | ---------------- | --------------- |
| career     | Unemployment rate (B23025: unemployed ÷ civilian labour force) | Census ACS 5-Year         | 2019–2023 | CBSA                | percent | lower is better  | percentile      |
| housing    | Median gross rent (B25064)                                     | Census ACS 5-Year         | 2019–2023 | CBSA                | $/month | lower is better  | percentile      |
| cost       | Median gross rent as a share of household income (B25071)      | Census ACS 5-Year         | 2019–2023 | CBSA                | percent | lower is better  | percentile      |
| education  | Bachelor's degree or higher, adults 25+ (B15003)               | Census ACS 5-Year         | 2019–2023 | CBSA                | percent | higher is better | percentile      |
| transport  | Mean travel time to work (B08013 ÷ B08303)                     | Census ACS 5-Year         | 2019–2023 | CBSA                | minutes | lower is better  | percentile      |
| healthcare | Population without health insurance (B27001)                   | Census ACS 5-Year         | 2019–2023 | CBSA                | percent | lower is better  | percentile      |
| climate    | Annual mean temperature                                        | NOAA U.S. Climate Normals | 1991–2020 | **weather station** | °F      | target (57 °F)   | target distance |

**Geography caveat.** Six of the seven metrics are genuinely CBSA-level. Climate
is not: NOAA publishes per-station normals, so each metro is matched to the
nearest airport station that publishes an annual mean. That mismatch is recorded
in the data — the NOAA source row carries `geography_level = 'station'` rather
than `'cbsa'` — instead of being hidden in a comment.

**Metric naming.** Each label states what the source measures. `rent_share_of_income`
is a rent burden, not an "affordability score"; the transformation into a score
happens in the engine, never in the metric name.

### Dimensions collected but not scored

Onboarding collects ten priorities. Three have no metric:

| Dimension | Why                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| safety    | The FBI Crime Data Explorer API requires an api.data.gov key, which is not configured. Crime data is absent rather than approximated from a weaker source. |
| social    | No authoritative federal dataset measures social opportunity at metro level. Bar or restaurant counts would overstate what the data supports.              |
| family    | No single authoritative measure. Household-composition shares describe who already lives somewhere, not how well a place suits a family.                   |

These are not scored as zero. They are treated as missing data, which reduces a
city's coverage and redistributes weight — see below.

## The algorithm

`MATCHING_ALGORITHM_VERSION = "v1"`, stored on every persisted row.

### 1. Hard filters

Only one, because only one is supported by what onboarding collects:

- **Budget feasibility** — a metro is dropped when its median gross rent exceeds
  `housingBudget × 1.5`. Median rent above budget is not by itself
  disqualifying (half of rentals cost less than the median); beyond 1.5× even a
  modest home is a stretch. Skipped entirely when the budget is 0, which means
  "unspecified" far more often than "I can pay nothing".

Everything else the profile collects is recorded in `UNUSED_PROFILE_FIELDS` with
the reason it is not yet a filter, rather than being turned into invented logic.

### 2. Normalisation to 0–100

Raw metrics are incompatible — dollars, minutes, percentages, degrees — so each
is mapped onto a shared scale where 100 is a strong fit.

**Percentile rank** is the default, not min-max. Metro measurements have long
tails; one metro's rent sits far above every other, and plain min-max would
squash the entire middle of the distribution into a narrow band decided by that
single outlier. Percentile rank asks "how does this metro compare with the
others?", which is both what a user wants to know and immune to how extreme the
extremes are.

Ties share the midpoint of the range they occupy, so equal inputs always receive
equal scores. A single candidate, or a set where every value is identical,
scores 50 — there is no basis to prefer one over another.

**Target distance** is used for climate, where neither direction is better:
`score = max(0, 1 − |value − 57 °F| / 20) × 100`. The 57 °F target is a stated
modelling assumption, not a measurement — onboarding does not yet ask which
climate a user prefers, so a single shared "temperate" target is the honest
choice.

A winsorised min-max is also implemented and tested, for metrics where the
distance between values matters rather than just their order.

### 3. Weights

The ten sliders are relative importance, not a budget, so they are rescaled to
sum to 1:

```
normalizedWeight[d] = rawWeight[d] / Σ rawWeight
```

**All sliders at zero** is read as equal importance across all ten dimensions —
the same result as setting every slider to the same non-zero value. It never
divides by zero.

### 4. Missing data

A missing dimension is dropped from the denominator, never scored as zero.
Scoring it zero would assert "this city is terrible at X"; dropping it says "we
do not know about X here".

```
effectiveWeight[d] = normalizedWeight[d] / Σ normalizedWeight[available]
coverage           = Σ normalizedWeight[available]
```

Coverage is **weight-based, not a dimension count**. A user who cares only about
safety gets 0% coverage even though nine other dimensions have data; counting
dimensions would report 90% and imply a confidence the result does not deserve.

Cities below **60% coverage** are excluded rather than shown with a quietly
unreliable number.

### 5. Score

```
totalScore = Σ (normalizedScore[d] × effectiveWeight[d])
```

Effective weights sum to 1 and scores are 0–100, so the total is 0–100. Per-
dimension contributions are retained for the breakdown and the explanations.

Displayed as a whole number. The inputs are survey estimates with their own
margins of error, so "87.392" would imply precision the data cannot support.

### 6. Ranking and ties

Sorted by total score, then **data coverage** (between two equal scores, prefer
the one supported by more of what the user cares about), then the city's stable
id. Fully deterministic and independent of the order rows arrive from the
database.

### 7. Explanations

Generated from the scoring output only.

- **Strengths** — dimensions scoring ≥ 60, ranked by _contribution_, so a
  dimension the user barely cares about cannot lead the explanation just because
  the metro happens to do well at it.
- **Watch-outs** — dimensions scoring ≤ 45, ranked by `weight × (100 − score)`,
  the contribution they failed to make.

Every line quotes the measurement behind it. A reason can only name a dimension
that was actually measured for that metro.

## Worked example

Affordability-first user (housing 1.0, cost 0.9, career 0.2) → **Wichita, KS**:

```
weights 1.0 / 0.9 / 0.2  →  0.4762 / 0.4286 / 0.0952

housing   median gross rent   $969     → 96.50 × 0.4762 = 45.952
cost      rent share income   27.3%    → 96.50 × 0.4286 = 41.357
career    unemployment        4.98%    → 47.50 × 0.0952 =  4.524
                                                  total = 91.833
                                              displayed = 92 / 100
                                               coverage = 100%
```

## Reproducing the dataset

```bash
npm run data:fetch      # download ACS, gazetteer and NOAA normals into data/raw
```

```bash
npm run data:transform  # build data/processed/{cities,observations}.json
```

```bash
npm run data:validate   # fail loudly on anything malformed
```

```bash
npm run data:seed       # load into Supabase with the service-role key
```

`data/raw/` is gitignored — it is reproducible and large-ish. `data/processed/`
is committed, so a clone can seed without re-downloading ~140 MB of summary
files. `data:fetch` is resumable: re-running skips tables already downloaded.

No API keys are needed. Every source is a public file endpoint.

## What the score does not mean

A fit score is the similarity between the priorities a user stated and the
measurable characteristics of a metro, relative to the other candidates. It is
not a probability of happiness, of a successful move, or of anything else.

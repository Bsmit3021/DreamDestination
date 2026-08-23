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

| Dimension  | Raw metric                                                     | Source                    | Period    | Geography           | Unit    | Direction             | Normalisation |
| ---------- | -------------------------------------------------------------- | ------------------------- | --------- | ------------------- | ------- | --------------------- | ------------- |
| career     | Unemployment rate (B23025: unemployed ÷ civilian labour force) | Census ACS 5-Year         | 2019–2023 | CBSA                | percent | lower is better       | percentile    |
| housing    | Median gross rent (B25064)                                     | Census ACS 5-Year         | 2019–2023 | CBSA                | $/month | lower is better       | percentile    |
| cost       | Median gross rent as a share of household income (B25071)      | Census ACS 5-Year         | 2019–2023 | CBSA                | percent | lower is better       | percentile    |
| education  | Bachelor's degree or higher, adults 25+ (B15003)               | Census ACS 5-Year         | 2019–2023 | CBSA                | percent | higher is better      | percentile    |
| transport  | Mean travel time to work (B08013 ÷ B08303)                     | Census ACS 5-Year         | 2019–2023 | CBSA                | minutes | lower is better       | percentile    |
| healthcare | Population without health insurance (B27001)                   | Census ACS 5-Year         | 2019–2023 | CBSA                | percent | lower is better       | percentile    |
| climate    | Annual mean temperature                                        | NOAA U.S. Climate Normals | 1991–2020 | **weather station** | °F      | user's preferred band | band distance |

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

`MATCHING_ALGORITHM_VERSION = "v2"`, stored on every persisted row. See
[DreamScore V2](#dreamscore-v2) for what changed.

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

**Band distance** is used for climate, where neither direction is better. A
metro inside the user's preferred band scores 100; outside it, the score falls
linearly with distance from the nearest edge and reaches 0 at `tolerance`
degrees. See [DreamScore V2](#dreamscore-v2) — the universal 57 °F target that
v1 applied to everyone is gone.

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

## DreamScore V2

v1 asked "what is this metro like?". v2 asks "what is this metro like **for
you**". Three dimensions — career, housing, climate — now read the user's own
occupation, housing size and climate preference instead of a single figure that
was identical for everybody.

### Two kinds of weight, kept apart

This is the distinction that matters most, because confusing the two would let
a developer-chosen number quietly overrule a user-chosen one.

|                               | Set by                 | Decides                                   |
| ----------------------------- | ---------------------- | ----------------------------------------- |
| **Top-level priority weight** | the user's ten sliders | how much each dimension matters           |
| **Career Fit sub-weight**     | the engine             | what "career fit" _means_ once it matters |

The sub-weights live entirely inside the career dimension. Total score is still
`Σ (dimensionScore × effectiveWeight)` with the user's weights — v2 changes how
`dimensionScore` is computed, never how it is weighted.

### Career Fit

When the user has a confirmed occupation and BLS OEWS publishes enough about it
in a metro, career is scored from that occupation rather than metro-wide
unemployment:

| Component             | Weight | Metric                          | Normalisation                         |
| --------------------- | ------ | ------------------------------- | ------------------------------------- |
| Median wage           | 30%    | OEWS median annual wage         | percentile, higher better             |
| Location quotient     | 25%    | local concentration vs national | percentile, higher better             |
| Jobs per 1,000        | 25%    | occupation share of metro jobs  | percentile, higher better             |
| Employment depth      | 10%    | `log1p(employment)`             | **winsorised min-max**, higher better |
| General labour market | 10%    | metro unemployment rate         | percentile, lower better              |

**Why `log1p`, and why min-max for that one component.** Raw employment spans
four orders of magnitude across the 100 metros, and most of that spread is
simply metro size. `log1p` says a market with ten times the jobs is better
placed but not ten times better placed. The subtlety: percentile rank is
order-preserving, so applying `log1p` and _then_ taking a percentile returns
exactly the same answer as using raw employment — the transform would be
decorative. Winsorised min-max (5th/95th) is what makes the compression real,
and the component is capped at 10% so size cannot decide the dimension anyway.

**Housing is deliberately absent from Career Fit.** Housing already has its own
weighted dimension; adding affordability here would let it influence DreamScore
twice.

### Suppressed and missing OEWS values

BLS suppresses estimates that fail its publication criteria, and reports `#`
when a wage is at or above its top code. Neither is a low value.

- A suppressed field is **excluded from its component population** — never
  zeroed, never imputed. It does not shift any other metro's percentile.
- A **top-coded wage is treated as absent**. Scoring `$239,200` as if it were
  the median would invent a figure BLS explicitly declined to publish.
- Surviving component weights are **renormalised** over what the metro actually
  has, so one missing field redistributes rather than drags the score down.
- `coverage` records the share of intended component weight that had data.

**The occupation-specific threshold.** At least **two** of the four
occupation-specific indicators (wage, location quotient, jobs per 1,000,
employment depth) must be present. One survivor would carry 100% of the weight
after renormalisation — not enough to claim the ranking reflects the user's
occupation. Below the threshold the occupational figures are dropped entirely
and the metro falls back to the general labour-market score.

`basis` is recorded on every career score, and explanations never imply
occupational evidence when the fallback was used.

### Evidence confidence

Recording the basis made the fallback _visible_, but it did not make the two
kinds of score _comparable_. They landed on the same 0–100 axis, so a metro
scored purely on its unemployment rate could outrank every metro that actually
published data for the user's occupation.

That is not hypothetical. Scoring Registered Nurses across the 100 candidate
metros, the leader was **Durham at 89.5 — a metro-wide score, with no published
RN wage at all** — ahead of New Haven, Milwaukee and every other metro where BLS
did publish RN figures. The explanation disclosed the fallback honestly; the
ranking still presented generic evidence as occupational evidence.

Every career score is therefore multiplied by an **evidence confidence** factor.
Which factor depends on _why_ the metro-wide labour market was used, which is
why there are three bases rather than two:

| `basis`                    | when                                                     | `evidenceConfidence` |
| -------------------------- | -------------------------------------------------------- | -------------------- |
| `occupation_specific`      | occupation named, BLS published enough about it here     | 1.00                 |
| `occupation_data_fallback` | occupation named, BLS published too little about it here | 0.65                 |
| `general_labor_market`     | no occupation named                                      | 1.00                 |

```
effectiveCareerScore = rawScore × evidenceConfidence
```

**Why `general_labor_market` is not discounted.** The 0.65 factor represents one
thing only: the app substituting generic evidence for the occupational evidence
a user actually asked about. A user who named no occupation never asked for
that, so nothing was substituted and nothing is missing — the metro-wide labour
market _is_ the career measurement they requested. Discounting it would also
quietly shrink the career priority they explicitly set on the preferences
slider, which is the user's decision to make and not the algorithm's.

The two cases are indistinguishable from per-city data — a metro with no OEWS
row looks identical either way — so `scoreCareerFit` takes the user's confirmed
occupation as an explicit argument. It is passed rather than inferred from "does
any candidate carry a row", because that inference would misread the case that
matters most: an occupation so thinly published that no candidate metro carries
it at all.

`CareerScore.score` is the effective score — it is what DreamScore consumes and
what ranks the city. `CareerDetail.rawScore` and `CareerDetail.evidenceConfidence`
are stored beside it, so three separate questions stay separable:

| Question                                              | Field                |
| ----------------------------------------------------- | -------------------- |
| How strong does this labour market look?              | `rawScore`           |
| How well can the app speak to _this_ occupation here? | `evidenceConfidence` |
| What actually ranked the city?                        | `score`              |

**What 0.65 does not mean.** It is not a claim that Durham's labour market is
35% worse. It is not a probability, a confidence interval, or any other
statistical quantity — there is no sampling model behind it and it must never be
presented as one. It means: _the app has substantially weaker evidence that this
labour market is good for the occupation this user named._ It is a ranking
policy, chosen so that a metro with real occupational data does not have to
compete on equal terms with one where the app is really just quoting the
unemployment rate.

**Partial occupational coverage is not penalised either.** A metro that clears
`MIN_OCCUPATION_INDICATORS` keeps `evidenceConfidence = 1.0` even with a
suppressed field. Component-weight renormalisation already handles that case,
and charging for it a second time would punish metros for BLS publication rules
rather than for missing occupational evidence. `coverage` reports it separately.

The factor is applied last, to the finished score rather than to any component,
so it cannot interact with renormalisation: the occupational formula above is
untouched and only the fallback branch is discounted.

**One consequence worth knowing.** Within a single basis the factor is uniform,
so it never reorders metros scored the same way — what it changes is how much
career can contribute _against the other dimensions_. It only ever bites on a
mixed set, where some metros publish the user's occupation and others do not.

`basis`, `rawScore` and `evidenceConfidence` are all persisted in `reason_json`,
so a stored recommendation stays explainable. `basis` is stored as a plain
string: snapshots written before `occupation_data_fallback` existed carry
`general_labor_market`, whose original meaning ("scored on the metro-wide labour
market") is still true, and they keep parsing unchanged.

### Housing Fit

`benchmarkRent` is the ACS bedroom-specific median for the size the user asked
for — `studio → studio_rent`, `one → one_bedroom_rent`, … `four_plus →
four_bedroom_rent`. ACS B25031 publishes nothing above "4 bedrooms", so
`four_plus` maps there rather than pretending a five-bedroom estimate exists.

```
score = percentile(benchmarkRent, cheaper is better) × budgetAlignmentFactor
```

The budget view is a **multiplier, not a second addend**, so a user whose budget
comfortably covers a metro sees exactly the v1 percentile; only metros that
stretch the budget are pulled down. The factor runs continuously from 1.0 (rent
at or below budget) to 0.5 (rent at 1.5× budget, the hard filter's ceiling) —
no cliffs, and not zero, because a metro at 1.49× is a stretch rather than a
non-option.

**Fallback.** If the user stated no size, or ACS publishes no figure for that
size in that metro, the benchmark falls back to the overall median gross rent
and `basis` records `overall_median`. A metro is never excluded merely because
one bedroom-specific value is absent.

The **hard budget filter is bedroom-aware** by the same rule: it filters on
whichever benchmark was resolved, so a 3-bedroom seeker and a studio seeker can
get different eligible sets from identical data.

### Climate Fit

The universal 57 °F target is gone. Bands are anchored to the observed
distribution across the 99 metros with NOAA data:

```
min 45.5    p25 52.2    median 59.1    p75 66.0    max 77.3
```

| Preference     | Band     | Metros in band |
| -------------- | -------- | -------------- |
| `warm`         | ≥ 66 °F  | 25             |
| `mild`         | 55–65 °F | 37             |
| `four_seasons` | 47–57 °F | —              |
| `cool`         | ≤ 52 °F  | 22             |

Inside the band scores 100; outside, the score falls linearly with distance
from the nearest edge, reaching 0 at 20 °F away. Bands are deliberately coarse:
an annual mean is one summary statistic, and a threshold quoted to a tenth of a
degree would imply precision it does not carry.

**Honest caveat on `four_seasons`.** Seasonality is a spread, not a mean, and
the scored dataset holds only the annual mean. That band is the best available
proxy — metros with cold winters and warm summers cluster there — not a
measurement of how distinct the seasons are. Fixing it properly needs monthly
normals, which Phase 6A deliberately does not ingest.

Because the app cannot measure seasonality, it does not say that it has. The
onboarding hint tells the user matching compares annual average temperature and
that "four distinct seasons" is approximated from it, and the deterministic
explanation for this preference is worded separately from the others:

> Annual mean temperature: 51.2 °F, which sits in the range typical of metros
> with distinct seasons (annual averages only, so this approximates seasonal
> variation rather than measuring it) — scores 100/100 against the other
> candidates.

The other four preferences keep the ordinary "matches the … climate you asked
for" phrasing, because for those an annual mean is a fair summary of what was
asked.

**`no_preference` — and a legacy profile never asked — removes climate from the
score.** Its weight is taken out _before_ normalisation and redistributed
proportionally across the priorities the user does hold. The alternatives are
both wrong: scoring every metro 50 invents a measurement, and treating it as
missing data would count against coverage and could drop metros below the
coverage floor for someone who simply does not care about weather.

### Legacy profiles

Both new columns are nullable with no default, so every profile created before
this migration stays valid: no bedroom preference → overall median rent; no
climate preference → climate waived; no confirmed occupation → general labour
market career score.

### Worked example

A user weights career 0.9 and housing 0.6, everything else 0, wants **one**
bedroom, prefers **warm**, budget **$2,000/mo**. Climate is stated, so nothing
is waived. Normalised top-level weights: career 0.6, housing 0.4.

Metro X, occupation Software Developers — every OEWS field published:

```
median wage        $130,000  → percentile 88  × 0.30 = 26.4
location quotient      1.60  → percentile 92  × 0.25 = 23.0
jobs per 1,000        22.0   → percentile 90  × 0.25 = 22.5
employment depth  log1p(6000)→ winsorised 71  × 0.10 =  7.1
unemployment rate      3.4%  → percentile 79  × 0.10 =  7.9
                                  Career Fit  = 86.9   (basis: occupation_specific, coverage 1.0)

1-bedroom rent      $1,100  → percentile 74
                              budget factor 1.0 (1,100 ≤ 2,000)
                                 Housing Fit = 74.0   (basis: bedroom_specific)

annual mean          71 °F  → inside the warm band → 100, but climate weight is 0

DreamScore = 86.9 × 0.6 + 74.0 × 0.4 = 52.1 + 29.6 = 81.7  → displayed 82 / 100
```

Had BLS suppressed the wage, the remaining three occupational indicators still
clear the threshold: the surviving weights renormalise to 0.357/0.357/0.143/0.143,
`coverage` drops to 0.70, `basis` stays `occupation_specific`, and
`evidenceConfidence` stays 1.0 — so the Career Fit above is already the
effective score. Had only the location quotient survived, `basis` would fall
back to `occupation_data_fallback`, the score would rest on the unemployment
percentile alone, and that percentile would then be multiplied by 0.65: an
86.9-percentile unemployment rate would enter DreamScore as 56.5, not 86.9. Had
this user named no occupation at all, the same metro would score
`general_labor_market` at the full 86.9 — nothing was substituted, so nothing is
discounted.

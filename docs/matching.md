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

| Dimension  | Raw metric                                                                   | Source                                        | Period              | Geography           | Unit     | Direction             | Normalisation          |
| ---------- | ---------------------------------------------------------------------------- | --------------------------------------------- | ------------------- | ------------------- | -------- | --------------------- | ---------------------- |
| career     | Unemployment rate (B23025: unemployed ÷ civilian labour force)               | Census ACS 5-Year                             | 2019–2023           | CBSA                | percent  | lower is better       | percentile             |
| housing    | Median gross rent (B25064)                                                   | Census ACS 5-Year                             | 2019–2023           | CBSA                | $/month  | lower is better       | percentile             |
| cost       | Median gross rent as a share of household income (B25071)                    | Census ACS 5-Year                             | 2019–2023           | CBSA                | percent  | lower is better       | percentile             |
| education  | Bachelor's degree or higher, adults 25+ (B15003)                             | Census ACS 5-Year                             | 2019–2023           | CBSA                | percent  | higher is better      | percentile             |
| transport  | Mean travel time to work (B08013 ÷ B08303)                                   | Census ACS 5-Year                             | 2019–2023           | CBSA                | minutes  | lower is better       | percentile             |
| healthcare | Population without health insurance (B27001)                                 | Census ACS 5-Year                             | 2019–2023           | CBSA                | percent  | lower is better       | percentile             |
| climate    | Annual mean temperature                                                      | NOAA U.S. Climate Normals                     | 1991–2020           | **weather station** | °F       | user's preferred band | band distance          |
| safety     | Violent and property crime rates (CIUS Table 6)                              | FBI UCR, CIUS 2025                            | 2025                | CBSA (MSA)          | per 100k | lower is better       | composite              |
| family     | Public schools per 10,000 residents aged 5–17, plus three reused dimensions  | NCES EDGE + Census ACS 5-Year                 | 2024–25 / 2019–2023 | CBSA                | index    | higher is better      | composite              |
| social     | Places per 100,000 residents across lifestyle categories, plus total breadth | Overture Maps Places + Census TIGER/Line CBSA | 2026-08-19.0 / 2025 | CBSA                | index    | higher is better      | personalized composite |

**Geography caveat.** Eight of the nine metrics are genuinely CBSA-level. Climate
is not: NOAA publishes per-station normals, so each metro is matched to the
nearest airport station that publishes an annual mean. That mismatch is recorded
in the data — the NOAA source row carries `geography_level = 'station'` rather
than `'cbsa'` — instead of being hidden in a comment.

**Metric naming.** Each label states what the source measures. `rent_share_of_income`
is a rent burden, not an "affordability score"; the transformation into a score
happens in the engine, never in the metric name.

### Dimensions collected but not scored

None. Onboarding collects ten priorities and, as of Phase 6C, every one has a
measurement behind it — safety and family arrived in Phase 6B, social in 6C.

The machinery for an unscored dimension is deliberately kept. It still applies
per metro: a city missing a measurement is treated as missing data, which
reduces its coverage and redistributes that weight, and is never scored as
zero.

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

## Safety and Family (Phase 6B, v2.1)

Safety and family friendliness were selectable priorities from the start, with
nothing behind them: a user who cared about either had that weight
redistributed to dimensions they cared about less. Both are now measured, which
is why the algorithm version moved to **v2.1** — no existing dimension changed
definition, but rankings move for anyone who weighted either.

### Safety Fit

**Source.** FBI Uniform Crime Reporting Program, _Crime in the United States
2025_ (CIUS 2025), published within the finalised annual release _Reported
Crimes in the Nation, 2025_. Specifically **Table 6, "Crime in the United
States, by Metropolitan Statistical Area"**. The release covers 17,075 agencies
representing 96.2% of the population served by agencies eligible to participate;
the submission deadline was 1 April 2026, so this is the finalised annual
product, not a preliminary or quarterly release.

**Geography.** Metropolitan Statistical Area — the same CBSA unit as every other
metric here.

**Why Table 6 specifically.** It publishes the FBI's own aggregate rate per
100,000 inhabitants for each MSA. That is the only defensible metro figure
available, and the pipeline deliberately refuses the two obvious alternatives:

- **Not summed from agencies.** Adding police departments, sheriffs, university
  and state agencies from the agency-level tables double counts overlapping
  jurisdictions and mixes incompatible population denominators.
- **Not a principal city.** Table 6 prints `City of X` rows precisely so they can
  be read separately; the pipeline ignores every one of them. Bridgeport-Stamford
  -Danbury is the clearest example: its three named cities sum to 722 violent
  offences while the metro total is 896.

Metropolitan Divisions (`M. D.`) are subdivisions of an MSA and are skipped for
the same double-counting reason — 28 of them in the 2025 table.

**Formula.**

```
violentSafety  = inverse percentile(violent crime rate)     lower rate ranks better
propertySafety = inverse percentile(property crime rate)

Safety Fit = 0.70 × violentSafety + 0.30 × propertySafety
```

Percentile rank against the eligible candidate set, exactly as every other
percentile dimension. Violent crime leads because it is the harm people are
actually weighing, and because property crime is far more common and would
otherwise dominate a combined figure by sheer volume. **70/30 is a
product-design choice, not an empirically derived one**, and it is a sub-weight:
it decides what "safety" means, never how much safety counts. That remains the
user's own slider.

**Missing data.** An unpublished rate is absence, never zero — scoring it as
zero would rank a metro the FBI said nothing about as the safest in the country.
A metro with one rate has the component weights renormalised over the survivor
and `coverage` records that only 70% (or 30%) of the intended weight had data
behind it. A metro with neither rate scores `null` and falls into the ordinary
missing-dimension redistribution.

**Metro mapping.** Table 6 carries MSA names, not CBSA codes, so names are
normalised conservatively — case, whitespace, and the trailing `M. S. A.`
suffix and footnote marker only. No token dropping, no abbreviation expansion,
no edit-distance matching. An unmatched metro stays unmatched and is listed by
name in `data/processed/safety-coverage.json`; a duplicate normalised name
aborts the pipeline rather than picking a winner.

**Coverage: 87 of 100 candidate metros.** The 13 unmatched are genuinely absent
from Table 6, verified by token search rather than assumed — nine are in Florida,
which the table's own footnote flags ("Limited data for 2025 were available for
Florida and North Dakota"), and the rest (New York, Grand Rapids, New Orleans,
Baton Rouge, Worcester, Greensboro) published no MSA estimate. Of the 87 matched,
55 include FBI estimation for agencies that did not report a full year and 32 are
fully reported; the distinction is stored per metro and stated in the
explanation.

**Limitations.**

- A metro spans millions of people and enormous internal variation. These rates
  describe an entire metropolitan area and say **nothing** about a neighbourhood,
  a street, or an individual's risk.
- Reported crime is crime reported to and recorded by police, not crime that
  occurred.
- Estimated figures involve FBI modelling for non-reporting agencies; a metro
  with lower reporting coverage carries more of it.
- New York, the largest metro in the candidate set, has no safety score at all.

### Family Fit

**Family Fit is a DreamDestination composite. It is not an official
government-defined family-friendliness statistic**, and no such statistic exists.
It aggregates four conditions that plausibly matter to a household with
children, each from a published federal source:

```
Family Fit = 0.50 × public-school availability
           + 0.30 × Safety Fit
           + 0.10 × commute suitability
           + 0.10 × healthcare coverage
```

**The 50/30/10/10 split is a product-design decision, not an empirically learned
or validated model, and must never be presented as scientifically optimal.**
Like safety's 70/30 it is a sub-weight: it decides what "family friendliness"
means, not how much it counts.

**School availability is not school quality.** The school component comes from
**NCES EDGE Public School Locations, 2024–25** (Common Core of Data geocodes).
NCES publishes _where public schools are_. It publishes nothing about quality,
achievement, test scores, rankings, teaching, or graduation. No label anywhere in
this product may imply otherwise.

```
schoolAccessRate = publicSchoolCount / schoolAgePopulation × 10,000
```

- **Numerator**: distinct `NCESSCH` identifiers whose `CBSA` field matches the
  metro. The join is on **CBSA identifiers, never city names** — the EDGE file
  carries a CBSA code per school under OMB July 2023 definitions, the same
  geography this project already uses. All 100 metros join with zero name
  disagreements, which is the strongest available confirmation that the two
  vintages agree. De-duplicating on `NCESSCH` before counting means a repeated
  row cannot inflate a metro; the 2024–25 file contains no duplicates.
- **Denominator**: **ACS 2019–2023 5-year table B01001**, cells
  `B01001_E004/005/006` (male 5–9, 10–14, 15–17) and `B01001_E028/029/030`
  (female 5–9, 10–14, 15–17). Verified against the official Census metadata at
  `api.census.gov/data/2023/acs/acs5/groups/B01001.json` rather than assumed.
  15–17 rather than 15–19 because B01001 splits there and 18–19 year olds have
  mostly left school.

A zero or unpublished denominator produces a missing rate, never `Infinity` and
never zero.

The EDGE geocode file carries **no open/closed status column**, so no status
filtering is applied — inventing one would be a rule the source does not support.

**Evidence confidence.** Renormalising over the surviving components gives the
best estimate the available evidence supports — but it lands on the same 0–100
axis as a fully covered metro, which makes the two look comparable when they are
not. Grand Rapids scored 92.6 against Madison's 93.8, yet the FBI published no
2025 estimate for it, so its composite was really 71.4% school access / 14.3%
commute / 14.3% healthcare rather than the intended 50/30/10/10.

So the composite is scaled by the share of intended weight that had data:

```
evidenceConfidence = coverage
effectiveScore     = rawScore × evidenceConfidence
```

| Missing component | `coverage` |
| ----------------- | ---------- |
| none              | 1.00       |
| safety            | 0.70       |
| commute           | 0.90       |
| healthcare        | 0.90       |
| safety + commute  | 0.60       |

`detail.rawScore` keeps the unscaled estimate; `score` is what DreamScore
consumes and what ranks the city. **A fully covered metro is numerically
unchanged**, since `coverage = 1`.

**`evidenceConfidence` is not a statistical confidence, not a probability, not a
claim about how family-friendly a metro is, and not a claim that a metro missing
FBI data is unsafe.** It answers one question: what share of the evidence this
composite is supposed to use was available here. Grand Rapids at
92.6 × 0.70 = 64.8 means the intended evidence was incomplete — **not** that the
metro was measured to be 30% worse.

The adjustment is applied to the finished composite, never to a component, so
renormalisation still produces the best available estimate and only its ranking
influence is reduced. It does not touch the user's top-level Family weight,
which remains entirely theirs. Standalone **Safety Fit carries no such
adjustment** — all 87 matched metros publish both rates, so its renormalisation
path never fires on the real dataset.

**Minimum evidence rule.** School access is the only family-specific signal here,
so Family Fit **requires** it, plus at least one of safety, commute or
healthcare. Without school evidence the score is `null`. A "family fit" computed
purely from safety, commute and healthcare would be a relabelling of three
dimensions the user already weights individually, presented as a measurement.
Missing secondary components are renormalised across what survives, and
`coverage` records how much of the intended weight had data.

**Deliberate overlap.** Safety, commute and healthcare are also standalone
dimensions. A user who weights both Safety and Family counts safety twice — once
directly, once inside the composite. That is intended: they told us both things
matter. Silently dropping a component because it appears elsewhere would mean a
user's stated priorities no longer add up to what they asked for. Family Fit
reuses the finished Safety Fit rather than recomputing crime, so the two can
never disagree.

**No inferred intent.** Family Fit is never switched off because a profile says
`children = 0`. That field does not say whether someone is planning a family,
moving near relatives, or simply wants family-oriented surroundings. The user's
explicit Family priority weight is the only thing that decides how much Family
Fit matters. Household size and bedrooms remain Housing Fit's business.

**Coverage: 100 of 100 metros** have a school-access rate; 87 have all four
components and 13 score on three because the FBI published no crime estimate for
them.

**Limitations.**

- A count of schools is availability, not quality. A metro with many small
  schools scores higher than one with fewer large ones — Minneapolis (25.0 per
  10k, ~400 school-age residents per school) versus Atlanta (10.6, ~940) is a
  real difference in how states organise districts, not a judgement about
  either.
- Private and charter-outside-CCD schools are not counted.
- Schools are located in a metro, not necessarily near any particular home in
  it.
- Three of the four components are metro-wide conditions rather than
  family-specific ones.

### Algorithm version

`MATCHING_ALGORITHM_VERSION` moved `v2` → **`v2.1`**. A minor bump because no
existing dimension's definition changed — two previously unscored ones were
filled in.

`recommendations.algorithm_version` previously enforced `^v[0-9]+$`, which would
have rejected `v2.1`. The constraint was widened to
`^v[0-9]+(\.[0-9]+)?$`. The change is purely additive: every stored value (`v1`,
`v2`) still matches, so **no historical snapshot is invalidated or rewritten**,
and malformed input is still rejected.

## Lifestyle Fit (Phase 6C, v2.2)

Social was the last priority onboarding collected with nothing behind it. It is
now measured from how many places of each kind a metro contains, and the user
can say which kinds they care about.

**Source.** [Overture Maps Places](https://docs.overturemaps.org/guides/places/),
release **`2026-08-19.0`** (schema `v1.18.0`), read directly from the
foundation's public S3 bucket. The release was verified against the official
release calendar as the current _published_ release rather than taken from the
schedule — proposed dates appear there before their data exists — and is pinned
so a re-run reproduces the same dataset.

**Why not a places API.** Google Places Nearby Search, Yelp and Foursquare all
search a circle rather than a polygon, cap the radius, cap results per request
and rank what they return. None can give an exhaustive metro-wide count, so
none can support a comparison between metros. This is an offline ingestion
pipeline; **the recommendation runtime never calls a places API.**

**Geography.** Census **TIGER/Line 2025** CBSA boundaries — the full boundary
rather than the cartographic generalisation, which at 35 MB was entirely
practical. Each Overture place is a point, assigned to a metro by `ST_Within`
against the official polygon and joined on `CBSAFP`, the same five-digit code
DreamDestination already stores. **All 100 candidate metros matched by code.**

No radius from a metro centre, no city limits, no principal-city boundary, no
county-name guessing, no geocoding, no fuzzy matching. A point outside every
polygon belongs to no metro.

### Classification

Places are classified on **`basic_category`** under Overture's current taxonomy.
The deprecated `categories` property is not read anywhere — Overture is removing
it. `taxonomy.hierarchy` is recorded per mapped category as a guard: if Overture
moves a category to a different root, the extractor reports it rather than
silently reclassifying.

The mapping lives in
[`scripts/lifestyle/taxonomy-mapping.json`](../scripts/lifestyle/taxonomy-mapping.json)
— **89 Overture categories across 8 product buckets**, each entry naming a value
verified to exist in the pinned release.

| Category             | What it covers                                             |
| -------------------- | ---------------------------------------------------------- |
| `food_drink`         | Eating and non-alcoholic drinking places                   |
| `nightlife`          | Drinking venues and late-evening entertainment             |
| `arts_culture`       | Museums, galleries, historic sites, cultural centres       |
| `live_entertainment` | Performance, screening and event venues                    |
| `parks_outdoors`     | Open space and natural features                            |
| `fitness_recreation` | Built places to exercise and play sport                    |
| `shopping`           | Retail people choose to visit                              |
| `community_spaces`   | **Narrowed** — community centres, public plazas, libraries |

**Exclusivity is structural, not a precedence rule.** Overture assigns each
place exactly one `basic_category`, and each `basic_category` appears in exactly
one bucket, so a place can never be counted in two buckets or twice in one. No
substring matching, and a venue's _name_ is never used to infer its category.

Two mapping decisions worth naming, both grounded in Overture's own hierarchy
rather than intuition:

- **Nightlife spans two Overture roots.** Overture files `bar`, `brewery`,
  `winery`, `distillery` and `lounge` under `food_and_drink →
alcoholic_beverage_venue`, while `dance_club` and `nightlife_venue` sit under
  `arts_and_entertainment`. The product bucket deliberately gathers both, and
  `food_drink` is correspondingly the non-alcoholic remainder.
- **`community_spaces` is narrowed and says so.** Overture has no broad
  "community space" concept; its community root is dominated by civic
  organisations and government offices, which are organisations rather than
  places people go. The bucket covers only community centres, public plazas and
  libraries, which is why its counts are an order of magnitude smaller than the
  others. Source truth won over the product wish.

**Filtering**, from the observed national distribution rather than invented
thresholds:

| Rule                                     | Effect                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `operating_status` excluded              | `permanently_closed` (371,808) and `temporarily_closed` (21)                    |
| `operating_status` **kept**              | `null` (6.8M, 38%) — Overture does not know, and dropping it would gut coverage |
| `confidence = 0` excluded                | 126 places; Overture defines this as _certain_ the place no longer exists       |
| No other confidence threshold            | A cut at 0.5 would have dropped 3.1M places (17%) on no stated basis            |
| Duplicate ids                            | Counted once; the release contained **0 duplicates**                            |
| Missing geometry or id                   | Excluded (none observed)                                                        |
| `basic_category` absent from the mapping | Unclassified — enters no bucket                                                 |

**Only derived metro-level counts are stored.** No raw Overture place record is
committed or persisted.

### Category subscores

```
placesPer100k         = uniquePlaceCount / metroPopulation × 100,000
breadthPercentile     = percentile(uniquePlaceCount,  higher is better)
perCapitaPercentile   = percentile(placesPer100k,     higher is better)

categoryScore = 0.40 × breadthPercentile + 0.60 × perCapitaPercentile
```

Population is the ACS metro population DreamDestination already stores; no
additional population source was fetched. A non-positive population is rejected
rather than divided by.

Percentile rank against the eligible candidate set, as everywhere else. `log1p`
is deliberately **not** applied before ranking: percentile rank is
order-preserving, so a monotone transform would change nothing and be purely
decorative.

Both signals are needed and they disagree. Raw counts alone would hand every
category to New York, Los Angeles and Chicago for being large; per-capita alone
would hand it to whichever small metro has a high ratio. **The 40/60 split is a
product-design choice, not an empirically learned coefficient**, and it is a
sub-weight: it decides what "lifestyle" means, never how much Social counts.

### Personalised and general bases

| Basis                    | When                            | What is scored                                        |
| ------------------------ | ------------------------------- | ----------------------------------------------------- |
| `personalized_lifestyle` | one or more categories selected | the equal-weight mean of the selected category scores |
| `general_lifestyle`      | none selected, or never asked   | the equal-weight mean across every supported category |

Equal weight because the UI collects _which_ categories matter, not how much
each matters relative to the others. Inventing a relative strength would put
words in the user's mouth.

**`general_lifestyle` is not a penalty.** It is the intended measurement for
someone who expressed no particular preference, in exactly the way
`general_labor_market` is the intended answer for a user who named no
occupation. A legacy profile that predates this phase, and a profile that was
asked and selected nothing, both get it and neither is discounted.

### Missing evidence

A **measured zero is evidence, not a gap**: a metro with no comedy clubs has
been measured, not missed, and is scored at the bottom of that category. Only a
category with no usable measurement at all reduces coverage.

```
rawScore           = mean of the category scores that could be measured
coverage           = measured categories / requested categories
evidenceConfidence = coverage
effectiveScore     = rawScore × evidenceConfidence
```

DreamScore consumes the effective score, following the Career and Family
precedent. A fully covered score is numerically unchanged. If none of the
requested categories can be measured, Lifestyle Fit is `null` and the ordinary
missing-dimension redistribution applies.

`basis`, `rawScore`, `score`, `coverage`, `evidenceConfidence` and the
per-category detail are all persisted in `reason_json`.

### Coverage

|                                 |           |
| ------------------------------- | --------- |
| Candidate metros                | 100       |
| Matched to a CBSA polygon       | **100**   |
| Metros with a Lifestyle Fit     | **100**   |
| Classified US places considered | 6,292,806 |
| Duplicate ids collapsed         | 0         |
| Places inside candidate metros  | 2,959,370 |
| Metro/category rows             | 800       |
| Zero-count rows                 | **0**     |

### Limitations

- **A count is availability, not quality.** It says nothing about whether the
  venues are good, popular, well reviewed or worth visiting.
- Counts do not measure popularity, ratings or customer satisfaction.
- Per-capita supply is **not walkability**. It says how much exists per
  resident, not how easily anyone can reach it.
- A CBSA is a large area containing dense urban, suburban and rural parts. A
  metro-wide count cannot speak to any one neighbourhood, and says nothing
  about what would be near the user's eventual home.
- Overture coverage varies geographically and by category; a low count can mean
  fewer venues or thinner source coverage, and the data cannot distinguish
  them.
- The source may lag real openings and closures, and 38% of places carry no
  `operating_status` at all.
- The category buckets are **DreamDestination product definitions**, not
  Overture concepts. `community_spaces` in particular is narrower than the
  phrase suggests.
- The 40/60 breadth/per-capita weighting is a design choice, not a learned
  model.

### Licensing and attribution

**Overture Places is not published under a single licence.** It aggregates
upstream datasets under different terms, and describing the whole release as
CDLA Permissive 2.0 would be wrong:

| Licence             | Upstream sources                                             |
| ------------------- | ------------------------------------------------------------ |
| CDLA Permissive 2.0 | Meta, Microsoft, PinMeTo, Krick, RenderSEO, DAC, BrightQuery |
| Apache 2.0          | **Foursquare**                                               |
| CC0 1.0             | AllThePlaces                                                 |

Foursquare data carries the notice **"Copyright 2024 Foursquare Labs, Inc. All
rights reserved."**, with full terms in `NOTICE.txt` at
[opensource.foursquare.com](https://opensource.foursquare.com). The
authoritative and current breakdown is Overture's own
[attribution page](https://docs.overturemaps.org/attribution/); it is linked
rather than restated so it cannot drift out of date here.

**What DreamDestination publishes.** Not Overture records — _DreamDestination-derived
aggregate metro/category statistics_ built from the pinned release. Only counts
and rates per metro per category are stored; no raw place record is committed or
persisted anywhere in this repository.

**No row-level attribution is claimed.** The extraction aggregates to
metro/category counts and does not retain each place's `sources` field, so
DreamDestination cannot say which upstream provider contributed any particular
count. Upstream licensing is therefore documented at release level and pointed
at the official page. Fabricating per-record attribution the extraction never
preserved would be worse than declining to.

The citation for publications using Overture data is
**Overture Maps Foundation, overturemaps.org**. The same information is recorded
in the seeded `metric_sources` row and in
`data/processed/lifestyle-provenance.json`.

### Algorithm version

`MATCHING_ALGORITHM_VERSION` moved `v2.1` → **`v2.2`**. The format constraint on
`recommendations.algorithm_version` already accepts an optional minor component
(widened in Phase 6B), so no schema change was needed and **`v1`, `v2` and
`v2.1` snapshots remain readable and are never rewritten**.

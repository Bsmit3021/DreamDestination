/**
 * Title normalisation for occupation matching.
 *
 * Deliberately conservative. It folds away formatting noise — case,
 * punctuation, spacing, a few grammatical particles — and nothing else.
 * Stripping domain words like "software" or "nurse" would collapse genuinely
 * different occupations into each other, which is exactly the failure mode
 * occupation matching has to avoid.
 */

/**
 * Particles that carry no occupational meaning on their own.
 *
 * Note what is absent: no industry terms, no seniority terms. "Senior" and
 * "lead" are kept, because dropping them silently rewrites what the user typed.
 * They simply fail to match any O*NET token and cost a little overlap score.
 */
const STOP_WORDS = new Set(["a", "an", "the", "of", "and", "or", "for", "in"]);

/**
 * Reduces a plural token to its singular form.
 *
 * This is load-bearing, not a nicety. SOC and O*NET publish occupations in the
 * plural ("Registered Nurses", "Electricians", "Software Developers") while
 * people describe themselves in the singular. Without this, "registered nurse"
 * never exactly matches "Registered Nurses"; it degrades to a partial word
 * match and can lose to an unrelated occupation on a tiebreak.
 *
 * Deliberately a small set of well-understood English rules rather than a
 * stemmer: it must be predictable and reversible by eye. Short tokens and
 * double-s endings are left alone so "business" does not become "busines".
 */
export function singularize(token: string): string {
  if (token.length <= 3) return token;

  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (/(ss|ch|sh|x|z)es$/.test(token)) {
    return token.slice(0, -2);
  }
  if (token.endsWith("ss")) {
    return token;
  }
  if (token.endsWith("s")) {
    return token.slice(0, -1);
  }

  return token;
}

/**
 * Lower-cases, strips accents and punctuation, collapses whitespace and
 * singularises each word.
 *
 * `Sr. Software Engineers, II` -> `sr software engineer ii`
 */
export function normalizeTitle(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      // Keep alphanumerics; everything else becomes a separator. This turns
      // "front-end" and "front end" into the same thing.
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .map(singularize)
      .join(" ")
  );
}

/** Normalised title split into meaningful tokens. */
export function tokenize(value: string): string[] {
  return normalizeTitle(value)
    .split(" ")
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

/**
 * Overlap between a user's tokens and a candidate title's tokens.
 *
 * Asymmetric on purpose: the denominator is the *query* token count, so
 * "software engineer" scores highly against "software engineers, applications"
 * rather than being penalised for the candidate's extra words. Matching a long
 * official title should not require the user to type it in full.
 *
 * Returns 0 when either side has no tokens.
 */
export function tokenOverlap(query: string, candidate: string): number {
  const queryTokens = tokenize(query);
  const candidateTokens = new Set(tokenize(candidate));

  if (queryTokens.length === 0 || candidateTokens.size === 0) {
    return 0;
  }

  let matched = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      matched += 1;
    }
  }

  return matched / queryTokens.length;
}

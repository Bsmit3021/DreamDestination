/**
 * Turns the O*NET text database into the canonical occupation taxonomy.
 *
 *   npm run data:occupations:transform
 *
 * O*NET-SOC codes are more granular than SOC: `15-1252.00` and `15-1252.01`
 * both roll up to SOC `15-1252`. The base code is taken as the SOC, which is
 * the documented relationship — but the result is treated as a *candidate*, not
 * a fact. Whether OEWS actually publishes that SOC is established empirically
 * by the career pipeline, never assumed from the shape of the string.
 *
 * Attribution: O*NET data is published by the U.S. Department of Labor,
 * Employment and Training Administration, under CC BY 4.0.
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeTitle } from "@/lib/occupations/normalize";

import { PROCESSED_DIR, RAW_DIR, log } from "../city-data/shared";

export interface ProcessedOccupation {
  socCode: string;
  title: string;
  description: string | null;
  onetCode: string;
}

export interface ProcessedOccupationTitle {
  socCode: string;
  title: string;
  normalizedTitle: string;
  kind: "primary" | "reported";
}

const OCCUPATIONS_FILE = path.join(PROCESSED_DIR, "occupations.json");
const TITLES_FILE = path.join(PROCESSED_DIR, "occupation-titles.json");

/** `15-1252.00` -> `15-1252`. Returns null if the code is not O*NET-shaped. */
function socFromOnet(onetCode: string): string | null {
  const match = /^(\d{2}-\d{4})\.\d{2}$/.exec(onetCode.trim());
  return match ? match[1]! : null;
}

function parseTsv(text: string): string[][] {
  return text
    .split("\n")
    .slice(1)
    .map((line) => line.replace(/\r$/, "").split("\t"))
    .filter((columns) => columns.length >= 2 && columns[0] !== undefined);
}

async function main(): Promise<void> {
  const occupationText = await readFile(
    path.join(RAW_DIR, "onet-occupation-data.txt"),
    "utf8",
  );
  // O*NET 30.x replaced "Alternate Titles" with "Sample of Reported Titles":
  // job titles incumbents actually reported, rather than a curated synonym
  // list. Same purpose here — mapping how people describe their own job onto a
  // SOC code — but it is a different file with different columns, so it is
  // recorded as `reported` rather than mislabelled `alternate`.
  const reportedText = await readFile(
    path.join(RAW_DIR, "onet-reported-titles.txt"),
    "utf8",
  );

  // --- occupations ---------------------------------------------------------

  const occupations = new Map<string, ProcessedOccupation>();
  let skippedNonSoc = 0;

  for (const columns of parseTsv(occupationText)) {
    const [onetCode, title, description] = columns;
    if (!onetCode || !title) continue;

    const socCode = socFromOnet(onetCode);
    if (!socCode) {
      skippedNonSoc += 1;
      continue;
    }

    // Many O*NET detail occupations share a SOC. Prefer the `.00` record,
    // which is the one whose title matches the SOC title.
    const existing = occupations.get(socCode);
    const isBase = onetCode.trim().endsWith(".00");

    if (!existing || isBase) {
      occupations.set(socCode, {
        socCode,
        title: title.trim(),
        description: description?.trim() || null,
        onetCode: onetCode.trim(),
      });
    }
  }

  // --- titles --------------------------------------------------------------

  const titles = new Map<string, ProcessedOccupationTitle>();

  const addTitle = (
    socCode: string,
    title: string,
    kind: "primary" | "reported",
  ) => {
    const normalizedTitle = normalizeTitle(title);
    if (!normalizedTitle) return;

    const key = `${socCode}|${normalizedTitle}`;
    const existing = titles.get(key);

    // A primary title outranks a reported one with the same normalised form.
    if (!existing || (kind === "primary" && existing.kind === "reported")) {
      titles.set(key, { socCode, title: title.trim(), normalizedTitle, kind });
    }
  };

  for (const occupation of occupations.values()) {
    addTitle(occupation.socCode, occupation.title, "primary");
  }

  // Sample of Reported Titles columns:
  //   O*NET-SOC Code | Reported Job Title | Shown in My Next Move
  let reportedSkipped = 0;
  for (const columns of parseTsv(reportedText)) {
    const [onetCode, reportedTitle] = columns;
    if (!onetCode || !reportedTitle) continue;

    const socCode = socFromOnet(onetCode);
    if (!socCode || !occupations.has(socCode)) {
      reportedSkipped += 1;
      continue;
    }

    addTitle(socCode, reportedTitle, "reported");
  }

  await mkdir(PROCESSED_DIR, { recursive: true });
  await writeFile(
    OCCUPATIONS_FILE,
    `${JSON.stringify([...occupations.values()], null, 2)}\n`,
  );
  await writeFile(
    TITLES_FILE,
    `${JSON.stringify([...titles.values()], null, 2)}\n`,
  );

  const primary = [...titles.values()].filter(
    (t) => t.kind === "primary",
  ).length;

  log("O*NET -> canonical occupation taxonomy");
  log(`  SOC occupations:        ${occupations.size}`);
  log(
    `  searchable titles:      ${titles.size} (${primary} primary, ${titles.size - primary} reported)`,
  );
  log(`  non-SOC O*NET rows:     ${skippedNonSoc}`);
  log(`  reported titles w/o SOC: ${reportedSkipped}`);
  log("Next: npm run data:occupations:seed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

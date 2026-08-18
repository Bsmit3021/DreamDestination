/**
 * Downloads the O*NET text database and extracts the two files the occupation
 * taxonomy needs.
 *
 *   npm run data:occupations:fetch
 *
 * Writes to `data/raw/`, which is gitignored — reproducible by re-running.
 *
 * Attribution: O*NET is published by the U.S. Department of Labor, Employment
 * and Training Administration, under CC BY 4.0. It is used here solely for the
 * occupation taxonomy and job titles; O*NET is never the source of a wage or
 * employment figure.
 */

import { spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { RAW_DIR, log } from "../city-data/shared";

/** Pinned so a silent upstream release cannot change results underneath us. */
export const ONET_VERSION = "30.3";
const ONET_SLUG = "db_30_3_text";
const ONET_URL = `https://www.onetcenter.org/dl_files/database/${ONET_SLUG}.zip`;

/**
 * Files to extract, mapped to the stable local names the transform reads.
 *
 * O*NET 30.x replaced `Alternate Titles.txt` with `Sample of Reported
 * Titles.txt`. The local name records which one we actually consumed, so a
 * future release renaming things again fails visibly at extraction rather than
 * quietly producing an empty title index.
 */
const WANTED: { member: string; localName: string }[] = [
  {
    member: `${ONET_SLUG}/Occupation Data.txt`,
    localName: "onet-occupation-data.txt",
  },
  {
    member: `${ONET_SLUG}/Sample of Reported Titles.txt`,
    localName: "onet-reported-titles.txt",
  },
];

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function main(): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });

  const zipPath = path.join(RAW_DIR, `onet-${ONET_VERSION}.zip`);

  log(`Downloading O*NET ${ONET_VERSION}…`);
  const response = await fetch(ONET_URL, {
    headers: { "User-Agent": "DreamDestination-data-pipeline" },
  });
  if (!response.ok) {
    throw new Error(`O*NET download failed: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(zipPath, bytes);
  log(`  ${(bytes.length / 1_048_576).toFixed(1)} MB`);

  for (const { member, localName } of WANTED) {
    // -j flattens the archive directory; -o overwrites a previous run.
    await run("unzip", ["-o", "-j", zipPath, member, "-d", RAW_DIR]);

    const extracted = path.join(RAW_DIR, path.basename(member));
    await rename(extracted, path.join(RAW_DIR, localName)).catch(() => {
      throw new Error(
        `Expected "${member}" in the O*NET archive. The release layout may ` +
          "have changed; check the file list before adjusting this script.",
      );
    });

    log(`  extracted ${path.basename(member)} -> ${localName}`);
  }

  log("Done. Next: npm run data:occupations:transform");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

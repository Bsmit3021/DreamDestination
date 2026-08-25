#!/usr/bin/env python3
"""
Step 2 of the lifestyle pipeline: Overture Places -> per-metro category counts.

    npm run data:lifestyle:extract

Reads the pinned Overture Places release directly from its public S3 bucket and
the Census TIGER/Line CBSA boundaries from `data/raw/`, and writes
`data/raw/lifestyle-counts.tsv`.

Why Python: same reason as the OEWS and CIUS extractors. This is the only step
that needs a geospatial engine, and DuckDB's Python package brings `spatial` and
`httpfs` with no dependency entering the Next.js project. Everything downstream
is TypeScript, as with the other pipelines. No GIS library is ever imported by
the application.

---------------------------------------------------------------------------
Why the whole dataset is never downloaded
---------------------------------------------------------------------------
Overture Places is ~10.5 GB of GeoParquet across 16 parts for this release.
Two things keep the extraction to a fraction of that:

  1. Column pruning. Parquet is columnar, so only id, geometry, basic_category,
     taxonomy.hierarchy, operating_status, confidence and bbox are read.
  2. Predicate pushdown on `bbox`. The files carry row-group statistics for the
     bounding box, so a US-only filter skips the rest of the planet without
     reading it, and the `basic_category IN (...)` filter drops most of the
     remaining rows before any geometry is touched.

---------------------------------------------------------------------------
Geography
---------------------------------------------------------------------------
Each place is a point. A point is assigned to a metro by ST_Within against the
official Census CBSA polygon for that metro, joined on CBSAFP — the same
five-digit code DreamDestination already stores as `cbsaGeoid`.

No radius from a metro centre, no city limits, no principal-city boundary, no
county-name guessing, no geocoding of metro names, no fuzzy matching of any
kind. If a point is not inside a polygon it belongs to no metro.
"""

import json
import sys
from datetime import date, timezone, datetime
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[2]
MAPPING_FILE = ROOT / "scripts/lifestyle/taxonomy-mapping.json"
CBSA_SHP = ROOT / "data/raw/tl_2025_us_cbsa/tl_2025_us_cbsa.shp"
CITIES_FILE = ROOT / "data/processed/cities.json"
OUTPUT = ROOT / "data/raw/lifestyle-counts.tsv"
AUDIT = ROOT / "data/raw/lifestyle-extraction-audit.json"

S3_BUCKET = "overturemaps-us-west-2"

# The 50 states plus DC. Every candidate metro lies inside this box; it exists
# only to let the parquet reader skip the rest of the world.
US_BBOX = {"xmin": -180.0, "xmax": -66.0, "ymin": 17.0, "ymax": 72.0}


def fail(message: str) -> None:
    print(f"  x {message}", file=sys.stderr)
    sys.exit(1)


def load_mapping() -> dict:
    if not MAPPING_FILE.exists():
        fail(f"{MAPPING_FILE} not found")
    return json.loads(MAPPING_FILE.read_text())


def main() -> None:
    mapping = load_mapping()
    release = mapping["overtureRelease"]
    version = mapping["version"]

    if not CBSA_SHP.exists():
        fail(f"{CBSA_SHP} not found. Run `npm run data:lifestyle:fetch` first.")

    # basic_category -> (bucket, expected root). One category maps to exactly
    # one bucket, so a place can never land in two.
    assignment: dict[str, tuple[str, str]] = {}
    for bucket, spec in mapping["categories"].items():
        for member in spec["members"]:
            bc = member["basicCategory"]
            if bc in assignment:
                fail(
                    f"basic_category '{bc}' is mapped to both "
                    f"'{assignment[bc][0]}' and '{bucket}'. Buckets must be exclusive."
                )
            assignment[bc] = (bucket, member["root"])

    print(f"  release {release}, mapping {version}, {len(assignment)} basic categories")

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2'; SET enable_progress_bar=false;")
    con.execute("SET memory_limit='6GB'; SET preserve_insertion_order=false;")

    con.execute(
        "CREATE TABLE mapping(basic_category VARCHAR, bucket VARCHAR, expected_root VARCHAR)"
    )
    con.executemany(
        "INSERT INTO mapping VALUES (?, ?, ?)",
        [(bc, b, r) for bc, (b, r) in assignment.items()],
    )

    cities = json.loads(CITIES_FILE.read_text())
    con.execute("CREATE TABLE candidates(cbsa VARCHAR, metro VARCHAR, population BIGINT)")
    con.executemany(
        "INSERT INTO candidates VALUES (?, ?, ?)",
        [(c["cbsaGeoid"], c["metro"], c["population"]) for c in cities],
    )

    # Candidate CBSA polygons only: 100 of the 935 the file contains.
    con.execute(
        f"""
        CREATE TABLE metro_polygons AS
        SELECT s.CBSAFP AS cbsa, c.metro, c.population, s.geom
        FROM ST_Read('{CBSA_SHP}') s
        JOIN candidates c ON c.cbsa = s.CBSAFP
        """
    )
    matched = con.execute("SELECT count(*) FROM metro_polygons").fetchone()[0]
    if matched != len(cities):
        missing = con.execute(
            "SELECT cbsa, metro FROM candidates WHERE cbsa NOT IN (SELECT cbsa FROM metro_polygons)"
        ).fetchall()
        fail(
            f"only {matched}/{len(cities)} candidate metros found in the CBSA "
            f"boundary file; missing {missing}"
        )
    print(f"  {matched}/{len(cities)} candidate metros matched to CBSA polygons")

    src = f"s3://{S3_BUCKET}/release/{release}/theme=places/type=place/*.parquet"

    # ---------------------------------------------------------------------
    # One pass. Filtering happens in this order on purpose: cheap scalar
    # predicates and the bbox first, the spatial join last, because ST_Within
    # against 100 multipolygons is the expensive part.
    #
    # operating_status: 'permanently_closed' is excluded. NULL is kept — it
    # means the status was never recorded, not that the place is shut, and
    # dropping it would discard roughly a third of US places for no reason the
    # source supports.
    #
    # confidence: Overture defines 0 as "certain the place no longer exists",
    # always paired with permanently_closed. Only that value is excluded; no
    # arbitrary threshold is imposed on top of the source's own semantics.
    # ---------------------------------------------------------------------
    con.execute(
        f"""
        CREATE TABLE places AS
        SELECT
          p.id,
          m.bucket,
          m.expected_root,
          p.basic_category,
          p.taxonomy.hierarchy[1] AS actual_root,
          ST_Point(p.bbox.xmin, p.bbox.ymin) AS pt
        FROM read_parquet('{src}') p
        JOIN mapping m ON m.basic_category = p.basic_category
        WHERE p.bbox.xmin BETWEEN {US_BBOX["xmin"]} AND {US_BBOX["xmax"]}
          AND p.bbox.ymin BETWEEN {US_BBOX["ymin"]} AND {US_BBOX["ymax"]}
          AND p.operating_status IS DISTINCT FROM 'permanently_closed'
          AND p.confidence > 0
          AND p.id IS NOT NULL
          AND p.geometry IS NOT NULL
        """
    )
    considered = con.execute("SELECT count(*) FROM places").fetchone()[0]
    print(f"  {considered:,} classified US places before the spatial join")

    if considered < 1_000_000:
        fail(
            f"only {considered} classified places found nationally; the schema or "
            "taxonomy changed and the output would be silently partial"
        )

    # A category that moved to a different taxonomy root is reported rather
    # than reclassified: the mapping was written against a specific hierarchy
    # and a move invalidates that reasoning.
    drift = con.execute(
        """
        SELECT basic_category, expected_root, actual_root, count(*) n
        FROM places
        WHERE actual_root IS NOT NULL AND actual_root <> expected_root
        GROUP BY 1,2,3 ORDER BY n DESC
        """
    ).fetchall()
    if drift:
        for bc, exp, act, n in drift:
            print(f"  ! {bc}: expected root {exp}, found {act} ({n:,})")
        fail(
            "Overture taxonomy roots no longer match the committed mapping. "
            "Re-audit scripts/lifestyle/taxonomy-mapping.json before seeding."
        )

    # Distinct ids: a place repeated across parts must not count twice.
    unique_ids = con.execute("SELECT count(DISTINCT id) FROM places").fetchone()[0]
    duplicates = considered - unique_ids
    print(f"  {unique_ids:,} unique ids ({duplicates:,} duplicate rows collapsed)")

    con.execute(
        """
        CREATE TABLE joined AS
        SELECT DISTINCT p.id, p.bucket, g.cbsa
        FROM places p
        JOIN metro_polygons g ON ST_Within(p.pt, g.geom)
        """
    )
    inside = con.execute("SELECT count(*) FROM joined").fetchone()[0]
    print(f"  {inside:,} places inside a candidate metro polygon")

    rows = con.execute(
        """
        SELECT c.cbsa, c.metro, m.bucket,
               coalesce(j.n, 0) AS place_count,
               c.population
        FROM candidates c
        CROSS JOIN (SELECT DISTINCT bucket FROM mapping) m
        LEFT JOIN (
          SELECT cbsa, bucket, count(DISTINCT id) n FROM joined GROUP BY 1,2
        ) j ON j.cbsa = c.cbsa AND j.bucket = m.bucket
        ORDER BY c.cbsa, m.bucket
        """
    ).fetchall()

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8") as handle:
        handle.write("cbsa\tmetro\tcategory\tplace_count\tpopulation\n")
        for cbsa, metro, bucket, count, population in rows:
            handle.write(f"{cbsa}\t{metro}\t{bucket}\t{count}\t{population}\n")

    AUDIT.write_text(
        json.dumps(
            {
                "overtureRelease": release,
                "overtureSchemaVersion": mapping["overtureSchemaVersion"],
                "taxonomyMappingVersion": version,
                "classifiedOn": mapping["classifiedOn"],
                "boundarySource": "Census TIGER/Line 2025 CBSA",
                "extractedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "extractedOn": date.today().isoformat(),
                "candidateMetros": len(cities),
                "metrosMatchedToPolygon": matched,
                "mappedBasicCategories": len(assignment),
                "classifiedUsPlacesConsidered": considered,
                "uniqueIdsConsidered": unique_ids,
                "duplicateRowsCollapsed": duplicates,
                "placesInsideCandidateMetros": inside,
                "exclusions": {
                    "operatingStatus": "permanently_closed excluded; NULL kept as 'not recorded'",
                    "confidence": "confidence = 0 excluded (Overture: certain the place no longer exists)",
                    "geometry": "NULL geometry or NULL id excluded",
                    "unclassified": "basic_category absent from the mapping enters no bucket",
                },
            },
            indent=2,
        )
        + "\n"
    )

    print(f"  {len(rows)} metro/category rows -> {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

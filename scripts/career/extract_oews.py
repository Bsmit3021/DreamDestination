#!/usr/bin/env python3
"""
Step 1 of the career pipeline: OEWS xlsx -> filtered TSV.

    npm run data:career:extract

Reads `data/raw/oesm25ma.zip` (validated by SHA-256 before use) and writes
`data/raw/oews-msa.tsv` containing only the rows the application can use.

Why Python: the source is a 30 MB xlsx and this is the only step that needs a
spreadsheet reader. Python's stdlib (zipfile + ElementTree) parses xlsx without
any dependency, so no spreadsheet library enters the Node project. Everything
downstream is TypeScript, as with the other pipelines.

Rows kept:
  AREA_TYPE = 4          metropolitan areas only
  NAICS     = 000000     cross-industry (all industries combined)
  O_GROUP   = detailed   individual SOC occupations, not roll-ups

Values are copied through verbatim, including BLS suppression markers. Deciding
what a marker means is the transform's job, not the extractor's.
"""

import hashlib
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "data" / "raw" / "oesm25ma.zip"
MEMBER = "oesm25ma/MSA_M2025_dl.xlsx"
OUT = ROOT / "data" / "raw" / "oews-msa.tsv"

EXPECTED_SHA256 = "cc3e6fa80edf64ab8fd0e8a6472ef1b513a6bcaef2f5018e9649c485793b0b99"

# Columns carried forward. AREA and OCC_CODE are the join keys; the rest are
# the measures the schema stores.
WANTED = [
    "AREA", "AREA_TITLE", "PRIM_STATE", "OCC_CODE", "OCC_TITLE", "O_GROUP",
    "TOT_EMP", "JOBS_1000", "LOC_QUOTIENT",
    "H_MEAN", "A_MEAN", "H_MEDIAN", "A_MEDIAN", "A_PCT25", "A_PCT75",
]


def verify_archive() -> None:
    if not ARCHIVE.exists():
        sys.exit(f"Missing {ARCHIVE}. See docs/opportunity.md for how to obtain it.")

    digest = hashlib.sha256()
    with ARCHIVE.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)

    actual = digest.hexdigest()
    if actual != EXPECTED_SHA256:
        sys.exit(
            "OEWS archive SHA-256 mismatch — refusing to parse.\n"
            f"  expected {EXPECTED_SHA256}\n  actual   {actual}\n"
            "A different release changes column meanings; update the pipeline "
            "deliberately rather than ingesting an unknown file."
        )
    print(f"  archive verified (sha256 {actual[:16]}…)")


def main() -> None:
    verify_archive()

    outer = zipfile.ZipFile(ARCHIVE)
    inner = zipfile.ZipFile(io.BytesIO(outer.read(MEMBER)))

    shared = [
        "".join(t.text or "" for t in si.iter(NS + "t"))
        for si in ET.fromstring(inner.read("xl/sharedStrings.xml"))
    ]

    def value(cell) -> str:
        v = cell.find(NS + "v")
        if v is None or v.text is None:
            return ""
        return shared[int(v.text)] if cell.get("t") == "s" else v.text

    header: list[str] = []
    index: dict[str, int] = {}
    kept = 0
    seen = 0

    OUT.parent.mkdir(parents=True, exist_ok=True)

    with OUT.open("w", encoding="utf-8") as out, inner.open(
        "xl/worksheets/sheet1.xml"
    ) as sheet:
        out.write("\t".join(WANTED) + "\n")

        for _, el in ET.iterparse(sheet, events=("end",)):
            if el.tag != NS + "row":
                continue

            cells = [value(c) for c in el.findall(NS + "c")]
            el.clear()

            if not header:
                header = cells
                missing = [c for c in WANTED + ["AREA_TYPE", "NAICS"] if c not in header]
                if missing:
                    sys.exit(f"OEWS layout changed; missing columns: {missing}")
                index = {name: i for i, name in enumerate(header)}
                continue

            seen += 1

            def col(name: str) -> str:
                i = index[name]
                return cells[i].strip() if i < len(cells) else ""

            if col("AREA_TYPE") != "4":
                continue
            if col("NAICS") != "000000":
                continue
            if col("O_GROUP") != "detailed":
                continue

            out.write("\t".join(col(name) for name in WANTED) + "\n")
            kept += 1

    print(f"  data rows scanned: {seen}")
    print(f"  rows kept (metro x cross-industry x detailed): {kept}")
    print(f"  wrote {OUT.relative_to(ROOT)}")
    print("Next: npm run data:career:transform")


if __name__ == "__main__":
    main()

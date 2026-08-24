#!/usr/bin/env python3
"""
Step 1 of the safety pipeline: CIUS Table 6 xlsx -> flat TSV.

    npm run data:safety:extract

Reads `data/raw/cius-estimations-2025.zip` and writes `data/raw/cius-msa.tsv`.

Why Python: same reason as the OEWS extractor. The source is an xlsx and
Python's stdlib (zipfile + ElementTree) parses one with no dependency, so no
spreadsheet library enters the Node project. Everything downstream is
TypeScript, as with the other pipelines.

This step is deliberately dumb. It copies the four cells that matter out of
every sheet row and does nothing else — it does not decide which rows are
metros, which are principal cities, or what an empty cell means. That is the
transform's job.

Columns written (tab separated, one row per sheet row):

    a   column A — MSA name, present only on the first row of a block
    b   column B — the row's label within the block
    c   column C — population, or the reporting fraction on the
                   "Total area actually reporting" row
    d   column D — violent crime
    i   column I — property crime

Reading by cell reference rather than by position matters: an xlsx omits empty
cells entirely, so the "Rate per 100,000 inhabitants" row — which has no
population cell — would otherwise shift a column to the left.
"""

import csv
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "data/raw/cius-estimations-2025.zip"
MEMBER = (
    "CIUS_Table_6_Crime_in_the_United_States_"
    "by_Metropolitan_Statistical_Area_2025.xlsx"
)
OUTPUT = ROOT / "data/raw/cius-msa.tsv"

WANTED = ("A", "B", "C", "D", "I")


def fail(message: str) -> None:
    print(f"  x {message}", file=sys.stderr)
    sys.exit(1)


def shared_strings(book: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in book.namelist():
        return []
    root = ET.fromstring(book.read("xl/sharedStrings.xml"))
    return [
        "".join(node.text or "" for node in si.iter(NS + "t"))
        for si in root.findall(NS + "si")
    ]


def main() -> None:
    if not ARCHIVE.exists():
        fail(f"{ARCHIVE} not found. Run `npm run data:safety:fetch` first.")

    with zipfile.ZipFile(ARCHIVE) as outer:
        if MEMBER not in outer.namelist():
            fail(
                f"{MEMBER} is not in the archive. The CIUS table naming changed; "
                "re-check the contents before editing this script."
            )
        payload = outer.read(MEMBER)

    with zipfile.ZipFile(__import__("io").BytesIO(payload)) as book:
        strings = shared_strings(book)
        sheet = ET.fromstring(book.read("xl/worksheets/sheet1.xml"))

        data = sheet.find(NS + "sheetData")
        if data is None:
            fail("Table 6 has no sheetData. The workbook layout changed.")

        rows = []
        for row in data.findall(NS + "row"):
            cells = {}
            for cell in row.findall(NS + "c"):
                ref = cell.get("r") or ""
                column = re.match(r"([A-Z]+)", ref)
                if not column or column.group(1) not in WANTED:
                    continue
                value = cell.find(NS + "v")
                if value is None or value.text is None:
                    continue
                text = value.text
                if cell.get("t") == "s":
                    text = strings[int(text)]
                cells[column.group(1)] = text.strip()
            rows.append(cells)

    # The published table runs to a few hundred metro blocks. Anything far
    # short of that means the layout moved and the output would be silently
    # partial, which is worse than failing.
    if len(rows) < 500:
        fail(f"only {len(rows)} rows parsed from Table 6; expected far more")

    labels = {row.get("B", "") for row in rows}
    for required in ("Total area actually reporting", "Rate per 100,000 inhabitants"):
        if required not in labels:
            fail(
                f'expected row label "{required}" is absent. '
                "Table 6's block layout changed; the transform would misread it."
            )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(["a", "b", "c", "d", "i"])
        for row in rows:
            writer.writerow([row.get(column, "") for column in WANTED])

    print(f"  {len(rows)} rows -> {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

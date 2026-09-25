"""Export every contract as a Markdown file with full text + preserved tables.

For each contract, writes data/markdown/<id>.md containing:
  - YAML frontmatter (label, expanded label, term, source PDF URL, page count,
    OCR-page count, clause count)
  - H1 title
  - Source PDF link
  - Per-clause sections — Article / Section heading as H2/H3, page number,
    OCR flag where applicable, and full body text
  - Markdown tables preserved (extract.py already wrote pipe-delimited rows
    into the OCR text, so they pass through unchanged here)

Run: .venv/bin/python scripts/export_markdown.py
"""
from __future__ import annotations
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TXT_DIR = DATA / "text"
MD_DIR = DATA / "markdown"
MD_DIR.mkdir(exist_ok=True, parents=True)


# Same expansion logic as the frontend acronyms.js, condensed to Python.
ACRONYMS = {
    "ADWA": "Assistant Deputy Wardens Association",
    "ALE": "Association of Legislative Employees",
    "CCA": "Correction Captains Association",
    "CEA": "Captains' Endowment Association (NYPD)",
    "CIR": "Committee of Interns and Residents",
    "COBA": "Correction Officers' Benevolent Association",
    "CSA": "Council of School Supervisors and Administrators",
    "CSBA": "Civil Service Bar Association",
    "CWA": "Communications Workers of America",
    "DC37": "District Council 37 of AFSCME",
    "DC9": "District Council 9 of the Painters",
    "DEA": "Detectives' Endowment Association",
    "DIA": "Detective Investigator Association (District Attorneys' offices)",
    "EPO": "Environmental Police Officers",
    "FADBA": "Fire Alarm Dispatchers Benevolent Association",
    "IATSE": "International Alliance of Theatrical Stage Employees",
    "IBT": "International Brotherhood of Teamsters",
    "IUOE": "International Union of Operating Engineers",
    "L3": "IBEW Local 3",
    "LBA": "Lieutenants Benevolent Association",
    "LEEBA": "Law Enforcement Employees Benevolent Association",
    "MEBA": "Marine Engineers' Beneficial Association",
    "MMP": "International Organization of Masters, Mates & Pilots",
    "NYSNA": "New York State Nurses Association",
    "OSA": "Organization of Staff Analysts",
    "PBA": "Patrolmen's Benevolent Association",
    "SBA": "Sergeants Benevolent Association",
    "SOA": "Sanitation Officers Association",
    "UBCJ": "United Brotherhood of Carpenters and Joiners",
    "UFA": "Uniformed Firefighters Association",
    "UFOA": "Uniformed Fire Officers Association",
    "UFT": "United Federation of Teachers",
    "UPOA": "United Probation Officers Association",
    "USA": "Uniformed Sanitationmen's Association",
    "USCA": "Uniformed Sanitation Chiefs Association",
}


def expand_label(label: str) -> str:
    if not label:
        return label
    tokens = label.split()
    if not tokens:
        return label
    first = re.sub(r"[^A-Za-z0-9/]", "", tokens[0]).upper()
    rest = " ".join(tokens[1:])
    rest = rest.replace("MOA", "Memorandum of Agreement").replace("MOU", "Memorandum of Understanding")
    if first in ACRONYMS:
        return f"{ACRONYMS[first]} ({first}) — {rest}"
    return label.replace("MOA", "Memorandum of Agreement").replace("MOU", "Memorandum of Understanding")


def slug_anchor(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:60] or "section"


def export_contract(c: dict, clauses: list, units_by_id: dict, wages_by_id: dict) -> str:
    cid = c["id"]
    label = c["label"]
    expanded = expand_label(label)
    term = f"{c.get('term_start')}–{c.get('term_end')}" if c.get("term_start") and c.get("term_end") else "term n/a"
    pages_path = TXT_DIR / f"{cid}.pages.json"
    pages_meta = json.loads(pages_path.read_text()) if pages_path.exists() else []
    total_pages = len(pages_meta)
    ocr_pages = sum(1 for p in pages_meta if p.get("ocr"))
    table_pages = sum(1 for p in pages_meta if p.get("tables"))
    contract_clauses = [cl for cl in clauses if cl["contract_id"] == cid]
    unit = units_by_id.get(cid, {})
    wage = wages_by_id.get(cid, {})

    out = []
    # YAML frontmatter
    out.append("---")
    out.append(f"contract_id: {cid}")
    out.append(f'label: "{label}"')
    out.append(f'expanded_label: "{expanded}"')
    if c.get("term_start"):
        out.append(f"term_start: {c['term_start']}")
    if c.get("term_end"):
        out.append(f"term_end: {c['term_end']}")
    out.append(f'source_pdf: "{c["url"]}"')
    out.append(f"pages: {total_pages}")
    out.append(f"ocr_pages: {ocr_pages}")
    out.append(f"pages_with_tables: {table_pages}")
    out.append(f"clauses: {len(contract_clauses)}")
    if unit.get("sector"):
        out.append(f'sector: "{unit["sector"]}"')
    if unit.get("union_full"):
        out.append(f'union_full: "{unit["union_full"]}"')
    if unit.get("headcount_verified"):
        out.append(f"headcount_approx: {unit['headcount']}")
    if wage.get("verified"):
        out.append(f'wage_verified: "{wage["verified"]}"')
    if wage.get("cumulative_pct") is not None:
        out.append(f"wage_cumulative_pct: {wage['cumulative_pct']}")
    out.append("---")
    out.append("")

    # Title block
    out.append(f"# {expanded}")
    out.append("")
    out.append(f"**Term:** {term}  ")
    out.append(f"**Source PDF:** [{c['url']}]({c['url']})  ")
    out.append(f"**Pages:** {total_pages}{f' ({ocr_pages} OCR-reconstructed)' if ocr_pages else ''}  ")
    out.append(f"**Clauses extracted:** {len(contract_clauses)}")
    if unit.get("summary"):
        out.append("")
        out.append(f"**Workforce:** {unit['summary']}")
    out.append("")
    out.append("> This Markdown export is derived from the source PDF via `pdfplumber` text extraction with `ocrmac` (macOS Vision) OCR fallback for image-only pages. Tables were detected and rendered as pipe-delimited Markdown so column boundaries survive. Pages flagged `OCR` were reconstructed from page images and may contain minor character recognition errors — verify quotations against the source PDF before publishing.")
    out.append("")
    out.append("---")
    out.append("")

    # Navigation outline — built from detected clause headings, linking to the
    # page where each appears. Purely a convenience; the full text below is
    # authoritative and complete regardless of segmentation.
    headed = [cl for cl in contract_clauses if cl.get("heading")]
    if len(headed) > 5:
        out.append("## Contents")
        out.append("")
        for cl in headed:
            heading = cl["heading"]
            out.append(f"- [{heading}](#page-{cl.get('page', 0)})")
        out.append("")
        out.append("---")
        out.append("")

    # Full contract text, page by page. This renders the COMPLETE extracted text
    # for every page (not just clauses the segmenter recognized), so letter-style
    # MOAs without Article/Section headings are captured in full. Page text from
    # extract.py already contains pipe-delimited Markdown tables where detected.
    for p in pages_meta:
        body = (p.get("text") or "").strip()
        if not body:
            continue
        pno = p.get("page")
        out.append(f'<a id="page-{pno}"></a>')
        hdr = f"## Page {pno}"
        if p.get("ocr"):
            hdr += "  ·  _OCR-reconstructed_"
        out.append(hdr)
        out.append("")
        out.append(body)
        out.append("")
    out.append("---")
    out.append(f"_End of contract. Source PDF: <{c['url']}>_")
    out.append("")
    return "\n".join(out)


def main():
    contracts = json.loads((DATA / "contracts.json").read_text())
    clauses = json.loads((DATA / "clauses.json").read_text())
    units = json.loads((DATA / "units.json").read_text()) if (DATA / "units.json").exists() else []
    wages = json.loads((DATA / "wages.json").read_text()) if (DATA / "wages.json").exists() else []
    units_by_id = {u["contract_id"]: u for u in units}
    wages_by_id = {w["contract_id"]: w for w in wages}

    n_written = 0
    for c in contracts:
        md = export_contract(c, clauses, units_by_id, wages_by_id)
        path = MD_DIR / f"{c['id']}.md"
        path.write_text(md)
        n_written += 1
    print(f"Wrote {n_written} markdown files to {MD_DIR}")

    # Also build a single-zip bundle for convenient download
    zip_path = DATA / "nyc-labor-contracts-markdown.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for md in sorted(MD_DIR.glob("*.md")):
            z.write(md, arcname=f"nyc-labor-contracts/{md.name}")
        # Include the contracts.json index for context
        z.write(DATA / "contracts.json", arcname="nyc-labor-contracts/contracts.json")
        if (DATA / "units.json").exists():
            z.write(DATA / "units.json", arcname="nyc-labor-contracts/units.json")
        if (DATA / "wages.json").exists():
            z.write(DATA / "wages.json", arcname="nyc-labor-contracts/wages.json")
    print(f"Wrote zip bundle: {zip_path} ({zip_path.stat().st_size//1024} KB)")

    # Build an INDEX.md listing every contract for browseable navigation in the zip
    idx = ["# NYC municipal labor contracts — Markdown export", ""]
    idx.append(f"_{len(contracts)} contracts. Each `<id>.md` file contains the full searchable text, segmented into clauses with page numbers, with tables preserved as pipe-delimited Markdown._")
    idx.append("")
    idx.append("Source: NYC Office of Labor Relations Recent Agreements page. Many contracts were OCR-reconstructed from image-only PDFs; per-page OCR flags are preserved in the YAML frontmatter and inline meta lines.")
    idx.append("")
    idx.append("## Contracts")
    idx.append("")
    for c in sorted(contracts, key=lambda x: expand_label(x["label"])):
        term = f"{c.get('term_start')}–{c.get('term_end')}" if c.get("term_start") and c.get("term_end") else "term n/a"
        idx.append(f"- [{expand_label(c['label'])}]({c['id']}.md) — {term}")
    idx.append("")
    (MD_DIR / "INDEX.md").write_text("\n".join(idx))
    print(f"Wrote {MD_DIR / 'INDEX.md'}")


if __name__ == "__main__":
    main()

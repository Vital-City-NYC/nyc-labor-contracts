"""Export companion reference documents for the Gemini Notebook.

The notebook's primary sources are the 99 contract text files
(export_text_only.py). These companion files add the context the contract
text alone cannot answer — which contracts exist and when they expire, what
the union acronyms mean, who each bargaining unit covers and the verified
wage patterns. Every file is headed with a provenance note so Gemini Notebook
citations clearly distinguish companion reference material from contract
text.

Only human-verified data is exported: curated unit entries (with sourced
headcounts) and curated wage schedules (with verification level and source
note). Unverified auto-extracted percentages are deliberately excluded.

Run: .venv/bin/python scripts/export_notebook_companion.py
"""
from __future__ import annotations
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TXT = DATA / "text"
OUT_DIR = DATA / "notebook-companion"
OUT_DIR.mkdir(exist_ok=True, parents=True)
ZIP = DATA / "nyc-labor-contracts-NOTEBOOK-COMPANION.zip"

BANNER = (
    "> **Companion reference — not contract text.** This document was prepared "
    "as part of the NYC municipal labor contracts project to support search "
    "and question-answering. The contracts themselves are separate sources in "
    "this notebook; treat this file as project reference material.\n"
)


def load(name):
    return json.loads((DATA / name).read_text())


def acronym_map():
    """Parse the MAP from acronyms.js so there is one source of truth."""
    src = (ROOT / "acronyms.js").read_text()
    pairs = re.findall(r'"([^"]+)":\s*"([^"]+)"', src)
    # Keep only short keys (acronym-like); drops nothing in practice.
    return {k: v for k, v in pairs if len(k) <= 8}


def ocr_pages(cid):
    p = TXT / f"{cid}.pages.json"
    if not p.exists():
        return None, None
    pages = json.loads(p.read_text())
    return sum(1 for x in pages if x.get("ocr")), len(pages)


def doc_about():
    manifest = load("manifest.json")
    return f"""# About this corpus — NYC municipal labor contracts

{BANNER}
This notebook contains the full text of {manifest['contracts']} collective bargaining agreements covering New York City municipal employees: every agreement listed on the New York City Office of Labor Relations "Recent Agreements" page, plus 20 documents published elsewhere: agreements for the Uniformed Firefighters Association, the Uniformed Fire Officers Association and the New York State Nurses Association and five memoranda that sit on the office's download server without a link from any of its pages, and 12 City University of New York agreements for faculty (Professional Staff Congress) and non-faculty staff.

## How the text was produced

Many of the source documents are scanned image PDFs with no embedded text. Each page was extracted with a text-layer reader where possible and with optical character recognition (macOS Vision, with Google Cloud Vision for the seven worst-quality documents) where not. Roughly 500 high-confidence OCR misreads have been hand-reviewed and corrected, and two agreements — the Committee of Interns and Residents contract and the PSC-CUNY 2023-2027 memorandum of agreement — are drawn from text-native copies published by the unions themselves, which removes nearly all OCR error from those documents.

## Cautions for answering questions

- OCR text can still contain transcription mistakes, especially in signature blocks, addresses and dense wage tables. When a number matters, recommend verifying against the source PDF (each contract file links to it).
- Contract terms in these documents are frequently retroactive: an agreement signed in 2024 may have a term that began in 2021.
- Several uniformed unit agreements are short letters that incorporate the Uniformed Coalition Economic Agreement by reference — economic terms for those units live in that coalition document, not the unit letter.
- The corpus reflects agreements published as of August 2026, checked again Sept. 25, 2026.
- Some current agreements are not in this notebook because they have never been published. The New York State Nurses Association 2019-2023 agreement here was replaced by a contract settled in July 2023 whose text is unpublished. The Uniformed Firefighters Association and Uniformed Fire Officers Association signed the 2022-2027 coalition agreement, but their successor unit agreements are unpublished. Do not describe the older documents as current for these unions.
- 59 amendments keep an older underlying agreement in force that is not in this notebook, so provisions on grievances, discipline and seniority for those workers may not appear here at all.
"""


def doc_index(contracts):
    lines = [
        "# Contract index — all agreements in this notebook\n",
        BANNER,
        "Each row lists one agreement: its short label, the years of its term, how much of its text came from optical character recognition (OCR) and the official source PDF.\n",
        "| Contract | Term | OCR pages | Source PDF |",
        "|---|---|---|---|",
    ]
    for c in sorted(contracts, key=lambda x: x["label"].lower()):
        o, t = ocr_pages(c["id"])
        ocr = f"{o}/{t}" if t else "n/a"
        term = f"{c.get('term_start', '?')}–{c.get('term_end', '?')}"
        lines.append(f"| {c['label']} | {term} | {ocr} | {c['url']} |")
    lines.append("")
    lines.append("Expiration caveat: 'term end' is the stated contract expiration year. Under New York's Triborough doctrine an expired agreement's terms generally remain in force until a successor is reached.")
    return "\n".join(lines) + "\n"


def doc_glossary():
    amap = acronym_map()
    lines = [
        "# Union acronym glossary\n",
        BANNER,
        "NYC labor contracts often use an acronym in one document and the union's full name in another. This glossary maps the acronyms used across the corpus to full names.\n",
        "| Acronym | Full name |",
        "|---|---|",
    ]
    for k in sorted(amap):
        lines.append(f"| {k} | {amap[k]} |")
    return "\n".join(lines) + "\n"


def doc_units(units):
    curated = [u for u in units if u.get("curated")]
    lines = [
        "# Bargaining units — who each major contract covers\n",
        BANNER,
        f"Detailed, source-noted profiles exist for the {len(curated)} largest or best-known bargaining units below. Headcounts are approximate and each carries its source. The remaining units in the corpus are smaller titles (mostly skilled trades); their coverage is defined in each contract's recognition clause.\n",
    ]
    for u in sorted(curated, key=lambda x: -(x.get("headcount") or 0)):
        lines.append(f"## {u['contract_label']}")
        lines.append(f"- Union: {u.get('union_full')}")
        if u.get("employer"):
            lines.append(f"- Employer: {u['employer']}")
        if u.get("headcount_verified"):
            lines.append(f"- Approximate headcount: {u['headcount']:,} — {u.get('headcount_note', '')}")
        if u.get("summary"):
            lines.append(f"- Coverage: {u['summary']}")
        if u.get("titles"):
            lines.append(f"- Representative titles: {', '.join(u['titles'])}")
        lines.append("")
    return "\n".join(lines)


def doc_wages(wages):
    curated = [w for w in wages if w.get("curated")]
    lines = [
        "# Verified wage patterns — general wage increases by contract\n",
        BANNER,
        "These general wage increase (GWI) schedules were transcribed by hand and verified against the contract text. The 'verification' line states how solid each entry is: 'full' means percentages and dates were both located and quoted from the contract; 'pattern' means the unit incorporates a parent agreement's percentages by reference; 'appendix' means the rates live in a wage-table appendix in the source PDF. Contracts not listed here have no verified schedule in this project — do not infer one.\n",
    ]
    for w in curated:
        lines.append(f"## {w['contract_label']}")
        lines.append(f"- Verification: {w.get('verified')}")
        if w.get("increases"):
            lines.append("- Increases:")
            for inc in w["increases"]:
                lines.append(f"  - {inc['effective']}: {inc['pct']}%")
        if w.get("cumulative_pct") is not None:
            lines.append(f"- Cumulative over the term: {w['cumulative_pct']}% (compounded)")
        for b in w.get("bonuses", []):
            lines.append(f"- Bonus: ${b['amount']:,} ({b['type']}, {b['effective']})")
        if w.get("source_note"):
            lines.append(f"- Source note: {w['source_note']}")
        lines.append("")
    return "\n".join(lines)


def main():
    contracts = load("contracts.json")
    units = load("units.json")
    wages = load("wages.json")
    docs = {
        "companion-00-about-this-corpus.md": doc_about(),
        "companion-01-contract-index.md": doc_index(contracts),
        "companion-02-union-acronym-glossary.md": doc_glossary(),
        "companion-03-bargaining-units.md": doc_units(units),
        "companion-04-verified-wage-patterns.md": doc_wages(wages),
    }
    for name, body in docs.items():
        (OUT_DIR / name).write_text(body)
        print(f"  wrote {name} ({len(body):,} chars)")
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for name in sorted(docs):
            z.write(OUT_DIR / name, arcname=f"notebook-companion/{name}")
    print(f"Zip: {ZIP} ({ZIP.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

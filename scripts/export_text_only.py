"""Export a Gemini Notebook-friendly bundle containing ONLY contract text.

Each <id>.md = the contract's name (H1) + its full extracted text, with page
breaks. NO frontmatter, NO headcount/wage/sector metadata, NO workforce
summary, NO methodology note, and NO index or JSON sidecars. This is the
corpus to use when you want a notebook to draw strictly from the agreements
themselves and nothing derived or curated.
"""
from __future__ import annotations
import json, re, zipfile
from pathlib import Path
from export_markdown import expand_label  # reuse acronym expansion only

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TXT = DATA / "text"
OUT_DIR = DATA / "contracts-text-only"
OUT_DIR.mkdir(exist_ok=True, parents=True)
ZIP = DATA / "nyc-labor-contracts-TEXT-ONLY.zip"

def main():
    contracts = json.loads((DATA / "contracts.json").read_text())
    written = []
    for c in contracts:
        cid = c["id"]
        tp = TXT / f"{cid}.txt"
        if not tp.exists() or tp.stat().st_size < 50:
            continue
        raw = tp.read_text()
        # page breaks (form-feeds) -> blank lines; collapse runaway blank lines
        body = raw.replace("\f", "\n\n")
        body = re.sub(r"\n{3,}", "\n\n", body).strip()
        title = expand_label(c["label"])
        if c.get("era") == "earlier":
            # Older document still partly in force: say so before any text.
            by_id = {x["id"]: x for x in contracts}
            later = "; ".join(expand_label(by_id[i]["label"]) for i in c.get("later_ids", []) if i in by_id)
            md = (f"# EARLIER AGREEMENT, MAY BE SUPERSEDED: {title}\n\n"
                  "> This is an older agreement. Later documents keep parts of it in force and change others; "
                  "where they conflict, the later document governs. Do not present a clause from it as current "
                  f"without checking the later documents{': ' + later if later else ''}.\n\n{body}\n")
        else:
            md = f"# {title}\n\n{body}\n"
        (OUT_DIR / f"{cid}.md").write_text(md)
        written.append(cid)
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for cid in sorted(written):
            z.write(OUT_DIR / f"{cid}.md", arcname=f"contracts-text-only/{cid}.md")
    print(f"Wrote {len(written)} text-only files -> {OUT_DIR}")
    print(f"Zip: {ZIP} ({ZIP.stat().st_size//1024} KB)")

if __name__ == "__main__":
    main()

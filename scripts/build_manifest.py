"""Write data/manifest.json with corpus stats for the frontend footer."""
from __future__ import annotations
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TXT_DIR = DATA / "text"


def main():
    contracts = json.loads((DATA / "contracts.json").read_text())
    clauses_path = DATA / "clauses.json"
    clauses = json.loads(clauses_path.read_text()) if clauses_path.exists() else []
    ocr_pages = 0
    total_pages = 0
    for c in contracts:
        meta = TXT_DIR / f"{c['id']}.pages.json"
        if not meta.exists():
            continue
        pages = json.loads(meta.read_text())
        total_pages += len(pages)
        ocr_pages += sum(1 for p in pages if p.get("ocr"))
    manifest = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        # "contracts" counts current documents; earlier agreements are separate.
        "contracts": sum(1 for c in contracts if c.get("era") != "earlier"),
        "earlier_documents": sum(1 for c in contracts if c.get("era") == "earlier"),
        "clauses": len(clauses),
        "pages": total_pages,
        "ocr_pages": ocr_pages,
    }
    (DATA / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

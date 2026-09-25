"""Add documents listed in data/added_documents.json to the database.

Runs the normal pipeline steps on the new documents ONLY, so existing
clauses are never reprocessed (reflow_paragraphs.py is not safe to repeat on
text it has already reflowed):

  download (if the PDF is not already in data/pdfs/)
  extract   -> data/text/<id>.txt and .pages.json, with OCR for image pages
               and for pages whose embedded text layer is mostly non-words
  segment   -> clauses (segment.segment_contract)
  tag       -> topics (tag.topics_for)
  reflow    -> clause text (reflow_paragraphs.reflow_clause_text), once
  classify  -> doc_type, amends_predecessor (classify_docs.classify)

Then appends the contracts and clauses. Documents already in contracts.json
are skipped, so the script is safe to re-run. Afterwards run
clean_headings.py, build_units.py and the exports.
"""
from __future__ import annotations

import collections
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import extract            # noqa: E402
import segment            # noqa: E402
import tag                # noqa: E402
import reflow_paragraphs  # noqa: E402
import classify_docs      # noqa: E402

ROOT = HERE.parent
DATA = ROOT / "data"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"


def vocabulary():
    """Words seen at least three times in the existing corpus."""
    cnt = collections.Counter()
    for p in (DATA / "text").glob("*.txt"):
        cnt.update(w.lower() for w in re.findall(r"[A-Za-z]{3,}", p.read_text()))
    return {w for w, n in cnt.items() if n >= 3}


def realness(text, vocab):
    ws = [w.lower() for w in re.findall(r"[A-Za-z]{3,}", text)]
    return (sum(w in vocab for w in ws) / len(ws)) if ws else 0.0


def main(spec_name: str = "added_documents.json"):
    spec = json.loads((DATA / spec_name).read_text())["documents"]
    contracts = json.loads((DATA / "contracts.json").read_text())
    clauses = json.loads((DATA / "clauses.json").read_text())
    have = {c["id"] for c in contracts}
    vocab = vocabulary()
    new_contracts, new_clauses = [], []

    for d in spec:
        cid = d["id"]
        if cid in have:
            print(f"skip {cid} (already in contracts.json)")
            continue
        pdf = DATA / "pdfs" / f"{cid}.pdf"
        if not pdf.exists():
            subprocess.run(["curl", "-sfL", "-A", UA, "-o", str(pdf), d["url"]], check=True)

        # Extract, then re-OCR any page whose text layer is mostly garbage.
        pages, _ = extract.extract_pdf(pdf)
        for p in pages:
            if not p["ocr"] and p["text"] and realness(p["text"], vocab) < 0.75:
                o = extract._ocr_page(pdf, p["page"] - 1)
                if realness(o, vocab) > realness(p["text"], vocab):
                    p["text"], p["ocr"] = o, True
                    p["words"] = len(re.findall(r"\b\w+\b", o))
        full = "\n\f\n".join(p["text"] for p in pages)
        (DATA / "text" / f"{cid}.txt").write_text(full)
        (DATA / "text" / f"{cid}.pages.json").write_text(json.dumps(pages, indent=1))

        contract = {
            "id": cid, "label": d["label"], "section": d["section"], "source": d["source"],
            "url": d["url"], "term_start": None, "term_end": None,
        }
        m = re.search(r"(\d{4})\D+(\d{4})\s*$", d["label"])
        if m:
            contract["term_start"], contract["term_end"] = int(m.group(1)), int(m.group(2))
        # Earlier agreements carry their place in a unit's chain.
        for k in ("era", "later_ids", "complete", "publisher", "gap_note", "term_start", "term_end"):
            if d.get(k) is not None:
                contract[k] = d[k]

        cls = segment.segment_contract(contract)
        for cl in cls:
            # Same order as the full pipeline: tag, then reflow.
            cl["topics"] = tag.topics_for(cl.get("text", ""), cl.get("heading", ""))
            cl["text"] = reflow_paragraphs.reflow_clause_text(cl.get("text") or "")
        text = "\n".join(x["text"] for x in cls)
        doc_type, amends, evidence = classify_docs.classify(contract, text, [x.get("heading") or "" for x in cls])
        contract.update({"doc_type": doc_type, "amends_predecessor": amends,
                         "amends_evidence": evidence, "chars": len(text)})
        new_contracts.append(contract)
        new_clauses.extend(cls)
        n_ocr = sum(1 for p in pages if p["ocr"])
        print(f"{cid}: {len(pages)} pages ({n_ocr} OCR), {len(cls)} clauses, {doc_type}, amends={amends}")

    if not new_contracts:
        print("nothing to add")
        return
    contracts.extend(new_contracts)
    clauses.extend(new_clauses)
    (DATA / "contracts.json").write_text(json.dumps(contracts, indent=1, ensure_ascii=False) + "\n")
    (DATA / "clauses.json").write_text(json.dumps(clauses, indent=1, ensure_ascii=False) + "\n")
    print(f"added {len(new_contracts)} documents and {len(new_clauses)} clauses")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "added_documents.json")

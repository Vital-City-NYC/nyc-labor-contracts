"""Turn the verified agreement chains into earlier-agreement records.

Reads data/lineage_part*.json (for each current document, the chain of
earlier agreements it continues, nearest first, each link checked by reading
both documents) and writes:

  data/earlier_documents.json   one entry per unique earlier agreement, for
                                scripts/add_documents.py (era "earlier",
                                later_ids = current documents that continue it)
  data/term_dates.json          term dates and quotes for those documents
  data/contracts.json           "lineage" on each current document: the
                                earlier-agreement ids, nearest first

Run: python scripts/build_lineage.py
     python scripts/add_documents.py earlier_documents.json
Then clean_headings.py, build_units.py and the exports.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def slug(url: str) -> str:
    name = url.rsplit("/", 1)[-1]
    name = re.sub(r"%20|\s+", "-", name)
    name = re.sub(r"\.pdf$", "", name, flags=re.I)
    name = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return "earlier-" + name[:70].rstrip("-")


def year(d):
    return int(d[:4]) if d else None


# Current documents that are complete in themselves: consent determinations
# that annex their full Appendix A of terms. Their predecessors are replaced
# outright, not "partly in force", so they get no earlier-agreement chain.
SELF_COMPLETE = {
    "dc9-l1969-painters-consent-determination-2021-2026",
    "l1-plumbers-consent-determination-2022-2027",
    "l3-electricians-consent-determination-20232028",
    "l3-supervisor-of-mechanics-consent-determination-2021-2026",
    "l638-steamfitters-consent-determination-2022-2027",
    "local-15-30-oilers-stationary-engineer-and-senior-stationary-engineer-consent-de",
    "local-40-bridge-repairer-consent-determination-2022-2025",
    "carpenters-consent-determination-2021-2027",
}


def main():
    parts = sorted(DATA.glob("lineage_part*.json"))
    lineage = {}
    for p in parts:
        lineage.update(json.loads(p.read_text())["lineage"])
    contracts = json.loads((DATA / "contracts.json").read_text())
    by_id = {c["id"]: c for c in contracts}
    current_urls = {c["url"] for c in contracts}

    docs = {}      # url -> spec
    chains = {}    # current id -> [earlier ids]
    for cid, entry in lineage.items():
        if cid not in by_id or cid in SELF_COMPLETE or entry.get("self_complete"):
            continue
        ids = []
        for link in entry.get("chain") or []:
            url = link.get("url")
            if not url:
                break
            if url in current_urls:
                # Already in the database as a current document (e.g. the
                # citywide agreement); point at it rather than duplicate it.
                ids.append(next(c["id"] for c in contracts if c["url"] == url))
                continue
            d = docs.get(url)
            if not d:
                d = docs[url] = {
                    "id": slug(url), "label": link.get("title") or url.rsplit("/", 1)[-1],
                    "source": "olr-archive", "section": "Earlier agreement published by the Office of Labor Relations",
                    "url": url, "era": "earlier", "later_ids": [], "complete": bool(link.get("complete")),
                    "publisher": "NYC Office of Labor Relations",
                    "term_start": year(link.get("term_start")), "term_end": year(link.get("term_end")),
                    "_term": link,
                }
            if cid not in d["later_ids"]:
                d["later_ids"].append(cid)
            if link.get("gap_note") and not d.get("gap_note"):
                d["gap_note"] = link["gap_note"]
            ids.append(d["id"])
        if ids:
            chains[cid] = ids

    # Unique ids (two URLs can slug the same).
    seen = {}
    for d in docs.values():
        base, n = d["id"], 2
        while d["id"] in seen and seen[d["id"]] != d["url"]:
            d["id"] = f"{base}-{n}"; n += 1
        seen[d["id"]] = d["url"]

    td = json.loads((DATA / "term_dates.json").read_text())
    for d in docs.values():
        t = d.pop("_term")
        td["dates"][d["id"]] = {
            "start": t.get("term_start"), "end": t.get("term_end"), "quote": t.get("evidence", ""),
            "page": t.get("page"), "method": t.get("method", "text"),
            "notes": t.get("term_text", ""), "disagrees_with_label": False,
        }
    (DATA / "term_dates.json").write_text(json.dumps(td, indent=1, ensure_ascii=False) + "\n")

    for c in contracts:
        if c["id"] in chains:
            c["lineage"] = chains[c["id"]]
    (DATA / "contracts.json").write_text(json.dumps(contracts, indent=1, ensure_ascii=False) + "\n")

    spec = {
        "note": "Earlier agreements still partly in force, from verified chains in data/lineage_part*.json. "
                "Processed by scripts/add_documents.py like any other document, but marked era 'earlier'.",
        "documents": sorted(docs.values(), key=lambda d: d["label"]),
    }
    (DATA / "earlier_documents.json").write_text(json.dumps(spec, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(docs)} earlier documents; chains for {len(chains)} current documents")


if __name__ == "__main__":
    main()

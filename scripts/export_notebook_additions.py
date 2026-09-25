"""Generate ADDITIVE companion docs for the Gemini Notebook.

The notebook already holds the 100 contract texts and companion docs 00-04.
Those contract texts are unchanged and correct. Rather than ask for a full
re-upload, this writes three new files that complement what is already there:

  companion-05  document types — which documents are complete contracts and
                which are amendments, and what subjects each type actually
                covers. The notebook currently cannot answer "is this the whole
                contract?" for any document.
  companion-06  underlying agreements — verified links to the prior agreements
                that the amendments modify, which live on separate pages the
                amendments never reference.
  companion-07  corrections — supersedes specific facts in the already-uploaded
                companion docs, so stale figures in those files do not produce
                wrong answers. Additive by design: no re-upload required.

Output: data/notebook-additions/ plus a zip alongside it.
"""
from __future__ import annotations
import json
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "notebook-additions"
OUT.mkdir(exist_ok=True, parents=True)

BANNER = ("> **Companion reference — not contract text.** This document was prepared as part of "
          "the NYC municipal labor contracts project to support search and question-answering. "
          "The contracts themselves are separate sources in this notebook; treat this file as "
          "project reference material.\n")

TYPE_NAME = {
    "full-agreement": "Full agreement",
    "consent-determination": "Consent determination",
    "moa": "Amendment (memorandum of agreement)",
    "unit-agreement": "Uniformed unit agreement",
}
TOPIC_NAME = {
    "wages": "Wages", "vacation": "Vacation", "sick-leave": "Sick leave", "holidays": "Holidays",
    "other-leave": "Other leave", "parental-leave": "Parental leave",
    "health-welfare": "Health and welfare", "pension": "Pension", "overtime": "Overtime",
    "hours": "Hours and schedules", "longevity": "Longevity", "promotion": "Promotion",
    "discipline": "Discipline", "grievance": "Grievance and arbitration", "layoff": "Layoffs",
    "safety": "Safety", "recognition": "Recognition", "training": "Training",
    "agency-shop": "Union security",
}
ORDER = ["full-agreement", "consent-determination", "moa", "unit-agreement"]


def load():
    contracts = json.loads((DATA / "contracts.json").read_text())
    clauses = json.loads((DATA / "clauses.json").read_text())
    topics = defaultdict(set)
    for cl in clauses:
        topics[cl["contract_id"]].update(cl.get("topics") or [])
    return contracts, topics


def doc_types(contracts, topics):
    n = {t: sum(1 for c in contracts if c.get("doc_type") == t) for t in ORDER}
    n_amend = sum(1 for c in contracts if c.get("amends_predecessor"))
    L = [f"# Document types — which of these are complete contracts\n", BANNER]
    L.append(
        f"Not every document in this notebook is a complete collective bargaining agreement. "
        f"Of the {len(contracts)} documents, **{n_amend} expressly state that an underlying "
        f"agreement remains in force** and change only the terms written in them. When answering "
        f"questions about what governs a group of workers, check this file first: if the document "
        f"is an amendment, the answer may not be in this notebook at all.\n")
    L.append("## The four categories\n")
    for t in ORDER:
        docs = [c for c in contracts if c.get("doc_type") == t]
        if not docs:
            continue
        chars = sorted(c.get("chars", 0) for c in docs)
        med = chars[len(chars) // 2]
        L.append(f"### {TYPE_NAME[t]} — {len(docs)} documents (median {med:,} characters)\n")
        if t == "full-agreement":
            L.append("Self-contained contracts with a full article structure. These can be read on their own.\n")
        elif t == "consent-determination":
            L.append("Prevailing-wage determinations for skilled-trade titles under state Labor Law section 220. "
                     "Their terms are agreed between the Office of Labor Relations and the union to settle a wage "
                     "complaint and issued as a determination rather than signed as a contract. Most carry a full Appendix A of time "
                     "and leave benefits, so they are detailed on vacation, sick leave and holidays but nearly "
                     "silent on grievance procedure.\n")
        elif t == "moa":
            L.append("Amendments. Each changes specific economic terms — usually wages, welfare fund "
                     "contributions and bonuses — and leaves the rest of a prior agreement in force. "
                     "An amendment alone does not state everything that governs the workers it covers.\n")
        else:
            L.append("Short letters executed under the Uniformed Officers Coalition Economic Agreement, "
                     "which supplies their wage increases. They add unit-specific items only.\n")
        for c in sorted(docs, key=lambda x: -x.get("chars", 0)):
            flag = " — amends a prior agreement" if c.get("amends_predecessor") else ""
            L.append(f"- {c['label']}{flag}")
        L.append("")

    L.append("## What each document type actually covers\n")
    L.append("Share of documents in each category whose text addresses a given subject. "
             "This is why a question about grievance procedure often cannot be answered from an amendment.\n")
    L.append("| Subject | " + " | ".join(TYPE_NAME[t].split(" (")[0] for t in ORDER) + " |")
    L.append("|---|" + "---|" * len(ORDER))
    have = defaultdict(lambda: defaultdict(int))
    for c in contracts:
        for tp in topics[c["id"]]:
            have[c.get("doc_type")][tp] += 1
    for tp in TOPIC_NAME:
        row = [TOPIC_NAME[tp]]
        for t in ORDER:
            tot = n[t] or 1
            row.append(f"{have[t][tp] / tot * 100:.0f}%")
        L.append("| " + " | ".join(row) + " |")
    L.append("")
    L.append("Two absences are worth stating plainly, because they shape what this notebook can answer: "
             "wage provisions appear in every document, but grievance and arbitration provisions appear in "
             "only about a quarter of them. Those provisions exist for these bargaining units; for most of the "
             "rest they live in underlying agreements that are not part of this notebook. Management rights "
             "are a different case: in New York City they are set largely by statute (Administrative Code "
             "section 12-307(b)) rather than by contract.\n")
    return "\n".join(L)


def underlying(contracts):
    amends = [c for c in contracts if c.get("amends_predecessor")]
    companions = [c for c in amends if c.get("companion")]
    linked = [c for c in contracts if c.get("predecessor") and not c.get("companion")]
    none = [c for c in amends if not c.get("predecessor") and not c.get("companion")]
    by_id = {c["id"]: c for c in contracts}
    L = [f"# Underlying agreements — where to find the contract an amendment modifies\n", BANNER]
    L.append(
        f"{len(amends)} documents in this notebook are amendments: they change some terms and keep an "
        f"earlier agreement in force for the rest. For {len(companions)} of them the full current terms are "
        f"in another source in this notebook (listed first below). For {len(linked)} documents the earlier "
        f"agreement is published by the city but is **not** in this notebook; its link is below, checked by "
        f"reading both documents. {len(none)} have no earlier agreement available. If a question cannot be "
        f"answered from an amendment, the answer is likely in the earlier agreement, which would need to be "
        f"consulted directly.\n")
    L.append("## Full terms in another source in this notebook\n")
    for c in sorted(companions, key=lambda x: x["label"]):
        L.append(f"- {c['label']}: see {by_id[c['companion']['id']]['label']}")
    L.append("")
    L.append("## Earlier agreements published by the city (not in this notebook)\n")
    L.append("| Amendment in this notebook | Earlier agreement | Its term | Link |")
    L.append("|---|---|---|---|")
    for c in sorted(linked, key=lambda x: x["label"]):
        p = c["predecessor"]
        note = f" ({p['note']})" if p.get("note") else ""
        L.append(f"| {c['label']} | {p['label']}{note} | {p.get('term') or ''} | {p['url']} |")
    L.append("")
    if none:
        L.append("## No earlier agreement available\n")
        for c in none:
            L.append(f"- {c['label']}: {c.get('base_note', '')}")
        L.append("")
    L.append("## Where else to look\n")
    L.append(
        "The Office of Labor Relations posts earlier rounds on its archive pages: "
        "https://www.nyc.gov/site/olr/labor/labor-2017-2021-agreements.page and "
        "https://www.nyc.gov/site/olr/labor/labor-2010-2017-agreements.page (checked Sept. 25, 2026). Many "
        "of those are themselves amendments of a still earlier full contract. None are in this notebook. "
        "Other routes:\n\n"
        "1. **The Office of Labor Relations Uniformed Contracts page** — "
        "https://www.nyc.gov/site/olr/labor/labor-uniformed-contracts.page — carries 30 older agreements, "
        "memoranda and reopeners (mostly 2002-2012) for the police, fire, sanitation and correction unions, "
        "indexed by collective bargaining unit (CBU) number; they are the last full texts published, not "
        "necessarily the immediate predecessors. It is not linked from the Recent Agreements page.\n"
        "2. **Unlinked files on the city's own server**, under "
        "nyc.gov/assets/olr/downloads/pdf/collectivebargaining/. These resolve but appear on no index.\n"
        "3. **The unions themselves.** Many publish their full contracts; the United Federation of "
        "Teachers posts complete agreements for each job title.\n"
        "4. **Outside databases and records requests.** The Empire Center's SeeThroughNY hosts New York "
        "public-sector contracts, and executed agreements are obtainable under the state Freedom of "
        "Information Law.\n")
    return "\n".join(L)


def corrections(contracts):
    units = json.loads((DATA / "units.json").read_text())
    verified = [u for u in units if u.get("headcount_verified") and not u.get("headcount_duplicate_of")]
    total = sum(u["headcount"] for u in verified)
    L = ["# Headcounts and titles — cautions for answering questions\n", BANNER]
    L.append("## 1. Do not add the two PSC-CUNY headcounts together\n")
    L.append(
        "The PSC-CUNY Agreement 2017-2023 and the PSC-CUNY Memorandum of Agreement 2023-2027 cover the "
        "same roughly 30,000 CUNY faculty and professional staff, not 60,000 people. One document is the "
        "underlying agreement and the other amends it. Count them once.\n")
    L.append("## 2. Headcount coverage is thin\n")
    L.append(
        f"Only **{len(verified)} bargaining units have a headcount checked against a primary source** "
        f"(the NYC Mayor's Office, the NYC Council Finance Division, NYSNA or CUNY). Together they cover "
        f"about **{total:,} employees**. No reliable figure exists for the other units, so questions of the "
        "form \"what share of city workers is covered?\" cannot be answered from this notebook. The 1199 "
        "SEIU figure of about 2,500 comes from a 2014 announcement and is not current.\n")
    L.append("## 3. Contract titles and terms\n")
    L.append(
        "Contract titles in this notebook follow the Office of Labor Relations, but several of its "
        "listed years are wrong. The terms stated in the documents themselves are correct: CWA Local 1180 "
        "runs to June 12, 2027; Local 237 Parking Control Specialists to May 10, 2027; the Metal Work "
        "Mechanic agreement ended Nov. 2, 2025; the SEIU Local 621 Supervisor of Mechanics contract ended "
        "Nov. 18, 2025 (July 5, 2026 for the deputy director title); the Sanitation Chiefs unit agreement "
        "runs to Feb. 29, 2028; and the Locksmiths determination ran from Dec. 29, 2020 to Jan. 28, 2026.\n")
    L.append("## 4. The corpus covers city employers only\n")
    L.append(
        "Every document here involves the City of New York as employer (or CUNY, for PSC). Public "
        "employees of the Metropolitan Transportation Authority, the Port Authority and New York State "
        "agencies bargain elsewhere and are **not** represented in this notebook, even though many of "
        "them work in New York City.\n")
    return "\n".join(L)


def main():
    contracts, topics = load()
    files = {
        "companion-05-document-types.md": doc_types(contracts, topics),
        "companion-06-underlying-agreements.md": underlying(contracts),
        "companion-07-corrections.md": corrections(contracts),
    }
    for name, body in files.items():
        (OUT / name).write_text(body)
        print(f"  wrote {name} ({len(body):,} chars)")
    zpath = DATA / "nyc-labor-contracts-NOTEBOOK-ADDITIONS.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for name in files:
            z.write(OUT / name, f"notebook-additions/{name}")
    print(f"Zip: {zpath} ({zpath.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

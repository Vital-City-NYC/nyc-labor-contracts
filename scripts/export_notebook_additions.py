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
    linked = [c for c in contracts if c.get("predecessor")]
    n_amend = sum(1 for c in contracts if c.get("amends_predecessor"))
    n_amend_unlinked = sum(1 for c in contracts if c.get("amends_predecessor") and not c.get("predecessor"))
    L = [f"# Underlying agreements — where to find the contract an amendment modifies\n", BANNER]
    L.append(
        f"{n_amend} documents in this notebook amend a prior agreement, and the city does not link that "
        f"agreement from the amendment. Those prior agreements are public records published in other "
        f"places. Verified links to an earlier full agreement exist for {len(linked)} documents and are "
        f"below; {n_amend_unlinked} of the {n_amend} amendments have no link. If a "
        f"question cannot be answered from an amendment, the answer is likely in the document listed "
        f"here — which is **not** in this notebook and would need to be consulted directly.\n")
    L.append("## Verified links\n")
    L.append("| Amendment in this notebook | Underlying agreement | Published by | Link |")
    L.append("|---|---|---|---|")
    for c in sorted(linked, key=lambda x: x["label"]):
        p = c["predecessor"]
        L.append(f"| {c['label']} | {p['label']} | {p['publisher']} | {p['url']} |")
    L.append("")
    L.append("## Where the others are\n")
    L.append(
        "The remaining amendments are mostly skilled-trade agreements whose predecessors have not been "
        "located. Four routes exist, in rough order of usefulness:\n\n"
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
    L = ["# Corrections — figures superseded in earlier companion documents\n", BANNER]
    L.append(
        "This file corrects specific facts in the companion documents already in this notebook "
        "(companion-00 through companion-04). **Where this file and an earlier companion document "
        "disagree, this file is correct.** The 100 contract texts themselves are unaffected and "
        "remain accurate.\n")
    L.append("## 1. Do not add the two PSC-CUNY headcounts together\n")
    L.append(
        "The bargaining-units companion lists the PSC-CUNY Agreement 2017-2023 at ~30,000 members and "
        "the PSC-CUNY Memorandum of Agreement 2023-2027 at ~30,000 members. **These are the same "
        "~30,000 CUNY faculty and professional staff, not 60,000 people.** One document is the "
        "underlying agreement and the other amends it. Any total covering employees across this corpus "
        "should count them once. The corrected corpus-wide total is approximately **376,900 covered "
        "employees across 15 bargaining units with a sourced headcount** — not 406,900.\n")
    L.append("## 2. Two contract titles were malformed\n")
    L.append(
        "| Appears in earlier companion docs as | Correct title | Term |\n"
        "|---|---|---|\n"
        "| Lba 10 5 2023 Unit Bargaining Agreement | LBA Unit Bargaining Agreement (Lieutenants "
        "Benevolent Association) | 2022-2027 |\n"
        "| Local 891 School Custodians (no term shown) | Local 891 School Custodians MOA | 2020-2025 |\n\n"
        "Both terms were recovered from the documents themselves: the LBA agreement states its term as "
        "February 16, 2022 through April 15, 2027, and the Local 891 agreement states August 1, 2020 "
        "through December 31, 2025.\n")
    L.append("## 3. Headcount coverage is thinner than it may appear\n")
    L.append(
        "Only **15 of the 100 bargaining units have a sourced headcount**. Those figures come from "
        "union statements and city documents, and they are the only basis for any claim about how many "
        "workers this corpus covers. No reliable total exists for the remaining 85 units, so questions "
        "of the form \"what share of city workers is covered?\" cannot be answered from this notebook.\n")
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

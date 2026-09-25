"""Relabel clause headings that are not real section headings.

Heading detection in segment.py treats any short all-caps line as a heading,
so signers' names ("RENEE CAMPION"), letterhead ("OFFICE OF LABOR
RELATIONS"), consent-determination captions and table column labels
("MONTHLY ACCRUAL") end up as section titles. This pass relabels them:

  signature  -> "Signatures"
  letter     -> "Letter: <subject line>" when the letter has a Re: line
  caption    -> "Caption"
  continued  -> "<previous real heading> (continued)"

Clause text, ids, pages and topics are untouched, so permalinks keep working.
The original heading is kept in `heading_raw` (and stays searchable).
Safe to re-run: it always starts from heading_raw when present.

Run after reflow_paragraphs.py and before export_markdown.py.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLAUSES = ROOT / "data" / "clauses.json"

# Signers seen in the corpus, including OCR misreadings. Matched as whole
# headings (or a heading made only of these names).
SIGNERS = [
    r"R?ENEE\s*C?\s*A?M?P?I?O?N?", r"RENEE ?CAMP\w*", r"RENEEC N", r"C[IL]?[IA]?AIRE ?LEVITT", r"CLAIRE ?LEVITT",
    r"G?E?ORGETTE GESTE ?L ?Y?\w*", r"SEORGETTE GESTEL", r"DAN[IJ]EL ?KATZ", r"BRAD LANDER", r"HENRY GARRIDO",
    r"MARK LEVINE", r"GREGORY( ?F?LO\w*| ?LOND)?", r"THOMAS CALLAHAN", r"MARTIN LYDON",
    r"S+E+A+N+ F+I+T+Z+P+A+T+R+I+C+K+", r"JAMES GOLDEN", r"THOMAS RYAN", r"CARL CHIARAMONTE",
    r"ROSE LOVAGLIO-MILLER", r"JOSEPH AZZOPARDI", r"ANDREW ANGBRO", r"H?ARRY NESPOLI", r"CHRIS MONAHAN",
    r"DANIEL DOYLE", r"DANIEL KROOP", r"DENNIS SCHOCK", r"DON MARCUS", r"EDWIN CHRISTIAN",
    r"ERIC ?EICHENH\w*", r"FAMES MOSARTAY", r"JAKWAN RIVERS", r"JAMES PARKER", r"JOSEPH COLANGELO",
    r"JOSPRIT RUSSO", r"LIL ?IAN ROBERTS", r"LOU TURCO", r"MICHAEL BOVE", r"MICHAEL FEWX", r"MIKE RIORDAN",
    r"PATRICK PERRAINOLO", r"PAUL DIGIACOMO", r"PAUL O'CONNOR", r"ROBERT CROGHAN", r"ROLAND REXHA",
    r"RONALD PRATTIS", r"SAUL FISHMAN", r"SIMON SHAMOUN D ?ABY", r"SYED RAHIM", r"THOMAS BACIGALUPO",
    r"THOMAS CUSTANCE", r"VINCENT VALLELONG", r"WILLIAM CORCORAN", r"WILLIAM LYNN", r"RENEE CAMPION JA",
]
SIGNER_RX = re.compile(r"^(?:(?:%s)\s*)+$" % "|".join(SIGNERS))

SIGNATURE_RX = re.compile(
    r"^(AGREED AND ACCEPTED.*|FOR THE CITY OF NEW YORK|FOR (THE )?(COMMUNICATION WORKERS|INTERNATIONAL ORGANIZATION|LEEBA|THE DETECTIVE).*"
    r"|ON BEHALF OF.*|(FIRST|SECOND) PAR[TI]Y|APPROVED AS TO FORM|ACTING CORPORATION COUNSEL|IT IS SO DETERMINED AND ENTERED"
    r"|HOSPITALS)$")

LETTERHEAD_RX = re.compile(
    r"^(OFFICE (OF )?LABOR RELATIONS|(THE )?CITY OF NEW YORK|OF NEW YORK|(T?HE[NHW]|HIEH|THEN) YORK CIT\w*|HE[HNW] YORK CU\w*"
    r"|HEADS OF CONCERNED CITY DEPARTMENTS AND AGENCIES)$")

CAPTION_RX = re.compile(
    r"^((BEFORE )?THE COMPTROLLER OF THE CITY OF NEW YORK|CONSENT DETERMINATION|NOTICE|FILING)$")

# Table column labels and stray fragments that head a slice of a table or page.
CONTINUED_RX = re.compile(
    r"^(CATEGORY|MONTH?E?LY ACCRUAL|ANNUAL LEAVE ALLOWANCE|CATEGORY ANNUAL LEAVE ALLOWANCE MONTHLY ACCRUAL|HOURLY|PERIOD"
    r"|PERIOD RATE|PERIOD HOURLY RATES|RATE RATE|CODE TITLE|TITLE CODE TITLE|TITLES|CURRENT|PER WEEK|WITH PAY|SATURDAY"
    r"|SUNDAY|STEPC|OVERTIME RATE|ANALYSTS|THERAPISTS|MANIA|ORAL Y|RCUSTRATION|RESISTRATION|OFFICIAL|OFFICIAL PP.*"
    r"|TEA L ?I+V?|CONTRACT|DISTRICT CO|DISTRICT COUNCIL|ASSOCIATION|BENEFICIAL ASSOCIATION|NURSES ASSOCIATION"
    r"|SUPERVISORS AND|LOCAL \d+|BROTHERHOOD OF TEAMSTERS|INTERNATIONAL BROTHERHOOD OF( TEAMSTERS)?|ANNUAL LEA|ANNUAL LEAV E"
    r"|Section 220 — .*|IN THE EVENT OF ANY INCONSISTENCY BETWEEN APPENDIX A AND)$")

SUBJECT_RX = re.compile(r"(?:^|\n)\s*(?:Re|RE|Subject|SUBJECT)\s*[:.]\s*(.{4,120})")


def kind_of(heading: str, text: str) -> str | None:
    h = re.sub(r"\s+", " ", heading.strip())
    if not h:
        return None
    if SIGNER_RX.match(h) or SIGNATURE_RX.match(h):
        return "signature"
    if LETTERHEAD_RX.match(h):
        return "letter"
    if CAPTION_RX.match(h):
        return "caption"
    if CONTINUED_RX.match(h):
        return "continued"
    # A heading over a near-empty fragment ("2021-2027", "OF") is not a section.
    if len((text or "").strip()) < 40 and not re.match(r"(Article|Section|APPENDIX)\b", h):
        return "continued"
    return None


def main():
    clauses = json.loads(CLAUSES.read_text())
    counts = {"signature": 0, "letter": 0, "caption": 0, "continued": 0}
    last_real: dict[str, str] = {}
    for cl in clauses:
        raw = cl.get("heading_raw", cl.get("heading") or "")
        cl["heading_raw"] = raw
        cl.pop("heading_kind", None)
        k = kind_of(raw, cl.get("text") or "")
        cid = cl["contract_id"]
        if k is None:
            cl["heading"] = raw
            if raw:
                last_real[cid] = raw
            continue
        counts[k] += 1
        cl["heading_kind"] = k
        if k == "signature":
            cl["heading"] = "Signatures"
        elif k == "caption":
            cl["heading"] = "Caption"
        elif k == "letter":
            body = (cl.get("text") or "")[:1500]
            m = SUBJECT_RX.search(body)
            subj = re.sub(r"\s+", " ", m.group(1)).strip(" .,:;") if m else ""
            if re.search(r"Attached for your information", body, re.I):
                cl["heading"] = "Cover memo from the Office of Labor Relations"
            elif subj:
                cl["heading"] = f"Letter: {subj}"
            elif re.search(r"\bDear\b", body[:600]):
                cl["heading"] = "Side letter"
            else:
                cl["heading"] = "Letterhead"
        else:
            prev = last_real.get(cid)
            if prev:
                cl["heading"] = f"{prev} (continued)"
            elif re.match(r"(HOURLY|SATURDAY|SUNDAY|PERIOD|RATE|CATEGORY|MONTH|ANNUAL LEA)", raw):
                cl["heading"] = "Rate and leave tables"
            else:
                cl["heading"] = "Untitled section"
    # Drop heading_raw where nothing changed, to keep the file lean.
    for cl in clauses:
        if cl.get("heading_raw") == cl.get("heading"):
            cl.pop("heading_raw")
    CLAUSES.write_text(json.dumps(clauses, indent=1, ensure_ascii=False) + "\n")
    print("relabeled:", counts, "of", len(clauses))


if __name__ == "__main__":
    main()

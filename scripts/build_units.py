"""Build data/units.json — bargaining-unit metadata per contract.

For each contract:
  - sector (uniformed / education / health / clerical / skilled-trades / professional / managerial / other)
  - union_full / local / employer (from label + curated lookup)
  - summary (from recognition clause where present, else label-derived stub)
  - headcount + headcount_source (curated for major unions; null for the rest)
  - titles (extracted from recognition clause where present)
"""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# Curated entries for the largest / best-known bargaining units.
# Headcounts are approximate, sourced from cited public documents.
# Where no public source is currently linked, headcount is null.
CURATED = {
    "uft-moa-2022-2027": {
        "union_full": "United Federation of Teachers (UFT), Local 2, AFT, AFL-CIO",
        "local": "Local 2",
        "employer": "NYC Department of Education / Board of Education",
        "sector": "education",
        "headcount": 120000,
        "headcount_note": "About 120,000 municipal employees covered by this agreement, per the NYC Mayor's Office (June 2023).",
        "summary": "The largest single bargaining unit in NYC government. Covers DOE teachers, paraprofessionals, school secretaries, guidance counselors, social workers, psychologists, attendance teachers, lab specialists, and related school-based titles.",
        "titles": ["Teacher", "Paraprofessional", "School Secretary", "Guidance Counselor", "Social Worker", "School Psychologist", "Educational Assistant", "Lab Specialist"],
    },
    "dc37-moa-2021-2026": {
        "union_full": "American Federation of State, County and Municipal Employees (AFSCME), District Council 37, AFL-CIO",
        "local": "DC 37 (umbrella for ~50 affiliated locals)",
        "employer": "City of New York (mayoral agencies, HHC, NYCHA, CUNY, libraries)",
        "sector": "clerical-and-professional",
        "headcount": 90000,
        "headcount_note": "Nearly 90,000 municipal employees covered by this agreement, per the NYC Mayor's Office tentative-agreement announcement (Feb. 2023). DC 37's total membership is larger, but not all of it works under this agreement.",
        "summary": "The largest public-employee union in New York City. The DC 37 economic agreement sets wage pattern for ~50 affiliated locals covering clerical, technical, custodial, library, school-support, and professional titles across mayoral agencies, HHC, NYCHA, CUNY, and the public libraries.",
        "titles": ["Office Aide", "Clerical Associate", "Caseworker", "Eligibility Specialist", "Custodian", "School Aide", "Special Officer", "Accountant", "Computer Associate"],
    },
    "pba-mou-2017-2025": {
        "union_full": "Patrolmen's Benevolent Association of the City of New York (PBA NYC)",
        "local": "PBA",
        "employer": "NYC Police Department",
        "sector": "uniformed-police",
        "headcount": 22000,
        "headcount_note": "About 22,000 police officers (22,084 as of Oct. 1, 2025), per the NYPD demographics report published by the NYC Council Finance Division.",
        "summary": "Represents all rank-and-file NYPD police officers below the rank of sergeant. This agreement expired July 31, 2025; the PBA declared an impasse with the state Public Employment Relations Board in June 2026, and it stays in force until a successor is reached.",
        "titles": ["Police Officer"],
    },
    "uniformed-coalition-economic-agreement-2022-2027": {
        "union_full": "Uniformed Officers Coalition (11 unions: DEA, SBA, LBA, CEA, UFA, UFOA, COBA, CCA, ADW/DWA, SOA and USCA)",
        "local": "Multiple uniformed locals",
        "employer": "City of New York (NYPD, FDNY, DOC, DSNY)",
        "sector": "uniformed-pattern",
        "headcount": None,
        "headcount_note": "Coalition-level economic terms; underlying individual unit agreements set unit-specific headcounts.",
        "summary": "The economic-pattern agreement that sets wage increases and lump sums for 11 uniformed unions in police, fire, correction and sanitation. Each union's terms are then written into its own successor unit agreement; the UFA's and UFOA's have not been published.",
        "titles": [],
    },
    "usa-executed-contract-2022-2028": {
        "union_full": "Uniformed Sanitationmen's Association, Local 831 IBT",
        "local": "Local 831",
        "employer": "NYC Department of Sanitation",
        "sector": "uniformed-sanitation",
        "headcount": 7100,
        "headcount_note": "About 7,100 sanitation workers covered by this agreement, per the NYC Mayor's Office (Oct. 2023).",
        "summary": "Represents all uniformed sanitation workers below supervisor rank — the core of DSNY's collection, plowing, and street-cleaning workforce.",
        "titles": ["Sanitation Worker"],
    },
    "csa-moa-2023-2028-amended-appendix-a": {
        "union_full": "Council of School Supervisors and Administrators (CSA), Local 1 AFSA, AFL-CIO",
        "local": "Local 1 AFSA",
        "employer": "NYC Department of Education",
        "sector": "education-management",
        "headcount": 6400,
        "headcount_note": "About 6,400 principals, assistant principals, supervisors and education administrators covered by this agreement, per the NYC Mayor's Office (Oct. 2023).",
        "summary": "Represents NYC public school principals, assistant principals, education administrators, and supervisors. The supervisory counterpart to UFT.",
        "titles": ["Principal", "Assistant Principal", "Supervisor", "Education Administrator"],
    },
    "ibt-l237-moa-2022-2027": {
        "union_full": "International Brotherhood of Teamsters, Local 237",
        "local": "Local 237",
        "employer": "NYC (NYCHA, DOE School Safety, NYPD School Safety, multiple agencies)",
        "sector": "clerical-and-special-officer",
        "headcount": 9000,
        "headcount_note": "Over 9,000 municipal employees covered by this agreement, per the NYC Mayor's Office tentative-agreement announcement (June 26, 2023). Local 237's total membership is larger and spans other contracts, including separate trade agreements in this database.",
        "summary": "Covers school safety agents, special officers (including hospital police at NYC Health + Hospitals and homeless services police), bridge operators, Department of Education food service managers and custodians, evidence and property control specialists, taxi and limousine inspectors and other titles.",
        "titles": ["School Safety Agent", "Special Officer", "Bridge Operator", "Evidence and Property Control Specialist", "Taxi and Limousine Inspector", "Stock Worker"],
    },
    "cwa-1180-moa-2021-2026": {
        "union_full": "Communications Workers of America, Local 1180, AFL-CIO",
        "local": "Local 1180",
        "employer": "City of New York (multiple agencies)",
        "sector": "supervisory-clerical",
        "headcount": 8200,
        "headcount_note": "About 8,200 employees covered by this agreement, per the NYC Mayor's Office (2023).",
        "summary": "Represents Administrative Managers, Principal Administrative Associates, and other supervisory clerical titles across mayoral agencies. In 2019 it settled a pay-discrimination case brought through the Equal Employment Opportunity Commission (EEOC) for $15 million in back pay.",
        "titles": ["Administrative Manager", "Principal Administrative Associate", "Administrative Staff Analyst"],
    },
    "sba-unit-agreement-2021-2026": {
        "union_full": "Sergeants Benevolent Association of the City of New York (SBA)",
        "local": "SBA",
        "employer": "NYC Police Department",
        "sector": "uniformed-police",
        "headcount": 4400,
        "headcount_note": "About 4,400 NYPD sergeants, per the NYC Mayor's Office (Apr. 2025); the NYC Council Finance Division counted 4,307 in sergeant ranks as of Oct. 1, 2025.",
        "summary": "Represents all NYPD sergeants. In this round the SBA bargained as part of the Uniformed Officers Coalition.",
        "titles": ["Sergeant"],
    },
    "dea-unit-agreement-2022-2027": {
        "union_full": "NYC Detectives' Endowment Association",
        "local": "DEA",
        "employer": "NYC Police Department",
        "sector": "uniformed-police",
        "headcount": 5000,
        "headcount_note": "About 5,000 NYPD detectives of all grades, including detective specialists (5,012 as of Oct. 1, 2025), per the NYPD demographics report published by the NYC Council Finance Division.",
        "summary": "Represents NYPD detectives of all grades.",
        "titles": ["Detective"],
    },
    "l1199-moa-2022-2027": {
        "union_full": "1199 SEIU United Healthcare Workers East",
        "local": "1199 SEIU",
        "employer": "NYC Health + Hospitals",
        "sector": "health",
        "headcount": 2500,
        "headcount_note": "About 2,500 caregivers in 1199 SEIU's citywide City / H+H bargaining unit, per a June 2014 joint 1199 SEIU and NYSNA announcement; no more recent figure was found. (The larger 1199 figures cited publicly cover its private voluntary-hospital contracts, not NYC employment.)",
        "summary": "Represents non-RN healthcare workers at NYC Health + Hospitals — patient care assistants, dietary, environmental services, technical and professional titles. (Not to be confused with 1199's much larger private-sector NYC membership.)",
        "titles": ["Patient Care Associate", "Dietary Aide", "Environmental Services Aide", "Pharmacy Technician"],
    },
    "ufa-moa-2017-2020": {
        "union_full": "Uniformed Firefighters Association of Greater New York (UFA), IAFF Local 94",
        "local": "IAFF Local 94",
        "employer": "NYC Fire Department",
        "sector": "uniformed-fire",
        "headcount": 8500,
        "headcount_note": "~8,500 active FDNY firefighters (8,533 filled in the Firefighter title as of 10/10/2025), per the FDNY Fire Workforce Analysis published by the NYC Council Finance Division.",
        "summary": "Represents all New York City firefighters below officer rank. The most recent UFA agreement published by the Office of Labor Relations is the 2017-2020 MOA. The UFA signed the 2022-2027 Uniformed Officers Coalition Economic Agreement (also in this database), which sets its raises for the round that began Aug. 1, 2020; the UFA's successor unit agreements have not been published.",
        "titles": ["Firefighter", "Fire Marshal", "Wiper", "Pilot", "Marine Engineer (FDNY)"],
    },
    "ufoa-fire-officers-2018-2021": {
        "union_full": "Uniformed Fire Officers Association (UFOA), IAFF Local 854",
        "local": "IAFF Local 854",
        "employer": "NYC Fire Department",
        "sector": "uniformed-fire",
        "headcount": 2400,
        "headcount_note": "~2,400 active FDNY fire officers (lieutenants, captains, battalion and deputy chiefs, medical officers and supervising fire marshals; 2,406 filled as of 10/10/2025), per the FDNY Fire Workforce Analysis (NYC Council Finance Division).",
        "summary": "Represents FDNY lieutenants, captains, battalion chiefs, deputy chiefs, fire medical officers, and supervising fire marshals. The most recent UFOA agreement published by the Office of Labor Relations is the 2018-2021 Fire Officers Agreement. The UFOA signed the 2022-2027 Uniformed Officers Coalition Economic Agreement, which sets its raises for the round that began July 31, 2021; its successor unit agreement has not been published.",
        "titles": ["Lieutenant", "Captain", "Battalion Chief", "Deputy Chief", "Fire Medical Officer", "Supervising Fire Marshal"],
    },
    "nysna-staff-nurses-2019-2023": {
        "union_full": "New York State Nurses Association (NYSNA)",
        "local": "NYSNA",
        "employer": "NYC Health + Hospitals (Mayoral)",
        "sector": "health",
        "headcount": 8000,
        "headcount_note": "~8,000 RNs across NYC H+H facilities and mayoral agencies, per NYSNA's 2023 pay-parity contract announcement (July 31, 2023). Not an H+H-only subtotal.",
        "summary": "Represents registered nurses at NYC Health + Hospitals (the City's public hospital system) and the Mayoral / civilian workforce. This 2019-2023 agreement has been replaced: a five-and-a-half-year successor with pay parity was settled in July 2023, but its text has not been published by the Office of Labor Relations or NYC Health + Hospitals.",
        "titles": ["Staff Nurse", "Nurse Practitioner", "Clinical Nurse Specialist", "Nurse Manager"],
    },
    "psc-cuny-moa-2023-2027": {
        "union_full": "Professional Staff Congress of CUNY (PSC), AFT Local 2334",
        "local": "AFT Local 2334",
        "employer": "City University of New York (CUNY)",
        "sector": "education",
        "headcount": 30000,
        "headcount_note": "Over 30,000 full- and part-time faculty and professional staff, per CUNY's announcement of the agreement.",
        "summary": "Represents full-time and adjunct faculty, professional staff, and graduate-employee teaching assistants across the City University of New York. Bargains with CUNY; the agreements are published by CUNY rather than on the Office of Labor Relations Recent Agreements page. The 2023-2027 MOA modifies the underlying 2017-2023 PSC-CUNY agreement (also in this corpus).",
        "titles": ["Professor", "Associate Professor", "Assistant Professor", "Lecturer", "Adjunct Faculty", "Higher Education Officer", "College Lab Technician", "Graduate Assistant"],
    },
    "psc-cuny-agreement-2017-2023": {
        "union_full": "Professional Staff Congress of CUNY (PSC), AFT Local 2334",
        "local": "AFT Local 2334",
        "employer": "City University of New York (CUNY)",
        "sector": "education",
        "headcount": 30000,
        # Same ~30,000 PSC members as the 2023-2027 MOA entry. Both documents
        # cover one population, so this one is excluded from the site-wide
        # covered-employee total to avoid double-counting.
        "headcount_duplicate_of": "psc-cuny-moa-2023-2027",
        "headcount_note": "~30,000 faculty and professional staff at CUNY per PSC public statements. This is the same population covered by the 2023-2027 PSC-CUNY MOA, not an additional 30,000; it is counted once in the site-wide total.",
        "summary": "Underlying 2017-2023 collective bargaining agreement between CUNY and PSC, modified by the 2023-2027 MOA (also in this corpus). Provides the full text of articles on workload, academic freedom, governance, grievance, and other non-economic provisions that the MOA does not re-state.",
        "titles": ["Professor", "Associate Professor", "Assistant Professor", "Lecturer", "Adjunct Faculty", "Higher Education Officer", "College Lab Technician", "Graduate Assistant"],
    },
    "deputy-sheriffs-moa-2022-2027": {
        "union_full": "New York City Deputy Sheriffs Benevolent Association",
        "local": "Deputy Sheriffs Benevolent Association",
        "employer": "City of New York (Sheriff's Office, Department of Finance)",
        "sector": "other",
        "headcount": None,
        "headcount_note": None,
        "summary": "Covers Deputy Sheriffs (Level I) in the New York City Sheriff's Office, the civil-enforcement arm of the Department of Finance. The 2022-2027 MOA, dated July 2026, applies the uniformed-coalition wage pattern (3.25/3.25/3.5/3.5/4.0) over a 62-month term and sets a new Level I salary schedule effective January 1, 2025.",
        "titles": ["Deputy Sheriff"],
    },
    "doctors-council-moa-2021-2026": {
        "union_full": "Doctors Council, SEIU Local 10MD",
        "local": "Doctors Council / SEIU Local 10MD",
        "employer": "NYC Health + Hospitals + multiple city agencies",
        "sector": "health-professional",
        "headcount": 500,
        "headcount_note": "~500 city-employed physicians (NYC H+H, DOHMH, and OCME medical examiners) covered by this Doctors Council public-sector MOA, per the NYC Mayor's Office (Dec 16, 2024). Attending physicians at H+H who are employed by affiliate groups such as PAGNY and Mount Sinai bargain separately, outside this agreement.",
        "summary": "Represents salaried physicians and dentists working for the city at NYC Health + Hospitals, the Department of Health and Mental Hygiene (DOHMH) and the Office of Chief Medical Examiner (OCME).",
        "titles": ["Physician", "Senior Physician", "Dentist"],
    },
}

# Sector classification keywords (applied in order; first match wins)
SECTOR_RULES = [
    (r"\bpolice\b|\bpba\b|\bsba\b|\bdea\b|\blba\b|\bcea\b|sergeants?|detectives?|lieutenants?|captains?", "uniformed-police"),
    (r"\bfire\b|\bufa\b|\bufoa\b|firefighters?|fire officers?", "uniformed-fire"),
    (r"\bsanitation\b|\bdsna\b|\busa\b|\busca\b|\busa-", "uniformed-sanitation"),
    (r"\bcorrection\b|\bcoba\b|\badwa\b|\bcoba\b|\badba\b", "uniformed-correction"),
    (r"\bteacher\b|\buft\b|\bcsa\b|\bcsba\b|principal|school", "education"),
    (r"\bdoctor|physician|dental|nurse|hospital|medical|health|1199|doctors council", "health"),
    (r"\binspector\b|\bdetective\b|investigat", "professional"),
    (r"electrician|carpenter|plumber|painter|machinist|mechanic|welder|engineer|trades?|steamfitter|boilermaker|locksmith|blacksmith|laborer|repairer|fitter|operator|crane|gasoline|sheet metal|sign|rigger|dockbuilder|ship", "skilled-trades"),
    (r"\battorney\b|\blawyer\b|\bale\b|legislative", "professional"),
    (r"\bdc37\b|\bdc 37\b|\bdistrict council 37\b|\blocal 37\b|\blocal 372\b|\blocal 1549\b|\blocal 983\b", "clerical-and-professional"),
    (r"administrative manager|administrative associate|cwa 1180|supervisory|managerial|managers", "supervisory-clerical"),
]


def classify(label: str) -> str:
    s = label.lower()
    for rx, sector in SECTOR_RULES:
        if re.search(rx, s):
            return sector
    return "other"


def auto_summary(contract, recog_text: str | None) -> str:
    if recog_text:
        # First sentence of the recognition clause if it's coherent
        first = re.split(r"(?<=[.\n])\s+", recog_text.strip(), maxsplit=1)[0]
        if 30 < len(first) < 320:
            return first
    label = contract["label"]
    return f"{label} — see contract for the full recognition clause defining covered titles."


def find_recognition_text(clauses, contract_id) -> str | None:
    # Best candidates: clauses whose heading contains "recognition" / "bargaining unit"
    candidates = []
    for c in clauses:
        if c["contract_id"] != contract_id:
            continue
        h = (c.get("heading") or "").lower()
        if "recognition" in h or "bargaining unit" in h or "preamble" in h or "recogni" in h:
            candidates.append(c)
    if candidates:
        # Pick the longest meaningful one
        candidates.sort(key=lambda x: -len(x.get("text") or ""))
        return candidates[0]["text"]
    # Fallback: scan first clause text for "recognized" pattern
    for c in clauses:
        if c["contract_id"] != contract_id:
            continue
        t = (c.get("text") or "")[:1500]
        if re.search(r"recogni[sz]e[ds]?\s+as|hereby recognized|exclusive (collective )?bargaining representative", t, re.I):
            return t
        break
    return None



# Headcounts checked against a primary source on 2026-09-25. Only these are
# marked headcount_verified, which is what the site uses to show a headcount
# on the home page and contract pages. Every quote below was read on the
# source page itself.
HEADCOUNT_SOURCES = {
    "dc37-moa-2021-2026": ("NYC Mayor's Office", "Feb. 2023", "https://www.nyc.gov/mayors-office/news/2023/02/mayor-adams-dc-37-tentative-contract-agreement-providing-fair-wage-increases-and", "This agreement will cover nearly 90,000 municipal employees"),
    "ibt-l237-moa-2022-2027": ("NYC Mayor's Office", "June 26, 2023", "https://www.nyc.gov/mayors-office/news/2023/06/mayor-adams-olr-commissioner-campion-tentative-contract-agreement-teamsters-local", "This agreement will cover over 9,000 municipal employees."),
    "uft-moa-2022-2027": ("NYC Mayor's Office", "June 2023", "https://www.nyc.gov/mayors-office/news/2023/06/mayor-adams-uft-tentative-contract-agreement-providing-substantial-wage-increases-to", "approximately 120,000 municipal employees"),
    "csa-moa-2023-2028-amended-appendix-a": ("NYC Mayor's Office", "Oct. 2023", "https://www.nyc.gov/office-of-the-mayor/news/804-23/mayor-adams-tentative-contract-agreement-council-school-supervisors-and", "This agreement will cover approximately 6,400 municipal employees"),
    "cwa-1180-moa-2021-2026": ("NYC Mayor's Office", "2023", "https://www.nyc.gov/office-of-the-mayor/news/681-23/mayor-adams-olr-commissioner-campion-contract-cwa-provide-fair-wage-increases-", "representing approximately 8,200 employees"),
    "doctors-council-moa-2021-2026": ("NYC Mayor's Office", "Dec. 2024", "https://www.nyc.gov/mayors-office/news/2024/12/mayor-adams-tentative-agreement-doctors-council-seiu-deliver-raises-500", "approximately 500 city employees"),
    "sba-unit-agreement-2021-2026": ("NYC Mayor's Office", "April 2025", "https://www.nyc.gov/mayors-office/news/2025/04/mayor-adams-olr-commissioner-campion-tentative-contract-agreement-sergeants", "covering approximately 4,400 New York City Police Department (NYPD) sergeants"),
    "usa-executed-contract-2022-2028": ("NYC Mayor's Office", "Oct. 2023", "https://www.nyc.gov/mayors-office/news/2023/10/mayor-adams-tentative-agreement-sanitation-workers-setting-record-fastest", "which would cover approximately 7,100 New York City sanitation workers"),
    "pba-mou-2017-2025": ("NYC Council Finance Division, NYPD demographics report", "Oct. 1, 2025", "https://council.nyc.gov/budget/wp-content/uploads/sites/54/2025/10/New-York-Police-Department-Demographics-Report-2.xlsx", "POLICE OFFICER ... 22,084"),
    "dea-unit-agreement-2022-2027": ("NYC Council Finance Division, NYPD demographics report", "Oct. 1, 2025", "https://council.nyc.gov/budget/wp-content/uploads/sites/54/2025/10/New-York-Police-Department-Demographics-Report-2.xlsx", "Detective 1st grade 279, 2nd grade 714, 3rd grade 2,961, detective specialist 1,058 (total 5,012)"),
    "ufa-moa-2017-2020": ("NYC Council Finance Division, FDNY uniformed personnel report", "Oct. 2025", "https://council.nyc.gov/budget/wp-content/uploads/sites/54/2025/10/Fire-Department-of-New-York-Uniformed-Personnel-Demographics-Report-1.pdf", "FIREFIGHTER ... 8533"),
    "ufoa-fire-officers-2018-2021": ("NYC Council Finance Division, FDNY uniformed personnel report", "Oct. 2025", "https://council.nyc.gov/budget/wp-content/uploads/sites/54/2025/10/Fire-Department-of-New-York-Uniformed-Personnel-Demographics-Report-1.pdf", "Lieutenant 1,373, captain 574, battalion chief 333, deputy chief 74 (2,354), plus supervising fire marshals and medical officers (2,406)"),
    "nysna-staff-nurses-2019-2023": ("NYSNA", "July 31, 2023", "https://www.nysna.org/press/2023/nyc-public-hospital-nurses-win-historic-contract-pay-parity-and-safe-staffing", "Approximately 8,000 NYSNA nurses at NYC Health+Hospitals facilities and Mayoral agencies"),
    "psc-cuny-moa-2023-2027": ("City University of New York", "2024", "https://www.cuny.edu/news/cuny-and-professional-staff-congress-announce-tentative-labor-agreement-covering-over-30000-cuny-employees/", "Tentative Labor Agreement Covering Over 30,000 CUNY Employees"),
    "psc-cuny-agreement-2017-2023": ("City University of New York", "2024", "https://www.cuny.edu/news/cuny-and-professional-staff-congress-announce-tentative-labor-agreement-covering-over-30000-cuny-employees/", "Tentative Labor Agreement Covering Over 30,000 CUNY Employees"),
}

def main():
    contracts = json.loads((DATA / "contracts.json").read_text())
    clauses = json.loads((DATA / "clauses.json").read_text())
    units = []
    for c in contracts:
        cid = c["id"]
        recog_text = find_recognition_text(clauses, cid)
        entry = {
            "contract_id": cid,
            "contract_label": c["label"],
            "term_start": c.get("term_start"),
            "term_end": c.get("term_end"),
            "sector": classify(c["label"]),
            "union_full": None,
            "local": None,
            "employer": None,
            "headcount": None,
            "headcount_note": None,
            "summary": auto_summary(c, recog_text),
            "titles": [],
            "curated": False,
        }
        if cid in CURATED:
            entry.update(CURATED[cid])
            entry["curated"] = True
        entry["headcount_verified"] = bool(entry.get("headcount")) and cid in HEADCOUNT_SOURCES
        if entry["headcount_verified"]:
            pub, date, url, quote = HEADCOUNT_SOURCES[cid]
            entry["headcount_source"] = {"publisher": pub, "date": date, "url": url, "quote": quote}
        units.append(entry)

    (DATA / "units.json").write_text(json.dumps(units, indent=1))
    n_curated = sum(1 for u in units if u["curated"])
    n_with_head = sum(1 for u in units if u["headcount"])
    print(f"Wrote {len(units)} bargaining units. Curated: {n_curated}. Headcount populated: {n_with_head}.")
    by_sector = {}
    for u in units:
        by_sector[u["sector"]] = by_sector.get(u["sector"], 0) + 1
    for s, n in sorted(by_sector.items(), key=lambda x: -x[1]):
        print(f"  {n:3d}  {s}")


if __name__ == "__main__":
    main()

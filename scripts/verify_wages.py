"""Check every curated general wage increase against the contract text.

For each increase in data/wages.json (entries marked verified "full"), look
for its effective date (any common written form) and its percentage within
a short window of each other in the contract's extracted text. Prints
PASS/FAIL per step; exits non-zero on any failure. Only contracts whose every
step passes are marked `text_checked: true`, which is what the contract pages
use to decide whether to show a wage schedule.
"""
import json, re, sys, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"]

def date_forms(iso):
    # The coalition agreement dates steps by month of each unit's term.
    if iso.startswith("month-"):
        n = int(iso.split("-")[1])
        if n == 1:
            return [r"first\s+day\s+of\s+the\s+applicable\s+Successor"]
        return [rf"{n}\s*(?:st|nd|rd|th)\s+month"]
    d = datetime.date.fromisoformat(iso)
    m, day, y = d.month, d.day, d.year
    mon = MONTHS[m-1]
    forms = [f"{mon} {day}, {y}", f"{mon} {day} {y}", f"{mon[:3]}. {day}, {y}", f"{mon[:3]} {day}, {y}",
             f"{m}/{day}/{y}", f"{m:02d}/{day:02d}/{y}", f"{m}/{day}/{y%100:02d}", f"{m:02d}/{day:02d}/{y%100:02d}"]
    return [re.escape(f).replace(r"\ ", r"\s*") for f in forms]

def pct_rx(p):
    whole = int(p)
    if abs(p - whole) < 1e-9:
        return rf"(?<![\d.]){whole}(?:\.0+)?\s*%"
    s = f"{p:.2f}".rstrip("0")
    return rf"(?<![\d.]){re.escape(s)}0*\s*%"

def main():
    wages = json.loads((DATA / "wages.json").read_text())
    bad = 0
    for w in wages:
        if not w.get("curated") or w.get("verified") != "full" or not w.get("increases"):
            w.pop("text_checked", None); continue
        text = (DATA / "text" / f"{w['contract_id']}.txt").read_text()
        flat = re.sub(r"\s+", " ", text)
        ok_all = True
        for inc in w["increases"]:
            ok = False
            for f in date_forms(inc["effective"]):
                for m in re.finditer(f, flat, re.I):
                    window = flat[max(0, m.start()-250): m.end()+250]
                    if re.search(pct_rx(inc["pct"]), window):
                        ok = True; break
                if ok: break
            print(("PASS" if ok else "FAIL"), w["contract_id"], inc["effective"], inc["pct"])
            ok_all &= ok
        w["text_checked"] = ok_all
        bad += 0 if ok_all else 1
    (DATA / "wages.json").write_text(json.dumps(wages, indent=1, ensure_ascii=False) + "\n")
    print("contracts failing:", bad)
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()

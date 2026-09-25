/* NYC labor union acronym dictionary, shared across pages.
 * Sources: NYC OLR Recent Agreements page + each union's official name.
 * Used to expand contract labels like "ADWA Unit Agreement, 2023-2028" →
 * "Assistant Deputy Wardens Association (ADWA) — Unit Agreement, 2023-2028"
 */
(() => {
  const MAP = {
    "ADWA":  "Assistant Deputy Wardens Association",
    "ADW/DW": "Assistant Deputy Wardens / Deputy Wardens",
    "ALE":   "Association of Legislative Employees",
    "CCA":   "Correction Captains Association",
    "CEA":   "Captains' Endowment Association (NYPD)",
    "CIR":   "Committee of Interns and Residents",
    "COBA":  "Correction Officers' Benevolent Association",
    "CSA":   "Council of School Supervisors and Administrators",
    "CSBA":  "Civil Service Bar Association",
    "CWA":   "Communications Workers of America",
    "DC37":  "District Council 37 of AFSCME",
    "DC 37": "District Council 37 of AFSCME",
    "DC9":   "District Council 9 of the Painters",
    "DEA":   "Detectives' Endowment Association",
    "DIA":   "Detective Investigator Association (District Attorneys' offices)",
    "EPO":   "Environmental Police Officers",
    "FADBA": "Fire Alarm Dispatchers Benevolent Association",
    "HSI":   "Highway and Sewer Inspectors",
    "HPPT":  "High Pressure Plant Tenders",
    "IATSE": "International Alliance of Theatrical Stage Employees",
    "IBT":   "International Brotherhood of Teamsters",
    "IUOE":  "International Union of Operating Engineers",
    "L3":    "IBEW Local 3",
    "L1199": "1199 SEIU United Healthcare Workers",
    "L237":  "Teamsters Local 237",
    "L1181": "CWA Local 1181",
    "L1182": "CWA Local 1182",
    "L1183": "CWA Local 1183",
    "L1180": "CWA Local 1180",
    "LBA":   "Lieutenants Benevolent Association",
    "LEEBA": "Law Enforcement Employees Benevolent Association",
    "MEBA":  "Marine Engineers Beneficial Association",
    "MMP":   "Masters, Mates & Pilots",
    "NYSNA": "New York State Nurses Association",
    "OSA":   "Organization of Staff Analysts",
    "PBA":   "Patrolmen's Benevolent Association",
    "SBA":   "Sergeants Benevolent Association",
    "SEIU":  "Service Employees International Union",
    "SOA":   "Sanitation Officers Association",
    "TEA":   "Traffic Enforcement Agents",
    "UBCJ":  "United Brotherhood of Carpenters and Joiners",
    "UFA":   "Uniformed Firefighters Association",
    "UFOA":  "Uniformed Fire Officers Association",
    "UFT":   "United Federation of Teachers",
    "UPOA":  "United Probation Officers Association",
    "USA":   "Uniformed Sanitationmen's Association",
    "USCA":  "Uniformed Sanitation Chiefs Association",
    // Doc/agreement-type words that aren't acronyms but appear in labels
    "MOA":   "Memorandum of Agreement",
    "MOU":   "Memorandum of Understanding",
  };

  // Words/phrases inside labels that should NOT be expanded (already plain English)
  const SKIP = new Set([
    "Local", "Bridge", "Painters", "Crane", "Operator", "Welders", "Oilers",
    "Compositors", "Carpenter", "Locksmith", "Boilermaker", "Glaziers",
    "Highway", "Sewer", "Inspectors", "Bricklayers", "Horseshoers",
    "Doctors", "Council", "Construction", "Laborers", "Repairers",
    "Sheet", "Metal", "Worker", "Auto", "Mechanics", "Letterer",
    "Sign", "Painter", "Rubber", "Tire", "Repairer", "Audiovisual",
    "Aide", "Technicians", "Carriage", "Upholsterer", "Mechanic",
    "Stationary", "Engineer", "Gasoline", "Roller", "Ship",
    "Electricians", "Steamfitters", "Blacksmith", "Clock",
    "Printing", "Press", "Operators", "Radio", "Repair",
    "Sewage", "Treatment", "Workers", "School", "Custodians",
    "Special", "Officer", "Security", "Traffic", "Enforcement",
    "Public", "Advocate", "Coalition", "Economic",
    "Skilled", "Trades", "Citywide", "Agreement", "Executed", "Unit",
    "Letter", "Side", "Determination", "Consent", "Bargaining",
    "Amended", "Appendix", "Final", "Fully", "Signed",
    "Riggers", "Dockbuilders", "Parking", "Control", "Specialists",
    "Service", "Workers", "Caretakers", "Park", "Rangers",
    "Senior", "Sr", "Building", "Class", "Level", "III", "IV", "II",
    "Wage", "Indenture", "and", "or", "the", "of", "for", "Press"
  ]);

  // Local-number → parent union, used to disambiguate similarly-named contracts.
  // Sources: NYC OLR + each parent union's published affiliate roster.
  const LOCAL_PARENT = {
    "5":     "Boilermakers Local Lodge 5",
    "14":    "Operating Engineers (IUOE)",
    "15":    "Operating Engineers (IUOE)",
    "30":    "Operating Engineers (IUOE)",
    "40":    "Iron Workers Local 40",
    "211":   "IUOE Local 211 (Allied Building Inspectors)",
    "237":   "Teamsters Local 237",
    "246":   "SEIU Local 246",
    "300":   "SEIU Local 300",
    "306":   "IATSE Local 306",
    "372":   "DC 37 Local 372 (School Aides)",
    "375":   "DC 37 Local 375",
    "376":   "DC 37 Local 376",
    "621":   "SEIU Local 621",
    "638":   "Steamfitters Local 638",
    "806":   "District Council 9 Local 806 (Bridge Painters)",
    "891":   "IUOE Local 891 (Custodian Engineers)",
    "924":   "DC 37 Local 924",
    "983":   "DC 37 Local 983",
    "1087":  "DC 37 Local 1087",
    "1157":  "DC 37 Local 1157",
    "1180":  "CWA Local 1180",
    "1181":  "CWA Local 1181",
    "1182":  "CWA Local 1182",
    "1183":  "CWA Local 1183",
    "1199":  "1199 SEIU United Healthcare Workers East",
    "1320":  "DC 37 Local 1320",
    "1549":  "DC 37 Local 1549",
    "1969":  "District Council 9 Local 1969",
  };

  function expandRest(s) {
    return s.replace(/\bMOA\b/g, "Memorandum of Agreement")
            .replace(/\bMOU\b/g, "Memorandum of Understanding");
  }

  function tryConsumeLocal(tokens, startIdx) {
    // Consumes "L<N>", "Local <N>", or bare "<N>" at startIdx if N is a known local.
    // Returns { localNum, consumed } or null.
    if (startIdx >= tokens.length) return null;
    const t = tokens[startIdx];
    let m = t.match(/^L(\d{1,4})$/i);
    if (m && LOCAL_PARENT[m[1]]) return { localNum: m[1], consumed: 1 };
    if (/^Local$/i.test(t) && tokens[startIdx + 1]) {
      const n = tokens[startIdx + 1].replace(/[^0-9]/g, "");
      if (LOCAL_PARENT[n]) return { localNum: n, consumed: 2 };
    }
    // Bare number (e.g., "CWA 1180")
    m = t.match(/^(\d{2,4})$/);
    if (m && LOCAL_PARENT[m[1]]) return { localNum: m[1], consumed: 1 };
    return null;
  }

  function expandLabel(label) {
    if (!label) return label;
    const tokens = label.split(/\s+/);
    if (!tokens.length) return label;

    // 1. Leading acronym (ADWA, COBA, UFT, IBT, CWA, DC37 etc.)
    const t0 = tokens[0].replace(/[^A-Z0-9/]/gi, "").toUpperCase();
    let mapKey = null;
    let consumed = 0;
    if (MAP[t0] && !SKIP.has(tokens[0])) {
      mapKey = t0; consumed = 1;
    } else if (tokens.length >= 2) {
      // "DC 37" two-token combined
      const combined = (tokens[0] + tokens[1]).replace(/[^A-Z0-9]/gi, "").toUpperCase();
      if (MAP[combined]) { mapKey = combined; consumed = 2; }
    }
    if (mapKey) {
      const parentName = MAP[mapKey];
      // Try to consume a local marker right after
      const localInfo = tryConsumeLocal(tokens, consumed);
      if (localInfo) {
        const rest = tokens.slice(consumed + localInfo.consumed).join(" ");
        return `${parentName} Local ${localInfo.localNum} (${mapKey} Local ${localInfo.localNum}) — ${expandRest(rest)}`;
      }
      const rest = tokens.slice(consumed).join(" ");
      return `${parentName} (${mapKey}) — ${expandRest(rest)}`;
    }

    // 2. Leading "Local <N>" or "L<N>" with no parent acronym
    const localInfo = tryConsumeLocal(tokens, 0);
    if (localInfo) {
      const rest = tokens.slice(localInfo.consumed).join(" ");
      return `${LOCAL_PARENT[localInfo.localNum]} — ${expandRest(rest)}`;
    }

    // 3. Fallback: just expand MOA/MOU
    return expandRest(label);
  }

  // Expose globally
  window.LABOR_ACRONYMS = MAP;
  window.expandContractLabel = expandLabel;
})();

/* Bargaining units browser — standalone page. */
(() => {
  const $ = (s) => document.querySelector(s);

  const SECTOR_LABELS = {
    "uniformed-police": "Uniformed — Police",
    "uniformed-fire": "Uniformed — Fire",
    "uniformed-sanitation": "Uniformed — Sanitation",
    "uniformed-correction": "Uniformed — Correction",
    "uniformed-pattern": "Uniformed — Coalition / pattern",
    "education": "Education",
    "education-management": "Education — Supervisors",
    "health": "Health (non-physician)",
    "health-professional": "Health — Physicians",
    "clerical-and-professional": "Clerical & professional",
    "clerical-and-special-officer": "Clerical & special officer",
    "supervisory-clerical": "Supervisory clerical",
    "skilled-trades": "Skilled trades",
    "professional": "Professional",
    "other": "Other / specialty",
  };

  const state = { units: [], sector: "", sort: "size", query: "" };

  async function init() {
    const r = await fetch("data/units.json");
    state.units = await r.json();
    populateSectorFilter();
    bind();
    parseQuery();
    render();
  }

  function populateSectorFilter() {
    const counts = {};
    state.units.forEach(u => counts[u.sector] = (counts[u.sector] || 0) + 1);
    const sel = $("#sector-filter");
    Object.keys(counts).sort().forEach(s => {
      const o = document.createElement("option");
      o.value = s; o.textContent = `${SECTOR_LABELS[s] || s} (${counts[s]})`;
      sel.appendChild(o);
    });
  }

  function bind() {
    $("#sector-filter").addEventListener("change", () => { state.sector = $("#sector-filter").value; writeQuery(); render(); });
    $("#sort-mode").addEventListener("change", () => { state.sort = $("#sort-mode").value; render(); });
    $("#q").addEventListener("input", debounce(() => { state.query = $("#q").value.trim().toLowerCase(); render(); }, 120));
  }

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  function parseQuery() {
    const p = new URLSearchParams(location.search);
    if (p.get("sector")) { state.sector = p.get("sector"); $("#sector-filter").value = state.sector; }
  }

  function writeQuery() {
    const p = new URLSearchParams();
    if (state.sector) p.set("sector", state.sector);
    history.replaceState(null, "", p.toString() ? `?${p.toString()}` : location.pathname);
  }

  function render() {
    let units = state.units.slice();
    if (state.sector) units = units.filter(u => u.sector === state.sector);
    if (state.query) {
      const q = state.query.toLowerCase();
      // Synonym map: common-language job terms → arrays of matching contract IDs.
      // Lets people type "cop" and find PBA, "firefighter" and find UFA, etc.
      const SYNONYMS = {
        "cop": ["pba-mou-2017-2025", "sba-unit-agreement-2021-2026", "dea-unit-agreement-2022-2027", "lba-10-5-2023-unit-bargaining-agreement", "cea-unit-agreement-2022-2027"],
        "police": ["pba-mou-2017-2025", "sba-unit-agreement-2021-2026", "dea-unit-agreement-2022-2027", "lba-10-5-2023-unit-bargaining-agreement", "cea-unit-agreement-2022-2027", "soa-unit-agreement-2023-2028", "dia-moa-2023-2028"],
        "police officer": ["pba-mou-2017-2025"],
        "patrolman": ["pba-mou-2017-2025"],
        "patrolwoman": ["pba-mou-2017-2025"],
        "detective": ["dea-unit-agreement-2022-2027"],
        "sergeant": ["sba-unit-agreement-2021-2026"],
        "lieutenant": ["lba-10-5-2023-unit-bargaining-agreement"],
        "captain": ["cea-unit-agreement-2022-2027"],
        "firefighter": ["uniformed-coalition-economic-agreement-2022-2027"],
        "fireman": ["uniformed-coalition-economic-agreement-2022-2027"],
        "fire officer": ["uniformed-coalition-economic-agreement-2022-2027"],
        "ems": ["uniformed-coalition-economic-agreement-2022-2027"],
        "emt": ["uniformed-coalition-economic-agreement-2022-2027"],
        "paramedic": ["uniformed-coalition-economic-agreement-2022-2027"],
        "sanitation": ["usa-executed-contract-2022-2028", "usca-unit-agreement-2022-2027"],
        "sanitation worker": ["usa-executed-contract-2022-2028"],
        "garbage": ["usa-executed-contract-2022-2028"],
        "trash": ["usa-executed-contract-2022-2028"],
        "correction": ["coba-unit-agreement-2022-2027", "adwa-unit-agreement-2023-2028"],
        "correction officer": ["coba-unit-agreement-2022-2027"],
        "warden": ["adwa-unit-agreement-2023-2028"],
        "teacher": ["uft-moa-2022-2027"],
        "paraprofessional": ["uft-moa-2022-2027"],
        "school secretary": ["uft-moa-2022-2027"],
        "guidance counselor": ["uft-moa-2022-2027"],
        "social worker": ["uft-moa-2022-2027", "dc37-moa-2021-2026"],
        "school psychologist": ["uft-moa-2022-2027"],
        "principal": ["csa-moa-2023-2028-amended-appendix-a"],
        "assistant principal": ["csa-moa-2023-2028-amended-appendix-a"],
        "school supervisor": ["csa-moa-2023-2028-amended-appendix-a"],
        "school custodian": ["local-891-school-custodians"],
        "custodian": ["local-891-school-custodians"],
        "school safety": ["ibt-l237-moa-2022-2027"],
        "school safety agent": ["ibt-l237-moa-2022-2027"],
        "special officer": ["ibt-l237-moa-2022-2027"],
        "doctor": ["doctors-council-moa-2021-2026"],
        "physician": ["doctors-council-moa-2021-2026"],
        "dentist": ["doctors-council-moa-2021-2026"],
        "intern": ["cir-executed-contract-2021-2027"],
        "resident": ["cir-executed-contract-2021-2027"],
        "nurse": ["l1199-moa-2022-2027"],
        "patient care": ["l1199-moa-2022-2027"],
        "hospital": ["l1199-moa-2022-2027", "doctors-council-moa-2021-2026", "cir-executed-contract-2021-2027"],
        "h+h": ["l1199-moa-2022-2027", "doctors-council-moa-2021-2026", "cir-executed-contract-2021-2027"],
        "clerical": ["dc37-moa-2021-2026", "cwa-1180-moa-2021-2026"],
        "office aide": ["dc37-moa-2021-2026"],
        "caseworker": ["dc37-moa-2021-2026"],
        "eligibility": ["dc37-moa-2021-2026"],
        "accountant": ["dc37-moa-2021-2026"],
        "administrative manager": ["cwa-1180-moa-2021-2026"],
        "administrative associate": ["cwa-1180-moa-2021-2026"],
        "staff analyst": ["osa-moa-2021-2027"],
        "supervisor": ["cwa-1180-moa-2021-2026", "osa-moa-2021-2027", "csa-moa-2023-2028-amended-appendix-a"],
        "lawyer": ["ale-executed-contract-2021-2027", "csba-moa-2021-2026"],
        "attorney": ["ale-executed-contract-2021-2027", "csba-moa-2021-2026"],
        "traffic enforcement": ["dc37-l983-traffic-enforcement-agent-level-iii-and-iv-moa-2021-2027", "school-security-traffic-moa-fully-executed"],
        "park ranger": ["dc37-l983-urban-park-rangers-moa-2021-2027"],
        "park": ["dc37-l983-urban-park-rangers-moa-2021-2027"],
        "housing": ["ibt-l237-moa-2022-2027"],
        "nycha": ["ibt-l237-moa-2022-2027", "dc37-moa-2021-2026"],
      };
      let synMatches = new Set();
      for (const term in SYNONYMS) {
        if (q.includes(term)) SYNONYMS[term].forEach(id => synMatches.add(id));
      }
      units = units.filter(u => {
        if (synMatches.has(u.contract_id)) return true;
        const blob = [u.contract_label, u.union_full, u.local, u.employer, u.summary, (u.titles || []).join(" ")].join(" ").toLowerCase();
        return blob.includes(q);
      });
    }
    if (state.sort === "size") {
      units.sort((a, b) => (b.headcount || 0) - (a.headcount || 0) || a.contract_label.localeCompare(b.contract_label));
    } else if (state.sort === "alpha") {
      units.sort((a, b) => a.contract_label.localeCompare(b.contract_label));
    } else if (state.sort === "term") {
      units.sort((a, b) => (a.term_end || 9999) - (b.term_end || 9999) || a.contract_label.localeCompare(b.contract_label));
    }

    $("#result-count").textContent = `${units.length} document${units.length === 1 ? "" : "s"}` +
      (state.sector ? ` in ${SECTOR_LABELS[state.sector] || state.sector}` : "") +
      (state.query ? ` matching "${state.query}"` : "");

    const root = $("#units");
    root.innerHTML = "";
    if (units.length === 0) {
      root.innerHTML = `<div class="unit-card"><div class="unit-body"><p>No units match. Clear filters or try a broader search.</p></div></div>`;
      return;
    }
    units.forEach(u => root.appendChild(card(u)));
  }

  function card(u) {
    const div = document.createElement("div");
    div.className = "unit-card";
    const headcount = u.headcount
      ? `<div class="unit-headcount"><span class="unit-headcount-num">${u.headcount.toLocaleString()}</span><span class="unit-headcount-label">covered employees${u.curated ? "" : " (estimate)"}</span></div>`
      : `<div class="unit-headcount unit-headcount-tbd"><span class="unit-headcount-num">—</span><span class="unit-headcount-label">headcount being sourced</span></div>`;
    const titles = (u.titles && u.titles.length)
      ? `<p class="unit-titles"><strong>Titles:</strong> ${u.titles.map(escapeHtml).join(" · ")}</p>` : "";
    const term = (u.term_start && u.term_end) ? `${u.term_start}–${u.term_end}` : "term n/a";
    const headNote = u.headcount_note
      ? `<p class="unit-headcount-note">${escapeHtml(u.headcount_note)}</p>` : "";
    div.innerHTML = `
      ${headcount}
      <div class="unit-body">
        <p class="unit-sector">${SECTOR_LABELS[u.sector] || u.sector}</p>
        <h3><a href="index.html#/contract/${encodeURIComponent(u.contract_id)}">${escapeHtml(window.expandContractLabel ? window.expandContractLabel(u.contract_label) : u.contract_label)}</a></h3>
        ${u.union_full ? `<p class="unit-union"><strong>${escapeHtml(u.union_full)}</strong>${u.local && u.local !== u.union_full ? " — " + escapeHtml(u.local) : ""}</p>` : ""}
        ${u.employer ? `<p class="unit-employer"><strong>Employer:</strong> ${escapeHtml(u.employer)}</p>` : ""}
        <p class="unit-summary">${escapeHtml(u.summary)}</p>
        ${titles}
        ${headNote}
        <p class="unit-term">Current agreement: ${term} · <a href="index.html#/contract/${encodeURIComponent(u.contract_id)}">browse clauses →</a></p>
      </div>
    `;
    return div;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[ch]);
  }

  init().catch(err => { $("#units").innerHTML = `<div class="unit-card"><div class="unit-body"><p>Failed to load: ${escapeHtml(err.message)}</p></div></div>`; });
})();

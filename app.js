/* NYC municipal labor contracts — frontend.
 * Loads contracts.json + clauses.json, searches them with an exact scan,
 * and renders five views: results, topic-pivot, compare, contracts, expirations.
 * Permalinks via URL hash so any clause can be cited directly.
 */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const TOPIC_LABELS = {
    "wages": "Wages & rates",
    "longevity": "Longevity",
    "overtime": "Overtime",
    "holidays": "Holidays",
    "vacation": "Vacation",
    "sick-leave": "Sick leave",
    "parental-leave": "Parental leave",
    "other-leave": "Other leave",
    "health-welfare": "Health & welfare",
    "pension": "Pension",
    "grievance": "Grievance & arbitration",
    "discipline": "Discipline & firing",
    "layoff": "Layoffs / RIF",
    "hours": "Hours & schedules",
    "shift-differential": "Shift differential",
    "uniform-allowance": "Uniform allowance",
    "training": "Training",
    "safety": "Safety",
    "no-strike": "No-strike",
    "management-rights": "Management rights",
    "work-rules": "Work rules",
    "agency-shop": "Union security",
    "recognition": "Recognition",
    "promotion": "Promotion",
    "telework": "Telework",
    "diversity": "Anti-discrimination",
    "workforce-comp": "Workforce composition"
  };

  const state = {
    contracts: [],
    contractById: {},
    clauses: [],
    units: [],
    unitByContract: {},
    missing: { unpublished: [] },
    missingByContract: {},
    unions: { sectors: [], continued_by: {} },
    unionByContract: {},
    includeEarlier: true,
    wagesByContract: {},
    index: null,
    view: "results",
    query: "",
    topic: "",
    contractFilter: "",
    sectorFilter: "",
    compareSet: new Set(),
  };

  // What kind of document each file actually is. Most of what OLR publishes is
  // an amendment that changes a few terms of an underlying agreement it does
  // not publish — so the directory groups by type instead of presenting a
  // 2,700-character memo and a 400,000-character contract as equivalents.
  const DOC_TYPE_ORDER = ["full-agreement", "consent-determination", "moa", "unit-agreement"];
  const DOC_TYPE_LABELS = {
    "full-agreement": "Full agreements",
    "consent-determination": "Consent determinations",
    "moa": "Amendments (memoranda of agreement)",
    "unit-agreement": "Uniformed unit agreements",
  };
  const DOC_TYPE_BLURB = {
    "full-agreement": "Self-contained collective bargaining agreements. These carry the complete article structure — recognition, grievance procedure, discipline, hours, leave — and can be read on their own.",
    "consent-determination": "Wage orders issued by the Comptroller under state Labor Law section 220 for skilled-trade titles, rather than bargained contracts. Most include a full Appendix A of time and leave benefits.",
    "moa": "Amendments. Each one changes specific economic terms — usually wages, welfare fund contributions and bonuses — and expressly leaves the rest of an underlying agreement in force. Those underlying agreements are public records, but the city does not link them from these documents, and most are not in this database; some sit unlinked on the city's own server, others are published by the unions or by outside databases. So an amendment on its own is not a complete statement of what governs the workers it covers.",
    "unit-agreement": "Short letters executed under the Uniformed Officers Coalition Economic Agreement. Wage increases come from that parent agreement; these add unit-specific items only.",
  };
  const DOC_TYPE_SHORT = {
    "full-agreement": "Full agreement",
    "consent-determination": "Consent determination",
    "moa": "Amendment",
    "unit-agreement": "Unit agreement",
  };

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

  /* ---------- Loading ---------- */
  async function loadJSON(path) {
    // Revalidate each load so corrections show up right away (a 304 is cheap).
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
    return r.json();
  }

  async function init() {
    let manifest = {};
    try { manifest = await loadJSON("data/manifest.json"); } catch (_) {}
    if (manifest.generated) $("#data-stamp").textContent = `Corpus generated ${manifest.generated}. ${manifest.contracts || ""} current documents${manifest.earlier_documents ? ` and ${manifest.earlier_documents} earlier agreements` : ""}, ${manifest.clauses || ""} clauses, ${manifest.ocr_pages || ""} OCR'd pages.`;

    // Earlier agreements (era "earlier") are older documents still partly in
    // force. They are searchable but kept apart from the current documents and
    // flagged wherever they appear.
    state.allContracts = await loadJSON("data/contracts.json");
    state.contractById = Object.fromEntries(state.allContracts.map(c => [c.id, c]));
    state.contracts = state.allContracts.filter(c => c.era !== "earlier");
    state.earlierDocs = state.allContracts.filter(c => c.era === "earlier");
    state.allClauses = await loadJSON("data/clauses.json");
    state.clauses = state.allClauses;
    try {
      state.units = await loadJSON("data/units.json");
      state.unitByContract = Object.fromEntries(state.units.map(u => [u.contract_id, u]));
    } catch (e) { state.units = []; }
    try {
      state.missing = await loadJSON("data/missing.json");
      (state.missing.unpublished || []).forEach(g => (g.flag || []).forEach(cid => {
        (state.missingByContract[cid] = state.missingByContract[cid] || []).push(g);
      }));
    } catch (e) { state.missing = { unpublished: [] }; }
    try {
      state.unions = await loadJSON("data/unions.json");
      state.unions.sectors.forEach(sec => sec.unions.forEach(u => u.docs.forEach(id => {
        if (!state.unionByContract[id]) state.unionByContract[id] = { union: u, sector: sec };
      })));
    } catch (e) { state.unions = { sectors: [], continued_by: {} }; }
    try {
      const wages = await loadJSON("data/wages.json");
      state.wagesByContract = Object.fromEntries(wages.filter(w => w.text_checked).map(w => [w.contract_id, w]));
    } catch (e) { state.wagesByContract = {}; }
    // Exact term dates read from each document (see methodology).
    try {
      const td = await loadJSON("data/term_dates.json");
      Object.entries(td.dates || {}).forEach(([id, d]) => {
        const c = state.contractById[id];
        if (c && d) Object.assign(c, { start_date: d.start, end_date: d.end, term_quote: d.quote, term_page: d.page });
      });
    } catch (e) { /* fall back to stated years */ }

    // Search is an exact scan over every clause (see compileQuery); keep a
    // combined heading + text string per clause so each query scans once.
    state.allClauses.forEach(c => { c._hay = (c.heading || "") + "\n" + (c.heading_raw || "") + "\n" + (c.text || ""); });
    setIncludeEarlier(state.includeEarlier);

    populateFilters();
    bindEvents();
    parseHashAndRender();
    // Focus the search box on the standalone page only — autofocus inside an
    // embed iframe would steal focus and scroll-jack the host article.
    if (!document.documentElement.classList.contains("embed")) {
      $("#q").focus({ preventScroll: true });
    } else {
      // Keep "Open full screen" pointing at the reader's current view.
      const fullLink = document.querySelector(".embed-topbar-link");
      const base = "https://vitalcity-nyc.github.io/nyc-labor-contracts/";
      const sync = () => { fullLink.href = base + location.hash; };
      window.addEventListener("hashchange", sync);
      window.addEventListener("labor:hash", sync);
      sync();
    }
  }

  function populateFilters() {
    const tf = $("#topic-filter");
    const used = {};
    state.clauses.forEach(c => (c.topics || []).forEach(t => used[t] = (used[t] || 0) + 1));
    Object.keys(TOPIC_LABELS).filter(t => used[t]).sort().forEach(t => {
      const o = document.createElement("option");
      o.value = t; o.textContent = `${TOPIC_LABELS[t]} (${used[t]})`;
      tf.appendChild(o);
    });
    const cf = $("#contract-filter");
    const addOpts = (parent, list) => list.slice().sort((a,b) => a.label.localeCompare(b.label)).forEach(c => {
      const o = document.createElement("option");
      o.value = c.id; o.textContent = window.expandContractLabel ? window.expandContractLabel(c.label) : c.label;
      parent.appendChild(o);
    });
    addOpts(cf, state.contracts);
    if (state.earlierDocs.length) {
      const g = document.createElement("optgroup");
      g.label = "Earlier agreements (may be superseded in part)";
      addOpts(g, state.earlierDocs);
      cf.appendChild(g);
    }
    const n = document.getElementById("earlier-count");
    if (n) n.textContent = state.earlierDocs.length;
    const wrap = document.getElementById("earlier-toggle-wrap");
    if (wrap) wrap.hidden = !state.earlierDocs.length;
  }

  /* ---------- Events ---------- */
  function bindEvents() {
    $("#q").addEventListener("input", debounce(() => {
      state.query = $("#q").value.trim();
      writeHash(); render();
    }, 150));
    $("#topic-filter").addEventListener("change", () => {
      state.topic = $("#topic-filter").value;
      writeHash(); render();
    });
    $("#contract-filter").addEventListener("change", () => {
      state.contractFilter = $("#contract-filter").value;
      writeHash(); render();
    });
    $("#view-mode").addEventListener("change", () => {
      state.view = $("#view-mode").value;
      writeHash(); render();
    });
    $("#random-btn").addEventListener("click", showRandomClause);
    const et = document.getElementById("earlier-toggle");
    if (et) et.addEventListener("change", () => { setIncludeEarlier(et.checked); writeHash(); render(); });
    document.querySelectorAll(".view-tabs button").forEach(b => b.addEventListener("click", () => {
      state.view = b.dataset.view;
      $("#view-mode").value = state.view;
      writeHash(); render();
    }));
    // Topic tags are spans; let Enter and Space activate them from the keyboard.
    document.addEventListener("keydown", ev => {
      if ((ev.key === "Enter" || ev.key === " ") && ev.target.classList && ev.target.classList.contains("tag")) {
        ev.preventDefault(); ev.target.click();
      }
    });
    window.addEventListener("hashchange", parseHashAndRender);
  }

  function isEarlier(c) { return !!c && c.era === "earlier"; }
  function isEarlierId(id) { return isEarlier(state.contractById[id]); }
  // Which clauses the views work from: all of them, or current documents only.
  function setIncludeEarlier(on) {
    state.includeEarlier = on;
    state.clauses = on ? state.allClauses : state.allClauses.filter(c => !isEarlierId(c.contract_id));
    const box = document.getElementById("earlier-toggle");
    if (box) box.checked = on;
  }

  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  /* ---------- Hash routing ---------- */
  function writeHash() {
    const params = new URLSearchParams();
    if (state.view !== "results") params.set("view", state.view);
    if (state.query) params.set("q", state.query);
    if (state.topic) params.set("topic", state.topic);
    if (state.contractFilter) params.set("contract", state.contractFilter);
    if (state.compareSet.size) params.set("compare", Array.from(state.compareSet).join(","));
    if (state.sectorFilter) params.set("sector", state.sectorFilter);
    if (!state.includeEarlier) params.set("earlier", "0");
    const h = params.toString();
    history.replaceState(null, "", h ? "#" + h : "#");
    window.dispatchEvent(new Event("labor:hash"));
  }

  function parseHashAndRender() {
    if (/^#sec-\d+$/.test(location.hash) && document.getElementById(location.hash.slice(1))) return;
    if (location.hash === "#missing") {
      state.view = "results"; state.query = ""; state.topic = ""; state.contractFilter = "";
      $("#q").value = ""; $("#topic-filter").value = ""; $("#contract-filter").value = ""; $("#view-mode").value = "results";
      render();
      const panel = document.getElementById("missing");
      if (panel) { panel.open = true; panel.scrollIntoView({ block: "start" }); }
      return;
    }
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    state.view = params.get("view") || "results";
    state.query = params.get("q") || "";
    // Only accept topics we know; anything else in the URL is dropped so a
    // crafted link can't inject markup into the topic headings.
    const topicParam = params.get("topic") || "";
    state.topic = Object.prototype.hasOwnProperty.call(TOPIC_LABELS, topicParam) ? topicParam : "";
    state.contractFilter = params.get("contract") || "";
    const cmp = params.get("compare");
    state.compareSet = new Set(cmp ? cmp.split(",").filter(Boolean) : []);
    state.sectorFilter = params.get("sector") || "";
    setIncludeEarlier(params.get("earlier") !== "0");
    $("#q").value = state.query;
    $("#topic-filter").value = state.topic;
    $("#contract-filter").value = state.contractFilter;
    $("#view-mode").value = state.view;

    // Direct clause permalink: #/clause/<id>
    if (location.hash.startsWith("#/clause/")) {
      const id = decodeURIComponent(location.hash.slice("#/clause/".length));
      $("#result-count").textContent = "";
      syncChrome("");
      renderSingleClause(id);
      return;
    }
    if (location.hash.startsWith("#/contract/")) {
      const id = decodeURIComponent(location.hash.slice("#/contract/".length));
      $("#result-count").textContent = "";
      syncChrome("");
      renderContractDetail(id);
      return;
    }
    render();
  }

  /* ---------- Filtering ---------- */
  function applyFilters(clauses) {
    let out = clauses;
    if (state.topic) out = out.filter(c => (c.topics || []).includes(state.topic));
    if (state.contractFilter) out = out.filter(c => c.contract_id === state.contractFilter);
    return out;
  }

  // Extract "quoted phrases" and the remaining unquoted query.
  // Returns { phrases: [...], rest: "loose tokens" }.
  function parseQuery(q) {
    const phrases = [];
    const rest = q.replace(/[“”]/g, '"').replace(/"([^"]+)"/g, (_, p) => {
      const trimmed = p.trim();
      if (trimmed) phrases.push(trimmed);
      return " ";
    }).trim();
    return { phrases, rest };
  }

  /* ---------- Search ----------
   * A query becomes a list of terms; a clause matches only if every term
   * matches its heading or text. Each term is a set of alternative patterns
   * (for example a union acronym and its full name). With about 2,200
   * clauses a full scan takes a few milliseconds, so results are exact:
   * no index, no cap.
   *   "quoted phrase"  exact words in order, any whitespace between them
   *   per-session      hyphen, space or nothing between the parts
   *   $1,000  § 220    numbers and symbols match literally
   *   DEA, tea, ale    words of 3 letters or fewer, and union acronyms, match
   *                    whole words only (plus a plural s)
   *   overtime         longer words match from the start of a word
   */
  const WORDCH = "A-Za-z0-9";
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const edgeL = s => /^[A-Za-z0-9]/.test(s) ? `(?<![${WORDCH}])` : "";
  const edgeR = s => /[A-Za-z0-9]$/.test(s) ? `(?![${WORDCH}])` : "";

  // Pattern for a literal run of text: whitespace-flexible, hyphens optional,
  // apostrophes optional, bounded at word edges.
  function literalSource(str) {
    const words = str.trim().split(/\s+/).filter(Boolean);
    const body = words.map(w => escRe(w)
      .replace(/-/g, "[-\\s]?")
      .replace(/['’]/g, "['’]?")).join("[\\s\u00a0]+");
    return edgeL(str.trim()) + body + edgeR(str.trim());
  }

  // Acronym families: every spelling of an acronym plus the union's full name
  // (parentheticals dropped), keyed by lower-case spelling.
  let acronymFamilies = null;
  function getAcronymFamilies() {
    if (acronymFamilies) return acronymFamilies;
    const byFull = new Map();
    Object.entries(window.LABOR_ACRONYMS || {}).forEach(([abbr, full]) => {
      const name = full.replace(/\s*\([^)]*\)/g, "").trim();
      if (!byFull.has(name)) byFull.set(name, new Set());
      byFull.get(name).add(abbr);
    });
    acronymFamilies = [];
    byFull.forEach((abbrs, name) => {
      const sources = [...abbrs].map(literalSource).concat([literalSource(name)]);
      acronymFamilies.push({ abbrs: [...abbrs], name, sources });
    });
    return acronymFamilies;
  }

  function compileQuery(q) {
    if (!q || !q.trim()) return null;
    const terms = [];
    const add = (sources, weight = 1) => terms.push({
      weight,
      tests: sources.map(src => new RegExp(src, "i")),
      counters: sources.map(src => new RegExp(src, "gi")),
      sources,
    });
    const { phrases, rest } = parseQuery(q);
    phrases.forEach(p => add([literalSource(p)], 2));

    // Pull out union names and multi-part acronyms ("DC 37", "ADW/DW") before
    // splitting on spaces, so each becomes one term matching every spelling.
    let loose = rest;
    const fams = getAcronymFamilies();
    fams.forEach(f => {
      [f.name, ...f.abbrs.filter(a => /[^A-Za-z0-9]/.test(a))].forEach(form => {
        const rx = new RegExp(literalSource(form), "i");
        if (rx.test(loose)) { loose = loose.replace(rx, " "); add(f.sources, 2); }
      });
    });

    // Join a bare $ or § to the number after it.
    const tokens = [];
    loose.split(/\s+/).filter(Boolean).forEach(t => {
      const prev = tokens[tokens.length - 1];
      if (prev && /^[$§¶]+$/.test(prev)) tokens[tokens.length - 1] = prev + (prev === "$" ? "" : " ") + t;
      else tokens.push(t);
    });
    tokens.forEach(tok => {
      const t = tok.replace(/^[.,;:!?"]+|[.,;:!?"]+$/g, "") || tok;
      const fam = fams.find(f => f.abbrs.some(a => a.toLowerCase() === t.toLowerCase()));
      if (fam) { add([literalSource(t).replace(/\(\?!\[[^\]]*\]\)$/, "(?:s)?$&"), ...fam.sources]); return; }
      if (/[^A-Za-z'’-]/.test(t) || /-/.test(t)) { add([literalSource(t)]); return; }
      const w = escRe(t).replace(/['’]/g, "['’]?");
      if (t.length <= 3) add([`(?<![${WORDCH}])${w}(?:s|es)?(?![${WORDCH}])`]);
      else add([`(?<![${WORDCH}])${w}`]);
    });
    if (!terms.length) return null;
    const all = terms.flatMap(t => t.sources);
    return { terms, hl: new RegExp(all.map(s => `(?:${s})`).join("|"), "gi") };
  }

  function clauseMatches(c, cq) {
    return cq.terms.every(t => t.tests.some(rx => rx.test(c._hay)));
  }

  // Relevance: heading hits first, then how often each term appears,
  // damped for very long clauses so a 100-page appendix doesn't win by bulk.
  function clauseScore(c, cq) {
    const len = (c.text || "").length;
    let score = 0;
    cq.terms.forEach(t => {
      let n = 0, head = false;
      t.counters.forEach((rx, i) => {
        rx.lastIndex = 0;
        n += ((c.text || "").match(rx) || []).length;
        if (t.tests[i].test(c.heading || "")) head = true;
      });
      // A heading hit counts for less on near-empty fragments (signature
      // blocks, letterheads) so they don't outrank real clauses.
      score += t.weight * (Math.min(n, 12) / (1 + len / 12000) + (head ? 8 * Math.min(1, len / 400) : 0));
    });
    // An earlier agreement's clause ranks below a current one with the same match.
    return isEarlierId(c.contract_id) ? score * 0.6 : score;
  }

  // Returns matching clauses, best first, or null when there's no query.
  function searchHits(pool = state.clauses) {
    const cq = compileQuery(state.query);
    if (!cq) return null;
    const hits = [];
    pool.forEach(c => { if (clauseMatches(c, cq)) hits.push({ c, s: clauseScore(c, cq) }); });
    hits.sort((a, b) => b.s - a.s);
    return hits.map(h => { h.c._score = h.s; return h.c; });
  }

  /* ---------- Rendering ---------- */
  // Tab state and the example-search line follow the current view.
  function syncChrome(view) {
    document.querySelectorAll(".view-tabs button").forEach(b => {
      const on = b.dataset.view === view;
      b.classList.toggle("active", on);
      b.setAttribute("aria-current", on ? "page" : "false");
    });
    const ex = $("#search-examples");
    if (ex) ex.hidden = !(view === "results" && !state.query);
  }

  function render() {
    const root = $("#results");
    root.innerHTML = "";
    $("#result-count").textContent = "";
    syncChrome(state.view);
    switch (state.view) {
      case "topic-pivot": return renderTopicPivot(root);
      case "compare":     return renderCompare(root);
      case "contracts":   return renderContracts(root);
      case "expirations": return renderExpirations(root);
      case "units":       return renderUnits(root);
      default:            return renderResults(root);
    }
  }

  function renderUnits(root) {
    const header = document.createElement("div");
    header.className = "topic-pivot-header";
    // Skip units flagged as covering a population already counted under another
    // contract (e.g. the 2017-2023 PSC-CUNY agreement and its 2023-2027 MOA are
    // the same ~30,000 people) so the total isn't inflated by double-counting.
    const totalCovered = state.units.reduce(
      (s, u) => s + (u.headcount_duplicate_of || !u.headcount_verified ? 0 : (u.headcount || 0)), 0);
    // Count the units actually contributing to the total, not every curated
    // unit — some curated entries have no sourced headcount, and one is a
    // duplicate population.
    const counted = state.units.filter(u => u.headcount_verified && !u.headcount_duplicate_of).length;
    header.innerHTML = `
      <h2>Bargaining units — who's covered</h2>
      <p>${state.units.length} documents across New York City government. Headcounts shown for ${counted} large units, totaling ~${totalCovered.toLocaleString()} covered employees, where a public source is available; smaller units' headcounts are still being sourced.</p>
    `;
    root.appendChild(header);

    // Sector filter
    const sectorBar = document.createElement("div");
    sectorBar.className = "sector-bar";
    const sectorCounts = {};
    state.units.forEach(u => sectorCounts[u.sector] = (sectorCounts[u.sector] || 0) + 1);
    const sectorOptions = ['<option value="">All sectors</option>']
      .concat(Object.keys(sectorCounts).sort().map(s =>
        `<option value="${s}"${state.sectorFilter===s?" selected":""}>${SECTOR_LABELS[s]||s} (${sectorCounts[s]})</option>`));
    sectorBar.innerHTML = `
      <label style="font-weight:700;font-size:0.78rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--vc-text-muted);margin-right:8px">Sector</label>
      <select id="sector-filter">${sectorOptions.join("")}</select>
      <span style="margin-left:14px;font-size:0.85rem;color:var(--vc-text-muted)">Sorted: largest known headcount first, then alphabetically.</span>
    `;
    root.appendChild(sectorBar);
    sectorBar.querySelector("#sector-filter").addEventListener("change", (e) => {
      state.sectorFilter = e.target.value;
      writeHash(); render();
    });

    // List
    let units = state.units.slice();
    if (state.sectorFilter) units = units.filter(u => u.sector === state.sectorFilter);
    units.sort((a, b) => {
      const ha = a.headcount || 0, hb = b.headcount || 0;
      if (ha !== hb) return hb - ha;
      return a.contract_label.localeCompare(b.contract_label);
    });

    units.forEach(u => {
      const card = document.createElement("div");
      card.className = "unit-card";
      const headcount = u.headcount && u.headcount_verified
        ? `<div class="unit-headcount"><span class="unit-headcount-num">${u.headcount.toLocaleString()}</span><span class="unit-headcount-label">covered employees${u.curated ? "" : " (estimate)"}</span></div>`
        : `<div class="unit-headcount unit-headcount-tbd"><span class="unit-headcount-num">—</span><span class="unit-headcount-label">headcount being sourced</span></div>`;
      const titles = (u.titles && u.titles.length)
        ? `<p class="unit-titles"><strong>Titles:</strong> ${u.titles.map(escapeHtml).join(" · ")}</p>` : "";
      const term = (u.term_start && u.term_end) ? `${u.term_start}–${u.term_end}` : "term n/a";
      const headNote = u.headcount_note
        ? `<p class="unit-headcount-note">${escapeHtml(u.headcount_note)}</p>` : "";
      card.innerHTML = `
        ${headcount}
        <div class="unit-body">
          <p class="unit-sector">${SECTOR_LABELS[u.sector] || u.sector}</p>
          <h3><a href="#/contract/${encodeURIComponent(u.contract_id)}">${escapeHtml(window.expandContractLabel ? window.expandContractLabel(u.contract_label) : u.contract_label)}</a></h3>
          ${u.union_full ? `<p class="unit-union"><strong>${escapeHtml(u.union_full)}</strong>${u.local && u.local !== u.union_full ? " — " + escapeHtml(u.local) : ""}</p>` : ""}
          ${u.employer ? `<p class="unit-employer"><strong>Employer:</strong> ${escapeHtml(u.employer)}</p>` : ""}
          <p class="unit-summary">${escapeHtml(u.summary)}</p>
          ${titles}
          ${headNote}
          <p class="unit-term">Current agreement: ${term} · <a href="#/contract/${encodeURIComponent(u.contract_id)}">browse clauses</a></p>
        </div>
      `;
      root.appendChild(card);
    });
    $("#result-count").textContent = `${units.length} bargaining units${state.sectorFilter ? ` in ${SECTOR_LABELS[state.sectorFilter]||state.sectorFilter}` : ""}`;
  }

  function renderResults(root) {
    // Empty default: no query, no topic, no contract filter → show contract tile grid.
    if (!state.query && !state.topic && !state.contractFilter) {
      return renderUnionIndex(root);
    }
    let clauses = searchHits(applyFilters(state.clauses));
    if (!clauses) clauses = applyFilters(state.clauses.slice());
    const contractCount = new Set(clauses.map(c => c.contract_id)).size;
    $("#result-count").textContent = state.query
      ? `${clauses.length} clause${clauses.length === 1 ? "" : "s"} across ${contractCount} contract${contractCount === 1 ? "" : "s"} matching "${state.query}"${(() => { const k = clauses.filter(c => isEarlierId(c.contract_id)).length; return k ? ` · ${k} from earlier agreements, flagged` : ""; })()}`
      : `${clauses.length} clauses${state.topic ? " on " + (TOPIC_LABELS[state.topic] || state.topic) : ""}${state.contractFilter ? " in " + (state.contractById[state.contractFilter]?.label || state.contractFilter) : ""}`;
    if (clauses.length === 0) {
      const words = (state.query || "").toLowerCase().split(/\W+/).filter(w => w.length > 3);
      const topics = Object.keys(TOPIC_LABELS).filter(t =>
        words.some(w => TOPIC_LABELS[t].toLowerCase().includes(w) || t.includes(w)));
      const topicLinks = topics.map(t => `<a href="#view=topic-pivot&topic=${encodeURIComponent(t)}">${escapeHtml(TOPIC_LABELS[t])}</a>`).join(", ");
      root.innerHTML = `<div class="empty-state">
        <p><strong>No clauses contain ${state.contractFilter || state.topic ? "that search with the current filters" : "all of those words"}.</strong></p>
        ${topicLinks ? `<p>The contracts may use different wording. Try the topic ${topics.length === 1 ? "tag" : "tags"} ${topicLinks}, which also ${topics.length === 1 ? "catches" : "catch"} related phrases.</p>` : ""}
        <p>Other things to try: fewer words, removing quotation marks${state.contractFilter || state.topic ? ", clearing the topic or contract filter" : ""}, or the start of a word ("arbitrat" finds arbitrate, arbitration and arbitrator).</p>
      </div>`;
      return;
    }

    // Group by contract. With a query, clauses arrive best first, so each
    // contract's position is set by its best clause; without one, keep
    // document order. Every matching contract is shown, with its top clauses
    // and a button for the rest.
    const groups = new Map();
    clauses.forEach(c => {
      if (!groups.has(c.contract_id)) groups.set(c.contract_id, []);
      groups.get(c.contract_id).push(c);
    });
    const perGroup = state.query ? 3 : 5;
    for (const [cid, items] of groups.entries()) {
      root.appendChild(contractGroup(cid, items, perGroup, state.query));
    }
  }

  function renderContracts(root) {
    return renderContractTiles(root, false);
  }

  function renderContractTiles(root, withIntro = true) {
    const contracts = state.contracts.slice().sort((a, b) => {
      const ua = state.unitByContract[a.id]?.headcount || 0;
      const ub = state.unitByContract[b.id]?.headcount || 0;
      if (ua !== ub) return ub - ua;
      return a.label.localeCompare(b.label);
    });
    $("#result-count").textContent = `${contracts.length} documents · click any tile to read`;
    const nAmend = state.contracts.filter(c => c.amends_predecessor).length;
    const intro = document.createElement("div");
    intro.className = "tiles-intro";
    intro.innerHTML = `<p>Click any document to read it in full. They are grouped by what they are: ${nAmend} of the ${state.contracts.length} are amendments that keep an older agreement in force and change only some terms. <a href="methodology.html#doc-types">What that means for coverage</a>.</p>`;
    if (withIntro) { root.appendChild(intro); root.appendChild(missingPanel()); }

    const byType = new Map();
    contracts.forEach(c => {
      const t = c.doc_type || "moa";
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(c);
    });
    DOC_TYPE_ORDER.filter(t => byType.has(t)).forEach(t => {
      const items = byType.get(t);
      const sec = document.createElement("section");
      sec.className = "doc-type-group";
      sec.innerHTML = `
        <header class="doc-type-header">
          <h2 class="doc-type-title">${DOC_TYPE_LABELS[t]} <span class="doc-type-count">${items.length}</span></h2>
          <p class="doc-type-blurb">${DOC_TYPE_BLURB[t]}</p>
        </header>
        <div class="contract-tile-grid"></div>
      `;
      const grid = sec.querySelector(".contract-tile-grid");
      items.forEach(c => grid.appendChild(contractTile(c)));
      root.appendChild(sec);
    });
    if (!withIntro && state.includeEarlier && state.earlierDocs.length) {
      const sec = document.createElement("section");
      sec.className = "doc-type-group is-earlier";
      sec.innerHTML = `
        <header class="doc-type-header">
          <h2 class="doc-type-title">Earlier agreements <span class="doc-type-count">${state.earlierDocs.length}</span></h2>
          <p class="doc-type-blurb">Older documents that current amendments keep partly in force. Later documents change some of their terms; each is flagged wherever it appears.</p>
        </header>
        <div class="contract-tile-grid"></div>`;
      const grid = sec.querySelector(".contract-tile-grid");
      state.earlierDocs.slice().sort((a, b) => a.label.localeCompare(b.label)).forEach(c => grid.appendChild(contractTile(c)));
      root.appendChild(sec);
    }
  }

  // Documents we know exist (or must exist) but that aren't in this database:
  // a one-line strip that opens to the list.
  function missingPanel() {
    const gaps = state.missing.unpublished || [];
    const noUnderlying = state.contracts
      .filter(lacksBase)
      .sort((a, b) => a.label.localeCompare(b.label));
    const nLinked = state.contracts.filter(linkedOnly).length;
    const nChain = state.contracts.filter(c => c.amends_predecessor && !c.companion && hasChain(c)).length;
    const nOutside = noUnderlying.length + nLinked;
    const label = c => escapeHtml(window.expandContractLabel ? window.expandContractLabel(c.label) : c.label);
    const names = gaps.map(g => g.short_name).filter(Boolean);
    const panel = document.createElement("details");
    panel.className = "missing-panel";
    panel.id = "missing";
    panel.innerHTML = `
      <summary>
        <span class="missing-panel-title">Known missing documents</span>
        <span class="missing-panel-sub">${gaps.length} current agreement${gaps.length === 1 ? " is" : "s are"} unpublished${names.length ? ` (${names.map(escapeHtml).join(", ")})` : ""}, and ${nOutside} amendments rely on an older agreement that isn't in this database${nChain ? ` (for ${nChain} more, the older agreements are now here, flagged as earlier)` : ""}.</span>
        <span class="missing-panel-toggle" aria-hidden="true"></span>
      </summary>
      <div class="missing-panel-body">
        <ul class="missing-list">
          ${gaps.map(g => `
            <li>
              <strong>${escapeHtml(g.union)}</strong>, ${escapeHtml(g.short_unit || "")}. ${escapeHtml(g.short || g.missing)}
              ${(g.have || []).filter(cid => state.contractById[cid]).map(cid => `<a href="#/contract/${encodeURIComponent(cid)}">${label(state.contractById[cid])}</a>`).join(" · ")}
              · <a href="${escapeHtml(g.evidence.url)}" target="_blank" rel="noopener" title="${escapeHtml(g.evidence.publisher)}, ${escapeHtml(g.evidence.date)}: ${escapeHtml(g.evidence.quote)}">Evidence &#8599;</a>
            </li>`).join("")}
          <li>
            <strong>Underlying agreements.</strong> ${nOutside} amendments change only some terms and keep an older agreement in force for the rest, including grievances, discipline and seniority. That older agreement is not in this database, so a search here can miss provisions that still apply.
            ${nLinked ? `For ${nLinked} of them, the document's page links the earlier agreement the city published, checked by reading both documents.` : ""}
            ${noUnderlying.length ? `For ${noUnderlying.length === nOutside ? "all of them" : `the other ${noUnderlying.length}`}, look on the Office of Labor Relations <a href="https://www.nyc.gov/site/olr/labor/labor-2017-2021-agreements.page" target="_blank" rel="noopener">2017-2021</a> and <a href="https://www.nyc.gov/site/olr/labor/labor-2010-2017-agreements.page" target="_blank" rel="noopener">2010-2017</a> agreement pages; these carry a pink "underlying agreement missing" tag.
            <details class="missing-underlying-wrap">
              <summary>List ${noUnderlying.length === 1 ? "it" : `all ${noUnderlying.length}`}</summary>
              <ul class="missing-underlying">
                ${noUnderlying.map(c => `<li><a href="#/contract/${encodeURIComponent(c.id)}">${label(c)}</a></li>`).join("")}
              </ul>
            </details>` : ""}
          </li>
        </ul>
        <p class="missing-checked">Last checked ${escapeHtml(state.missing.checked || "")}. <a href="methodology.html#gaps">How this list is kept</a>.</p>
      </div>`;
    return panel;
  }

  /* ---------- Dates and status ---------- */
  const AP_MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return `${AP_MONTHS[m - 1]} ${d}, ${y}`;
  }
  function termText(c) {
    if (c.start_date && c.end_date) return `${fmtDate(c.start_date)} to ${fmtDate(c.end_date)}`;
    if (c.term_start && c.term_end) return `${c.term_start}–${c.term_end}`;
    return "Term not stated";
  }
  // Where a contract stands today. Expired contracts generally stay in force
  // under the Triborough Amendment until a successor is reached.
  function contractStatus(c) {
    const gap = (state.missingByContract[c.id] || [])[0];
    if (gap && gap.status) return { key: gap.status_key || "continued", text: gap.status };
    const nextId = (state.unions.continued_by || {})[c.id];
    if (nextId && state.contractById[nextId]) {
      const next = state.contractById[nextId];
      return { key: "continued", text: `Expired; continued, as changed by the ${next.term_start}-${next.term_end} agreement` };
    }
    const today = new Date().toISOString().slice(0, 10);
    if (c.end_date) {
      if (c.end_date < today) return { key: "expired", text: `Expired ${fmtDate(c.end_date)}; terms continue until a successor is reached` };
      const days = (new Date(c.end_date) - new Date(today)) / 86400000;
      if (days <= 183) return { key: "expiring", text: `Expires ${fmtDate(c.end_date)}` };
      return { key: "current", text: `Runs to ${fmtDate(c.end_date)}` };
    }
    const y = new Date().getFullYear();
    if (!c.term_end) return { key: "unknown", text: "End date not stated" };
    if (c.term_end < y) return { key: "expired", text: `Expired in ${c.term_end}; terms continue until a successor is reached` };
    if (c.term_end === y) return { key: "expiring", text: `Ends in ${c.term_end} (exact date not stated)` };
    return { key: "current", text: `Runs to ${c.term_end}` };
  }

  // The label without the union name in front, for lists already grouped by union.
  function docShortLabel(c) {
    const full = window.expandContractLabel ? window.expandContractLabel(c.label) : c.label;
    const i = full.indexOf(" — ");
    return i > 0 ? full.slice(i + 3) : full;
  }

  // "UFT: Memorandum of Agreement, 2022-2027" — short but unambiguous.
  function chipLabel(c) {
    const name = state.unionByContract[c.id]?.union.name || "";
    const m = name.match(/\(([^)]+)\)/);
    const who = m ? m[1] : name.split(/[,(]/)[0].trim();
    return who ? `${who}: ${docShortLabel(c)}` : docShortLabel(c);
  }

  // An amendment whose base terms are nowhere in this database or linked.
  function hasChain(c) { return (c.lineage || []).some(id => isEarlierId(id)); }
  function lacksBase(c) { return c.amends_predecessor && !c.predecessor && !c.companion && !hasChain(c); }
  // An amendment linked to an earlier published agreement that is not in the database.
  function linkedOnly(c) { return c.amends_predecessor && c.predecessor && !c.companion && !hasChain(c); }

  function docBadges(c) {
    const gaps = (state.missingByContract[c.id] || [])
      .map(g => `<span class="contract-tile-missing" title="${escapeHtml(g.missing)}">${escapeHtml(g.badge)}</span>`).join("");
    const under = lacksBase(c)
      ? `<span class="contract-tile-missing" title="This document keeps an older agreement in force for everything it doesn't change. That older agreement is not in this database.">underlying agreement missing</span>` : "";
    return gaps + under;
  }

  /* ---------- Home: every union, by sector ---------- */
  function renderUnionIndex(root) {
    const nUnions = state.unions.sectors.reduce((n, s) => n + s.unions.length, 0);
    $("#result-count").textContent = `${state.contracts.length} documents from ${nUnions} unions and groups · click any document to read it`;
    const nAmend = state.contracts.filter(c => c.amends_predecessor).length;
    const intro = document.createElement("div");
    intro.className = "tiles-intro";
    intro.innerHTML = `<p>Every document, grouped by the union that signed it. ${nAmend} of the ${state.contracts.length} are amendments that keep an older agreement in force and change only some terms. <a href="methodology.html#doc-types">What that means for coverage</a>. To browse by document type instead, use the Directory tab.</p>`;
    root.appendChild(intro);
    root.appendChild(missingPanel());

    const jump = document.createElement("nav");
    jump.className = "sector-jump";
    jump.setAttribute("aria-label", "Jump to a sector");
    jump.innerHTML = state.unions.sectors.map(sec => `<a href="#" data-sector="${escapeHtml(sec.id)}">${escapeHtml(sec.name)}</a>`).join("");
    jump.querySelectorAll("a").forEach(a => a.addEventListener("click", ev => {
      ev.preventDefault();
      const el = document.getElementById(`sector-${a.dataset.sector}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    root.appendChild(jump);

    state.unions.sectors.forEach(sec => {
      const docsInSector = new Set(sec.unions.flatMap(u => u.docs));
      const block = document.createElement("section");
      block.className = "sector-block";
      block.id = `sector-${sec.id}`;
      block.innerHTML = `<h2 class="sector-title">${escapeHtml(sec.name)} <span class="sector-count">${sec.unions.length} ${sec.unions.length === 1 ? "union" : "unions"} · ${docsInSector.size} ${docsInSector.size === 1 ? "document" : "documents"}</span></h2>`;
      const list = document.createElement("div");
      list.className = "union-list";
      sec.unions.forEach(u => {
        const docs = u.docs.map(id => state.contractById[id]).filter(Boolean);
        const head = docs.map(c => state.unitByContract[c.id]).find(x => x && x.headcount_verified);
        const row = document.createElement("article");
        row.className = "union-row";
        row.innerHTML = `
          <div class="union-head">
            <h3 class="union-name">${escapeHtml(u.name)}</h3>
            ${head ? `<p class="union-meta">About ${head.headcount.toLocaleString()} workers covered</p>` : ""}
          </div>
          <ul class="union-docs">
            ${docs.map(c => {
              const stt = contractStatus(c);
              return `<li>
                <a class="union-doc-link" href="#/contract/${encodeURIComponent(c.id)}">${escapeHtml(docShortLabel(c))}</a>
                <span class="union-doc-meta"><span class="doc-kind">${escapeHtml(DOC_TYPE_SHORT[c.doc_type] || "Document")}</span> · <span class="doc-status status-${stt.key}">${escapeHtml(stt.text)}</span></span>
                ${docBadges(c) ? `<span class="union-doc-badges">${docBadges(c)}</span>` : ""}
                <button type="button" class="add-compare" data-id="${escapeHtml(c.id)}">${state.compareSet.has(c.id) ? "In compare" : "+ Compare"}</button>
              </li>`;
            }).join("")}
          </ul>
          ${(() => {
            const ids = new Set(u.docs);
            const earlier = state.earlierDocs.filter(e => (e.later_ids || []).some(id => ids.has(id)))
              .sort((a, b) => (b.end_date || "").localeCompare(a.end_date || ""));
            return earlier.length ? `<details class="union-earlier"><summary>Earlier agreements still partly in force (${earlier.length})</summary><ul>${
              earlier.map(e => `<li><a href="#/contract/${encodeURIComponent(e.id)}">${escapeHtml(e.label)}</a> <span class="union-doc-meta">${escapeHtml(termText(e))}${e.complete ? " · complete contract" : ""}</span></li>`).join("")}</ul></details>` : "";
          })()}`;
        list.appendChild(row);
      });
      block.appendChild(list);
      root.appendChild(block);
    });
    root.querySelectorAll(".add-compare").forEach(b => b.addEventListener("click", () => addToCompare(b.dataset.id, b)));
  }

  function addToCompare(id, btn) {
    if (state.compareSet.has(id)) { state.view = "compare"; $("#view-mode").value = "compare"; writeHash(); render(); window.scrollTo(0, $("#app").offsetTop); return; }
    if (state.compareSet.size >= 4) { flash(btn, "Compare holds 4"); return; }
    state.compareSet.add(id);
    writeHash();
    btn.textContent = "In compare";
    flash(null, `${state.compareSet.size} of 4 picked for comparison.`, true);
  }

  // A small status line under the controls, with a link into Compare.
  function flash(btn, msg, withLink) {
    if (btn) { const old = btn.textContent; btn.textContent = msg; setTimeout(() => btn.textContent = old, 1500); return; }
    let bar = $("#compare-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "compare-bar";
      bar.setAttribute("role", "status");
      document.body.appendChild(bar);
    }
    bar.innerHTML = `${escapeHtml(msg)} ${withLink ? `<button type="button">Open compare</button>` : ""}`;
    bar.hidden = false;
    const b = bar.querySelector("button");
    if (b) b.addEventListener("click", () => { bar.hidden = true; state.view = "compare"; $("#view-mode").value = "compare"; writeHash(); render(); window.scrollTo(0, $("#app").offsetTop); });
    clearTimeout(flash._t);
    flash._t = setTimeout(() => { bar.hidden = true; }, 6000);
  }

  /* ---------- Earlier agreements: flags ---------- */
  // Later documents in the database that continue (and change) an earlier agreement.
  function laterDocs(c) {
    return (c.later_ids || []).map(id => state.contractById[id]).filter(Boolean);
  }
  function laterLinks(c) {
    const docs = laterDocs(c);
    return docs.length
      ? docs.map(d => `<a href="#/contract/${encodeURIComponent(d.id)}">${escapeHtml(window.expandContractLabel ? window.expandContractLabel(d.label) : d.label)}</a>`).join(" · ")
      : "";
  }
  function earlierYears(c) {
    return c.start_date && c.end_date ? `${c.start_date.slice(0, 4)}–${c.end_date.slice(0, 4)}`
      : (c.term_start && c.term_end ? `${c.term_start}–${c.term_end}` : "older");
  }
  // Short flag for a clause card from an earlier agreement.
  function earlierCardFlag(c, compact) {
    if (compact) return `<p class="earlier-flag earlier-flag-short" role="note"><strong>Earlier agreement (${escapeHtml(earlierYears(c))}), may be superseded.</strong> Check the later documents before relying on this clause.</p>`;
    return `<p class="earlier-flag" role="note"><strong>Earlier agreement (${escapeHtml(earlierYears(c))}), may be superseded.</strong> Later documents keep parts of it in force and change others. Check them before relying on this clause${laterDocs(c).length ? `: ${laterLinks(c)}` : ""}.</p>`;
  }

  function contractTile(contract) {
    const tile = document.createElement("a");
    tile.className = "contract-tile";
    tile.href = `#/contract/${encodeURIComponent(contract.id)}`;
    const unit = state.unitByContract[contract.id];
    const term = (contract.term_start && contract.term_end) ? `${contract.term_start}–${contract.term_end}` : "term n/a";
    const clauseCount = state.clauses.filter(cl => cl.contract_id === contract.id).length;
    const sector = unit?.sector ? (SECTOR_LABELS[unit.sector] || unit.sector) : "";
    const headcountBadge = unit?.headcount_verified
      ? `<span class="contract-tile-headcount">${unit.headcount.toLocaleString()} covered</span>`
      : "";
    const qualityBadge = contract.ocr_quality === "poor"
      ? `<span class="contract-tile-ocr poor" title="This contract had a high density of OCR errors. Many have been corrected, but more may remain — verify quotes against the source PDF.">⚠ heavy OCR errors</span>`
      : contract.ocr_quality === "fair"
      ? `<span class="contract-tile-ocr fair" title="This contract had some OCR errors. Most have been corrected; verify quotes against the source PDF.">some OCR errors</span>`
      : "";
    const amendBadge = !contract.amends_predecessor ? ""
      : !lacksBase(contract)
      ? `<span class="contract-tile-amends" title="This document expressly leaves an underlying agreement in force and changes only the terms stated in it.">amends a prior agreement</span>`
      : `<span class="contract-tile-missing" title="This document expressly leaves an underlying agreement in force and changes only the terms stated in it. That underlying agreement is not in this database.">underlying agreement missing</span>`;
    const gapBadges = (state.missingByContract[contract.id] || [])
      .map(g => `<span class="contract-tile-missing" title="${escapeHtml(g.missing)}">${escapeHtml(g.badge)}</span>`).join("");
    tile.innerHTML = `
      <div class="contract-tile-kicker">${escapeHtml(sector)}${headcountBadge ? " · " + headcountBadge : ""}</div>
      <h3 class="contract-tile-name">${escapeHtml(window.expandContractLabel ? window.expandContractLabel(contract.label) : contract.label)}</h3>
      <div class="contract-tile-meta">
        <span class="contract-tile-term">${term}</span>
        <span class="contract-tile-clauses">${clauseCount} clause${clauseCount === 1 ? "" : "s"}</span>
        ${qualityBadge}
      </div>
      ${isEarlier(contract) ? `<span class="contract-tile-earlier">earlier agreement, may be superseded</span>` : `${gapBadges}
      ${amendBadge}`}
      ${hasChain(contract) ? `<span class="contract-tile-haspred">earlier agreements in database</span>` : contract.predecessor ? `<span class="contract-tile-haspred" title="${escapeHtml(contract.predecessor.label)} — published by ${escapeHtml(contract.predecessor.publisher)}">${contract.predecessor.relation === "nearest" ? "earlier agreement linked" : "underlying agreement linked"}</span>` : ""}
    `;
    return tile;
  }

  function contractGroup(contractId, allItems, perGroup, query) {
    const items = allItems.slice(0, perGroup);
    const totalInGroup = allItems.length;
    const wrap = document.createElement("section");
    wrap.className = "contract-group";
    const contract = state.contractById[contractId];
    const unit = state.unitByContract[contractId];
    const term = (contract?.term_start && contract?.term_end) ? `${contract.term_start}–${contract.term_end}` : "";
    const headcount = unit?.headcount_verified ? ` · ~${unit.headcount.toLocaleString()} covered` : "";
    const sector = unit?.sector ? `<span class="contract-group-sector">${SECTOR_LABELS[unit.sector] || unit.sector}${headcount}</span>` : "";
    const moreNote = items.length < totalInGroup
      ? `<span class="contract-group-more">Showing ${items.length} of ${totalInGroup} matches</span>`
      : `<span class="contract-group-count">${totalInGroup} match${totalInGroup === 1 ? "" : "es"}</span>`;
    if (isEarlier(contract)) wrap.classList.add("is-earlier");
    wrap.innerHTML = `
      ${isEarlier(contract) ? `<p class="earlier-group-flag">Earlier agreement · ${escapeHtml(earlierYears(contract))} · may be superseded in part</p>` : ""}
      <header class="contract-group-header">
        <a class="contract-group-title" href="#/contract/${encodeURIComponent(contractId)}">
          <span class="contract-group-name">${escapeHtml(window.expandContractLabel ? window.expandContractLabel(contract?.label || contractId) : (contract?.label || contractId))}</span>
          ${term ? `<span class="contract-group-term">${term}</span>` : ""}
        </a>
        <div class="contract-group-meta">
          ${sector}
          ${(state.missingByContract[contractId] || []).map(g => `<span class="contract-tile-missing">${escapeHtml(g.badge)}</span>`).join("")}
          ${moreNote}
        </div>
      </header>
      <div class="contract-group-clauses"></div>
    `;
    const slot = wrap.querySelector(".contract-group-clauses");
    items.forEach(c => slot.appendChild(clauseCard(c, query, true)));
    if (totalInGroup > items.length) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "contract-group-showall";
      more.textContent = `Show all ${totalInGroup} matches in this contract`;
      more.addEventListener("click", () => {
        allItems.slice(items.length).forEach(c => slot.appendChild(clauseCard(c, query, true)));
        more.remove();
        const note = wrap.querySelector(".contract-group-more");
        if (note) note.textContent = `${totalInGroup} matches`;
      });
      wrap.appendChild(more);
    }
    return wrap;
  }

  function renderTopicPivot(root) {
    const tilesWrap = document.createElement("div");
    if (!state.topic) {
      const header = document.createElement("div");
      header.className = "topic-pivot-header";
      header.innerHTML = `<h2>Topic pivot</h2><p>Pick a topic. You'll see every clause on that topic from every contract in one continuous list — sortable, comparable, citable.</p>`;
      root.appendChild(header);

      const grid = document.createElement("div");
      grid.className = "topic-tile-grid";
      const counts = {};
      state.clauses.forEach(c => (c.topics || []).forEach(t => counts[t] = (counts[t] || 0) + 1));
      Object.keys(TOPIC_LABELS).filter(t => counts[t]).sort((a,b) => counts[b]-counts[a]).forEach(t => {
        const tile = document.createElement("div");
        tile.className = "topic-tile";
        tile.setAttribute("role", "button");
        tile.tabIndex = 0;
        tile.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); tile.click(); } });
        tile.innerHTML = `<div>${TOPIC_LABELS[t]}</div><div class="count">${counts[t]} clauses across ${countContractsWithTopic(t)} contracts</div>`;
        tile.addEventListener("click", () => { state.topic = t; $("#topic-filter").value = t; writeHash(); render(); });
        grid.appendChild(tile);
      });
      root.appendChild(grid);
      return;
    }
    // Topic selected: show all clauses for it (narrowed by the search box, if used)
    const onTopic = applyFilters(state.clauses.filter(c => (c.topics || []).includes(state.topic)));
    const clauses = searchHits(onTopic) || onTopic;
    const nContracts = new Set(clauses.map(c=>c.contract_id)).size;
    $("#result-count").textContent = `${clauses.length} clauses on ${TOPIC_LABELS[state.topic] || state.topic} across ${nContracts} contracts${state.query ? ` matching "${state.query}"` : ""}`;
    const header = document.createElement("div");
    header.className = "topic-pivot-header";
    header.innerHTML = `<h2>${escapeHtml(TOPIC_LABELS[state.topic] || state.topic)}</h2><p>${clauses.length} clauses across ${nContracts} contracts${state.query ? ` matching &ldquo;${escapeHtml(state.query)}&rdquo;` : ""}. Click any clause heading to open it and copy its permalink.</p>`;
    root.appendChild(header);
    // Group by contract
    const byContract = {};
    clauses.forEach(c => { (byContract[c.contract_id] = byContract[c.contract_id] || []).push(c); });
    Object.entries(byContract).sort((a,b) => {
      const la = state.contractById[a[0]]?.label || a[0];
      const lb = state.contractById[b[0]]?.label || b[0];
      return la.localeCompare(lb);
    }).forEach(([cid, items]) => {
      const wrap = document.createElement("div");
      wrap.className = "clause";
      wrap.innerHTML = `<div class="clause-meta"><span class="contract">${escapeHtml(state.contractById[cid]?.label || cid)}</span><span>${items.length} clause${items.length===1?"":"s"}</span></div>`;
      items.forEach(c => wrap.appendChild(clauseCard(c, state.query, true)));
      root.appendChild(wrap);
    });
  }

  function countContractsWithTopic(t) {
    const s = new Set();
    state.clauses.forEach(c => { if ((c.topics || []).includes(t)) s.add(c.contract_id); });
    return s.size;
  }

  function renderCompare(root) {
    const header = document.createElement("div");
    header.className = "topic-pivot-header";
    header.innerHTML = `<h2>Compare contracts</h2><p>Pick up to four documents, then a topic or a search, to line up what each one says. You can also add documents from the home page with "+ Compare."</p>`;
    root.appendChild(header);

    const ctrl = document.createElement("div");
    ctrl.className = "compare-controls";
    const picked = Array.from(state.compareSet).filter(id => state.contractById[id]);
    const optgroups = state.unions.sectors.map(sec => `<optgroup label="${escapeHtml(sec.name)}">${
      sec.unions.flatMap(u => u.docs).filter((id, i, arr) => arr.indexOf(id) === i && !state.compareSet.has(id) && state.contractById[id])
        .map(id => `<option value="${escapeHtml(id)}">${escapeHtml(window.expandContractLabel ? window.expandContractLabel(state.contractById[id].label) : state.contractById[id].label)}</option>`).join("")
    }</optgroup>`).join("") + (state.earlierDocs.length ? `<optgroup label="Earlier agreements (may be superseded in part)">${
      state.earlierDocs.filter(d => !state.compareSet.has(d.id)).sort((a, b) => a.label.localeCompare(b.label))
        .map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.label)}</option>`).join("")}</optgroup>` : "");
    ctrl.innerHTML = `
      <div class="compare-picked">
        ${picked.map(id => `<span class="compare-chip">${escapeHtml(chipLabel(state.contractById[id]))} <button type="button" data-remove="${escapeHtml(id)}" aria-label="Remove">&times;</button></span>`).join("")}
        ${picked.length < 4 ? `<select id="cmp-add" aria-label="Add a document"><option value="">Add a document…</option>${optgroups}</select>` : ""}
        ${picked.length ? `<button type="button" id="cmp-clear" class="linklike">Clear all</button>` : ""}
      </div>
      <p class="compare-hint">${state.query ? `Showing clauses matching &ldquo;${escapeHtml(state.query)}&rdquo;${state.topic ? ` on ${escapeHtml(TOPIC_LABELS[state.topic] || state.topic)}` : ""}.` : state.topic ? `Showing clauses tagged ${escapeHtml(TOPIC_LABELS[state.topic] || state.topic)}. Change the topic above, or type in the search box.` : `Choose a topic above, or type in the search box, to line up clauses.`}</p>`;
    root.appendChild(ctrl);
    const sel = ctrl.querySelector("#cmp-add");
    if (sel) sel.addEventListener("change", () => {
      if (sel.value && state.compareSet.size < 4) state.compareSet.add(sel.value);
      writeHash(); render();
    });
    ctrl.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => { state.compareSet.delete(b.dataset.remove); writeHash(); render(); }));
    const clr = ctrl.querySelector("#cmp-clear");
    if (clr) clr.addEventListener("click", () => { state.compareSet.clear(); writeHash(); render(); });

    if (!picked.length) { $("#result-count").textContent = "No documents picked yet"; return; }
    if (!state.topic && !state.query) {
      $("#result-count").textContent = `${picked.length} ${picked.length === 1 ? "document" : "documents"} picked`;
      // Offer the topics these documents share, as a shortcut.
      const counts = {};
      picked.forEach(id => state.clauses.filter(c => c.contract_id === id).forEach(c => (c.topics || []).forEach(t => { counts[t] = counts[t] || new Set(); counts[t].add(id); })));
      const shared = Object.keys(counts).filter(t => TOPIC_LABELS[t]).sort((x, y) => counts[y].size - counts[x].size || TOPIC_LABELS[x].localeCompare(TOPIC_LABELS[y]));
      const box = document.createElement("div");
      box.className = "compare-topic-picks";
      box.innerHTML = `<p>Topics in these documents, most widely shared first:</p><p>${shared.map(t => `<a href="#" data-topic="${escapeHtml(t)}">${escapeHtml(TOPIC_LABELS[t])}</a> <span class="muted">(${counts[t].size} of ${picked.length})</span>`).join(" · ")}</p>`;
      box.querySelectorAll("[data-topic]").forEach(a => a.addEventListener("click", ev => { ev.preventDefault(); state.topic = a.dataset.topic; $("#topic-filter").value = state.topic; writeHash(); render(); }));
      root.appendChild(box);
      return;
    }

    const grid = document.createElement("div");
    grid.className = `compare-grid cols-${Math.max(2, picked.length)}`;
    let total = 0;
    picked.forEach(cid => {
      const c = state.contractById[cid];
      let matches = state.allClauses.filter(cl => cl.contract_id === cid && (!state.topic || (cl.topics || []).includes(state.topic)));
      if (state.query) matches = searchHits(matches) || [];
      total += matches.length;
      const col = document.createElement("div");
      col.className = "compare-col";
      col.innerHTML = `
        <header class="compare-col-head">
          <p class="compare-col-union">${escapeHtml(state.unionByContract[cid]?.union.name || "")}</p>
          <h3><a href="#/contract/${encodeURIComponent(cid)}">${escapeHtml(docShortLabel(c))}</a></h3>
          <p class="compare-col-meta">${escapeHtml(DOC_TYPE_SHORT[c.doc_type] || "Document")} · ${matches.length} ${matches.length === 1 ? "clause" : "clauses"}</p>
        </header>`;
      if (!matches.length) {
        const note = document.createElement("p");
        note.className = "compare-empty";
        note.textContent = c.amends_predecessor
          ? "Nothing on this in this document. It amends an older agreement that is not in this database, and that agreement may cover it."
          : "Nothing on this in this document.";
        col.appendChild(note);
      }
      matches.forEach(cl => col.appendChild(clauseCard(cl, state.query, true)));
      grid.appendChild(col);
    });
    $("#result-count").textContent = `${total} ${total === 1 ? "clause" : "clauses"} across ${picked.length} ${picked.length === 1 ? "document" : "documents"}`;
    root.appendChild(grid);
  }

  function renderExpirations(root) {
    const withStatus = state.contracts.map(c => ({ c, st: contractStatus(c) }));
    const byEnd = (x, y) => (x.c.end_date || `${x.c.term_end || 9999}-12-31`).localeCompare(y.c.end_date || `${y.c.term_end || 9999}-12-31`) || x.c.label.localeCompare(y.c.label);
    const groups = [
      ["superseded", "Replaced by an unpublished contract", "A successor has been reached, but its text is not public. The document here is out of date."],
      ["continued", "Expired, and continued as changed by a later agreement", "The later agreement changes some terms and keeps the rest of this one in force."],
      ["expired", "Past the stated end date", "Under New York's Triborough Amendment, the terms stay in force until a successor is reached."],
      ["expiring", "Ending within six months", ""],
      ["current", "Running", ""],
      ["unknown", "End date not stated", ""],
    ];
    const n = k => withStatus.filter(x => x.st.key === k).length;
    $("#result-count").textContent = `${n("expired") + n("continued") + n("superseded")} of ${state.contracts.length} documents are past their stated end date`;
    const intro = document.createElement("div");
    intro.className = "topic-pivot-header";
    intro.innerHTML = `<h2>Expirations</h2><p>Where each document stands today, using the exact term stated in the document. Hover over a date to see the wording it comes from.</p>`;
    root.appendChild(intro);

    groups.forEach(([key, title, blurb]) => {
      const items = withStatus.filter(x => x.st.key === key).sort(byEnd);
      if (!items.length) return;
      const sec = document.createElement("section");
      sec.className = `expiry-group expiry-${key}`;
      sec.innerHTML = `<h3>${escapeHtml(title)} <span class="sector-count">${items.length}</span></h3>${blurb ? `<p class="expiry-blurb">${escapeHtml(blurb)}</p>` : ""}
        <table class="expiry-table"><thead><tr><th>Document</th><th>Union</th><th>Term</th><th>Status</th></tr></thead><tbody>${
        items.map(({ c, st }) => `<tr>
          <td><a href="#/contract/${encodeURIComponent(c.id)}">${escapeHtml(docShortLabel(c))}</a></td>
          <td>${escapeHtml(state.unionByContract[c.id]?.union.name || "")}</td>
          <td${c.term_quote ? ` title="${escapeHtml(`p. ${c.term_page}: "${c.term_quote}"`)}"` : ""}>${escapeHtml(termText(c))}</td>
          <td class="status-${st.key}">${escapeHtml(st.text)}</td>
        </tr>`).join("")}</tbody></table>`;
      root.appendChild(sec);
    });
  }

  // The earlier agreement a document amends, as published by the city (not in
  // this database). "nearest" links were checked by reading both documents.
  function predecessorBlock(p) {
    const nearest = p.relation === "nearest";
    const kindNote = nearest && p.kind && p.kind !== "full"
      ? " That document is itself an amendment of a still earlier contract." : "";
    const base = p.base && p.base.url
      ? `<span class="doc-view-predecessor-src">Earlier full contract: <a href="${escapeHtml(p.base.url)}" target="_blank" rel="noopener">${escapeHtml(p.base.label)} &#8599;</a></span>` : "";
    return `
      <p class="doc-view-predecessor">
        <strong>${nearest ? "Earlier agreement for this unit" : "Read the underlying agreement"}:</strong>
        <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.label)} &#8599;</a>
        <span class="doc-view-predecessor-src">Published by ${escapeHtml(p.publisher)}${p.term ? `; term ${escapeHtml(p.term)}` : ""}. Not in this database, and the city does not link it from this document.${kindNote}${p.note ? ` ${escapeHtml(p.note)}` : ""}</span>
        ${base}
      </p>`;
  }

  // The documents that together govern a unit: this one, then each earlier
  // agreement it continues, newest first, back to the last complete contract.
  function lineageBlock(c) {
    const chain = (c.lineage || []).map(id => state.contractById[id]).filter(Boolean);
    if (!chain.length) return "";
    const item = d => `<li><a href="#/contract/${encodeURIComponent(d.id)}">${escapeHtml(window.expandContractLabel ? window.expandContractLabel(d.label) : d.label)}</a>
      <span class="lineage-meta">${escapeHtml(termText(d))} · ${escapeHtml(d.complete ? "complete contract" : (DOC_TYPE_SHORT[d.doc_type] || "document"))}${d.gap_note ? ` · ${escapeHtml(d.gap_note)}` : ""}</span></li>`;
    const last = chain[chain.length - 1];
    return `
      <aside class="lineage-box">
        <p class="lineage-title">What governs this unit</p>
        <p class="lineage-lead">This document changes some terms of the documents below, newest first, and keeps the rest in force. Where they conflict, the newer document governs. Older agreements are in this database and searchable, flagged as earlier wherever they appear.</p>
        <ol class="lineage-list">
          <li><strong>This document</strong> <span class="lineage-meta">${escapeHtml(termText(c))}</span></li>
          ${chain.map(item).join("")}
        </ol>
        ${last.complete ? "" : `<p class="lineage-lead">The chain stops before a complete contract: nothing earlier for this unit is published.</p>`}
      </aside>`;
  }

  function earlierBanner(c) {
    const later = laterDocs(c);
    return `
      <aside class="earlier-banner" role="note">
        <p><strong>Earlier agreement: parts may be superseded.</strong> Its term ran ${escapeHtml(termText(c))}. Later documents for this unit keep parts of it in force and change others; where they conflict, the later document governs. Before relying on any clause here, check whether a later document changed it.</p>
        ${later.length ? `<p>Later documents that continue this one: ${laterLinks(c)}.</p>` : ""}
        <p class="doc-view-predecessor-src">Published by ${escapeHtml(c.publisher || "the NYC Office of Labor Relations")}. <a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">Source PDF &#8599;</a></p>
      </aside>`;
  }

  // Wages and headcount for one contract, shown only where every number has
  // been checked: wage steps against the contract text (scripts/verify_wages.py)
  // and headcounts against a named primary source.
  function factsCard(c, unit) {
    const w = state.wagesByContract[c.id];
    const head = unit && unit.headcount_verified ? unit : null;
    if (!w && !head) return "";
    const fmtEff = e => /^\d{4}-\d{2}-\d{2}$/.test(e) ? fmtDate(e) : e.replace(/^month-(\d+)$/, (_, n) => n === "1" ? "First day of the term" : `First day of month ${n}`);
    const caveat = w && /Caveat:/.test(w.source_note || "") ? w.source_note.split("Caveat:")[1].trim() : "";
    const bonuses = w ? (w.bonuses || []).filter(b => b.amount) : [];
    return `
      <section class="facts-card" aria-label="Wages and headcount">
        ${head ? `<div class="facts-head">
          <p class="facts-label">Workers covered</p>
          <p class="facts-num">About ${head.headcount.toLocaleString()}</p>
          <p class="facts-src">${escapeHtml(head.headcount_source.publisher)}, ${escapeHtml(head.headcount_source.date)}: &ldquo;${escapeHtml(head.headcount_source.quote)}&rdquo; <a href="${escapeHtml(head.headcount_source.url)}" target="_blank" rel="noopener">Source &#8599;</a></p>
        </div>` : ""}
        ${w ? `<div class="facts-wages">
          <p class="facts-label">General wage increases in this document</p>
          <table class="facts-table"><tbody>
            ${w.increases.map(i => `<tr><td>${escapeHtml(fmtEff(i.effective))}</td><td>${i.pct.toFixed(2)}%</td></tr>`).join("")}
            <tr class="facts-total"><td>Compounded over the term</td><td>${w.cumulative_pct.toFixed(2)}%</td></tr>
          </tbody></table>
          ${bonuses.length ? `<p class="facts-src">Also: ${bonuses.map(b => b.type === "ratification" ? `a $${b.amount.toLocaleString()} ratification bonus, pro-rated for employees who are not full time` : `$${b.amount.toLocaleString()} ${escapeHtml(b.type)} payment${/^\d{4}-/.test(b.effective) ? ` (${escapeHtml(fmtDate(b.effective))})` : ""}`).join("; ")}.</p>` : ""}
          ${caveat ? `<p class="facts-caveat"><strong>Caveat:</strong> ${escapeHtml(caveat)}</p>` : ""}
          <p class="facts-src">Every step checked against this document's text. <a href="wages.html">Compare raises across contracts</a>.</p>
        </div>` : ""}
      </section>`;
  }

  function renderContractDetail(cid) {
    const c = state.contractById[cid];
    const unit = state.unitByContract[cid];
    const root = $("#results");
    root.innerHTML = "";
    if (!c) { root.innerHTML = `<p>Contract not found.</p>`; return; }
    const items = state.allClauses.filter(cl => cl.contract_id === cid);
    const term = (c.term_start && c.term_end) ? `${c.term_start}–${c.term_end}` : "term n/a";
    const expandedLabel = window.expandContractLabel ? window.expandContractLabel(c.label) : c.label;
    const ocrPages = new Set(items.filter(it => it.ocr).map(it => it.page));
    const totalPages = items.length ? Math.max(...items.map(it => it.page || 1)) : 0;

    const wrap = document.createElement("article");
    wrap.className = isEarlier(c) ? "doc-view is-earlier" : "doc-view";
    wrap.innerHTML = `
      <header class="doc-view-header">
        <p class="doc-view-back"><a href="#">← Back to all contracts</a></p>
        ${unit?.sector ? `<p class="doc-view-kicker">${SECTOR_LABELS[unit.sector] || unit.sector}${unit.headcount_verified ? " · ~" + unit.headcount.toLocaleString() + " covered" : ""}</p>` : ""}
        ${isEarlier(c) ? `<p class="earlier-group-flag">Earlier agreement · ${escapeHtml(earlierYears(c))} · may be superseded in part</p>` : ""}
        <h2 class="doc-view-title">${escapeHtml(expandedLabel)}</h2>
        ${isEarlier(c) ? earlierBanner(c) : ""}
        ${unit?.summary ? `<p class="doc-view-summary">${escapeHtml(unit.summary)}</p>` : ""}
        ${(state.missingByContract[cid] || []).map(g => `
          <aside class="doc-view-missing-note">
            <p><strong>Known missing document: ${escapeHtml(g.badge)}.</strong> ${escapeHtml(g.missing)}</p>
            <p>${escapeHtml(g.have_note)}</p>
            <p class="doc-view-amend-quote">Evidence: ${escapeHtml(g.evidence.publisher)}, ${escapeHtml(g.evidence.date)}: &ldquo;${escapeHtml(g.evidence.quote)}&rdquo; <a href="${escapeHtml(g.evidence.url)}" target="_blank" rel="noopener">Source &#8599;</a> · <a href="#missing">All known missing documents</a></p>
          </aside>`).join("")}
        ${c.amends_predecessor && !isEarlier(c) ? `
          <aside class="doc-view-amend-note">
            <p><strong>This is an amendment, not a complete contract.</strong> It changes the specific terms set out below and expressly leaves the rest of an underlying agreement in force, so provisions on grievance procedure, discipline, seniority and similar subjects may govern these workers without appearing anywhere in this document. ${hasChain(c) ? `The earlier agreements it continues are in this database, flagged as earlier; see "What governs this unit" below.` : c.companion ? `${escapeHtml(c.companion.note)} <a href="#/contract/${encodeURIComponent(c.companion.id)}">Open it</a>.` : c.predecessor ? "" : `<strong>That underlying agreement is missing from this database.</strong> ${c.base_note ? escapeHtml(c.base_note) : `The city does not link it from this document, but it posts earlier agreements on its <a href="https://www.nyc.gov/site/olr/labor/labor-2017-2021-agreements.page" target="_blank" rel="noopener">2017-2021</a> and <a href="https://www.nyc.gov/site/olr/labor/labor-2010-2017-agreements.page" target="_blank" rel="noopener">2010-2017</a> agreement pages.`} <a href="#missing">All known missing documents</a> · <a href="methodology.html#doc-types">Where to look for it</a>.`}</p>
            ${c.predecessor && !c.companion && !hasChain(c) ? predecessorBlock(c.predecessor) : ""}
            ${c.amends_evidence ? `<p class="doc-view-amend-quote">Language in this document: &ldquo;${escapeHtml(c.amends_evidence)}&hellip;&rdquo;</p>` : ""}
          </aside>` : ""}
        ${lineageBlock(c)}
        ${factsCard(c, unit)}
        <div class="doc-view-meta">
          <span><strong>Type</strong> ${DOC_TYPE_SHORT[c.doc_type] || "Document"}</span>
          <span><strong>Term</strong> <span${c.term_quote ? ` title="${escapeHtml(`p. ${c.term_page}: "${c.term_quote}"`)}"` : ""}>${escapeHtml(termText(c))}</span></span>
          <span><strong>Status</strong> <span class="status-${contractStatus(c).key}">${escapeHtml(contractStatus(c).text)}</span></span>
          <span><strong>Pages</strong> ${totalPages}${ocrPages.size ? ` (${ocrPages.size} OCR'd)` : ""}</span>
          <span><strong>Sections</strong> ${items.length}</span>
          <a href="https://notebooklm.google.com/notebook/40fefbdb-63d4-4b68-b2c1-771a8b0a3c5e" target="_blank" rel="noopener" class="doc-view-ai">Ask in Gemini Notebook &#8599;</a>
          <a href="data/markdown/${encodeURIComponent(c.id)}.md" download class="doc-view-md">Download as Markdown ↓</a>
          <a href="${escapeHtml(c.url)}" target="_blank" rel="noopener" class="doc-view-pdf">View source PDF →</a>
        </div>
      </header>

      <div class="doc-view-search">
        <input type="search" id="doc-find" aria-label="Find in this contract" placeholder="Find in this contract — e.g. overtime, longevity, grievance" autocomplete="off">
        <span id="doc-find-count"></span>
      </div>

      <div class="doc-view-body">
        <aside class="doc-view-toc" aria-label="Contents">
          <h3>Contents</h3>
          <ol id="doc-toc"></ol>
        </aside>
        <div class="doc-view-content" id="doc-content"></div>
      </div>
    `;
    root.appendChild(wrap);

    const toc = wrap.querySelector("#doc-toc");
    const content = wrap.querySelector("#doc-content");
    let lastTocHeading = null;
    items.forEach((cl, idx) => {
      const anchor = `sec-${idx}`;
      // TOC entry. Continuation slices (a table that runs on, a stray
      // fragment) and repeats of the previous entry stay out of the contents.
      const li = document.createElement("li");
      const tocSkip = cl.heading_kind === "continued" || cl.heading === lastTocHeading;
      if (tocSkip) li.hidden = true; else lastTocHeading = cl.heading;
      li.innerHTML = `<a href="#${anchor}">${escapeHtml(cl.heading || "Untitled")}</a>`;
      li.querySelector("a").addEventListener("click", (ev) => {
        // Scroll in place; changing the hash would make the router leave the contract.
        ev.preventDefault();
        const target = document.getElementById(anchor);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      toc.appendChild(li);

      // Section block
      const sec = document.createElement("section");
      sec.className = "doc-section";
      sec.id = anchor;
      const pdfUrl = `${c.url}#page=${cl.page}`;
      const tags = (cl.topics || []).map(t =>
        `<span class="tag" role="button" tabindex="0" data-topic="${t}">${TOPIC_LABELS[t] || t}</span>`).join("");
      sec.innerHTML = `
        <div class="doc-section-meta">
          <span class="doc-section-page">Page ${cl.page}</span>
          ${cl.ocr ? `<span class="ocr-flag" title="This page was reconstructed via optical character recognition; verify against the source PDF">OCR</span>` : ""}
          <a class="doc-section-pdf" href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener">Open p.${cl.page} in PDF →</a>
          <a class="doc-section-permalink" href="#/clause/${encodeURIComponent(cl.id)}" title="Permalink to this section">¶ permalink</a>
          <button type="button" class="doc-section-cite" title="Copy this section's text with a full citation">Copy quote + citation</button>
        </div>
        <h3 class="doc-section-heading">${escapeHtml(cl.heading || "Untitled")}</h3>
        ${tags ? `<div class="tags">${tags}</div>` : ""}
        <pre class="doc-section-body">${escapeHtml(cl.text)}</pre>
      `;
      const citeBtn = sec.querySelector(".doc-section-cite");
      citeBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(citationFor(cl)).then(() => {
          citeBtn.textContent = "Copied!";
          setTimeout(() => citeBtn.textContent = "Copy quote + citation", 1500);
        });
      });
      sec.querySelectorAll(".tag").forEach(el => el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.topic = el.dataset.topic;
        state.view = "topic-pivot";
        $("#topic-filter").value = state.topic;
        $("#view-mode").value = "topic-pivot";
        location.hash = `view=topic-pivot&topic=${encodeURIComponent(state.topic)}`;
      }));
      content.appendChild(sec);
    });

    wrap.querySelector(".doc-view-back a").addEventListener("click", (ev) => {
      ev.preventDefault();
      clearAll();
    });

    // Find-in-contract: filter sections (and their TOC entries) to those
    // containing every typed token; highlight matches in the visible text.
    const findBox = wrap.querySelector("#doc-find");
    const findCount = wrap.querySelector("#doc-find-count");
    const sections = Array.from(content.querySelectorAll(".doc-section"));
    const tocItems = Array.from(toc.querySelectorAll("li"));
    findBox.addEventListener("input", debounce(() => {
      const q = findBox.value.trim();
      const cq = compileQuery(q);
      let shown = 0;
      sections.forEach((sec, i) => {
        const cl = items[i];
        const hit = !cq || clauseMatches(cl, cq);
        sec.style.display = hit ? "" : "none";
        if (tocItems[i]) tocItems[i].style.display = hit ? "" : "none";
        const body = sec.querySelector(".doc-section-body");
        if (body) body.innerHTML = highlight(cl.text, hit ? cq : null);
        if (hit) shown++;
      });
      findCount.textContent = q ? `${shown} of ${sections.length} sections` : "";
    }, 120));
  }

  function renderSingleClause(id) {
    const c = state.allClauses.find(c => c.id === id);
    const root = $("#results");
    root.innerHTML = "";
    if (!c) { root.innerHTML = `<p>Clause not found.</p>`; return; }
    const back = document.createElement("div");
    back.className = "single-clause-nav";
    back.innerHTML = `
      <a href="#" data-action="clear">← Back to all clauses</a>
      <button type="button" data-action="another">Show another random clause</button>
    `;
    back.querySelector('[data-action="clear"]').addEventListener("click", (e) => {
      e.preventDefault();
      clearAll();
    });
    back.querySelector('[data-action="another"]').addEventListener("click", showRandomClause);
    root.appendChild(back);
    root.appendChild(clauseCard(c, "", false, true));
  }

  function clearAll() {
    state.query = "";
    state.topic = "";
    state.contractFilter = "";
    state.view = "results";
    state.compareSet = new Set();
    $("#q").value = "";
    $("#topic-filter").value = "";
    $("#contract-filter").value = "";
    $("#view-mode").value = "results";
    // Keep the query string (?embed=1) so embed mode survives "back to all".
    history.replaceState(null, "", location.pathname + location.search);
    render();
  }

  /* ---------- Random clause ---------- */
  function showRandomClause() {
    const pool = applyFilters(state.clauses.filter(c => !isEarlierId(c.contract_id)));
    if (pool.length === 0) { alert("No clauses match the current filters."); return; }
    const c = pool[Math.floor(Math.random() * pool.length)];
    location.hash = "#/clause/" + encodeURIComponent(c.id);
  }

  /* ---------- Card ---------- */
  function clauseCard(c, query = "", compact = false, expanded = false) {
    const wrap = document.createElement("div");
    wrap.className = "clause";
    const contract = state.contractById[c.contract_id];
    const contractLabel = contract?.label || c.contract_id;
    const term = (contract?.term_start && contract?.term_end) ? `${contract.term_start}–${contract.term_end}` : "";
    const pdfUrl = contract ? `${contract.url}#page=${c.page}` : "#";
    const heading = c.heading || contractLabel;
    const tags = (c.topics || []).map(t =>
      `<span class="tag" role="button" tabindex="0" data-topic="${t}">${TOPIC_LABELS[t] || t}</span>`).join("");
    const unit = state.unitByContract[c.contract_id];
    const tip = unit ? `
      <div class="badge-tip" role="tooltip">
        <p class="badge-tip-sector">${SECTOR_LABELS[unit.sector] || unit.sector}${unit.headcount_verified ? ` · ~${unit.headcount.toLocaleString()} covered` : ""}</p>
        ${unit.union_full ? `<p class="badge-tip-union">${escapeHtml(unit.union_full)}</p>` : ""}
        <p class="badge-tip-summary">${escapeHtml(unit.summary)}</p>
        <p class="badge-tip-cta">Click to see all clauses · <a href="#view=units&sector=${encodeURIComponent(unit.sector)}">browse this sector</a></p>
      </div>` : "";
    const badgeBlock = compact ? "" : `
      <span class="contract-badge-wrap">
        <a class="contract-badge" href="#/contract/${encodeURIComponent(c.contract_id)}">
          <span class="contract-badge-name">${escapeHtml(window.expandContractLabel ? window.expandContractLabel(contractLabel) : contractLabel)}</span>
          ${term ? `<span class="contract-badge-term">${term}</span>` : ""}
        </a>
        ${tip}
      </span>`;
    if (isEarlier(contract)) wrap.classList.add("is-earlier");
    wrap.innerHTML = `
      ${badgeBlock}
      ${isEarlier(contract) ? earlierCardFlag(contract, compact) : ""}
      <div class="clause-meta">
        <span>Page ${c.page}</span>
        ${c.ocr ? `<span class="ocr-flag" title="This page was reconstructed via optical character recognition; spelling may have minor errors">OCR</span>` : ""}
        <a class="pdf-link" href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener">View in source PDF →</a>
      </div>
      <h3 class="clause-heading"><a href="#/clause/${encodeURIComponent(c.id)}">${highlight(heading, query)}</a></h3>
      <div class="tags">${tags}</div>
      <div class="clause-body${expanded ? " expanded":""}">${expanded ? highlight(c.text, query) : snippet(c.text, query)}</div>
      <div class="clause-actions">
        <button class="expand-btn">${expanded ? "Show less" : "Show full clause"}</button>
        <button class="copy-link">Copy permalink</button>
        <button class="copy-cite">Copy quote + citation</button>
      </div>
    `;
    wrap.querySelector(".expand-btn").addEventListener("click", () => {
      const body = wrap.querySelector(".clause-body");
      body.classList.toggle("expanded");
      body.innerHTML = body.classList.contains("expanded") ? highlight(c.text, query) : snippet(c.text, query);
      wrap.querySelector(".expand-btn").textContent = body.classList.contains("expanded") ? "Show less" : "Show full clause";
    });
    wrap.querySelector(".copy-link").addEventListener("click", () => {
      const url = `${location.origin}${location.pathname}#/clause/${encodeURIComponent(c.id)}`;
      navigator.clipboard.writeText(url).then(() => {
        wrap.querySelector(".copy-link").textContent = "Copied!";
        setTimeout(() => wrap.querySelector(".copy-link").textContent = "Copy permalink", 1500);
      });
    });
    wrap.querySelector(".copy-cite").addEventListener("click", () => {
      navigator.clipboard.writeText(citationFor(c)).then(() => {
        wrap.querySelector(".copy-cite").textContent = "Copied!";
        setTimeout(() => wrap.querySelector(".copy-cite").textContent = "Copy quote + citation", 1500);
      });
    });
    wrap.querySelectorAll(".tag").forEach(el => el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      state.topic = el.dataset.topic;
      $("#topic-filter").value = state.topic;
      state.view = "topic-pivot";
      $("#view-mode").value = "topic-pivot";
      writeHash(); render();
    }));
    return wrap;
  }

  /* ---------- Helpers ---------- */
  // Plain-text block a reporter can paste: the clause verbatim, then a full
  // citation (contract, section, page, source PDF, database permalink) and an
  // OCR caution when the text came off a scanned page.
  function citationFor(c) {
    const contract = state.contractById[c.contract_id];
    const label = window.expandContractLabel ? window.expandContractLabel(contract?.label || c.contract_id) : (contract?.label || c.contract_id);
    const permalink = `${location.origin}${location.pathname}#/clause/${encodeURIComponent(c.id)}`;
    const pdf = contract ? `${contract.url}#page=${c.page}` : "";
    const parts = [
      (c.text || "").trim(),
      "",
      `— ${label}${c.heading && c.heading !== label ? `, ${c.heading}` : ""}, p. ${c.page}.`,
      pdf ? `Source PDF: ${pdf}` : "",
      `Via NYC municipal labor contracts database: ${permalink}`,
    ];
    if (c.ocr) parts.push("Note: this page was transcribed via OCR — verify wording against the source PDF before publication.");
    return parts.filter(Boolean).join("\n");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch]);
  }
  function highlight(text, q) {
    const raw = text || "";
    const cq = typeof q === "string" ? compileQuery(q) : q;
    if (!cq) return escapeHtml(raw);
    let out = "", last = 0, m;
    cq.hl.lastIndex = 0;
    while ((m = cq.hl.exec(raw)) !== null) {
      if (m[0] === "") { cq.hl.lastIndex++; continue; }
      out += escapeHtml(raw.slice(last, m.index)) + "<mark>" + escapeHtml(m[0]) + "</mark>";
      last = m.index + m[0].length;
    }
    return out + escapeHtml(raw.slice(last));
  }

  // A window of the clause starting shortly before the first match, so the
  // highlighted words are visible without expanding the card.
  function snippet(text, q) {
    const raw = text || "";
    const cq = compileQuery(q);
    if (!cq) return escapeHtml(raw);
    cq.hl.lastIndex = 0;
    const m = cq.hl.exec(raw);
    if (!m || m.index < 160) return highlight(raw, cq);
    let start = raw.lastIndexOf(" ", m.index - 120);
    if (start < 0) start = 0;
    return "&hellip;" + highlight(raw.slice(start + 1), cq);
  }

  init().catch(err => { console.error(err); $("#results").innerHTML = `<div class="clause"><p>Failed to load corpus: ${escapeHtml(err.message)}. The data files may not be built yet.</p></div>`; });
})();

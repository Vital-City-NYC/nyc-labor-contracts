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
    if (manifest.generated) $("#data-stamp").textContent = `Corpus generated ${manifest.generated}. ${manifest.contracts || ""} contracts, ${manifest.clauses || ""} clauses, ${manifest.ocr_pages || ""} OCR'd pages.`;

    state.contracts = await loadJSON("data/contracts.json");
    state.contractById = Object.fromEntries(state.contracts.map(c => [c.id, c]));
    state.clauses = await loadJSON("data/clauses.json");
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

    // Search is an exact scan over every clause (see compileQuery); keep a
    // combined heading + text string per clause so each query scans once.
    state.clauses.forEach(c => { c._hay = (c.heading || "") + "\n" + (c.text || ""); });

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
    state.contracts.slice().sort((a,b) => a.label.localeCompare(b.label)).forEach(c => {
      const o = document.createElement("option");
      o.value = c.id; o.textContent = window.expandContractLabel ? window.expandContractLabel(c.label) : c.label;
      cf.appendChild(o);
    });
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
    return score;
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
      (s, u) => s + (u.headcount_duplicate_of ? 0 : (u.headcount || 0)), 0);
    // Count the units actually contributing to the total, not every curated
    // unit — some curated entries have no sourced headcount, and one is a
    // duplicate population.
    const counted = state.units.filter(u => u.headcount && !u.headcount_duplicate_of).length;
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
      const headcount = u.headcount
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
      return renderContractTiles(root);
    }
    let clauses = searchHits(applyFilters(state.clauses));
    if (!clauses) clauses = applyFilters(state.clauses.slice());
    const contractCount = new Set(clauses.map(c => c.contract_id)).size;
    $("#result-count").textContent = state.query
      ? `${clauses.length} clause${clauses.length === 1 ? "" : "s"} across ${contractCount} contract${contractCount === 1 ? "" : "s"} matching "${state.query}"`
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

  function renderContractTiles(root) {
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
    root.appendChild(intro);
    root.appendChild(missingPanel());

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
  }

  // Documents we know exist (or must exist) but that aren't in this database:
  // a one-line strip that opens to the list.
  function missingPanel() {
    const gaps = state.missing.unpublished || [];
    const noUnderlying = state.contracts
      .filter(c => c.amends_predecessor && !c.predecessor)
      .sort((a, b) => a.label.localeCompare(b.label));
    const label = c => escapeHtml(window.expandContractLabel ? window.expandContractLabel(c.label) : c.label);
    const names = gaps.map(g => g.short_name).filter(Boolean);
    const panel = document.createElement("details");
    panel.className = "missing-panel";
    panel.id = "missing";
    panel.innerHTML = `
      <summary>
        <span class="missing-panel-title">Known missing documents</span>
        <span class="missing-panel-sub">${gaps.length} current agreement${gaps.length === 1 ? " is" : "s are"} unpublished${names.length ? ` (${names.map(escapeHtml).join(", ")})` : ""}, and ${noUnderlying.length} amendments rely on an older agreement that isn't here.</span>
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
            <strong>Underlying agreements.</strong> ${noUnderlying.length} amendments change only some terms and keep an older agreement in force for the rest, including grievances, discipline and seniority. That older agreement is not in this database, so a search here can miss provisions that still apply. These documents carry a pink "underlying agreement missing" tag.
            <details class="missing-underlying-wrap">
              <summary>List all ${noUnderlying.length}</summary>
              <ul class="missing-underlying">
                ${noUnderlying.map(c => `<li><a href="#/contract/${encodeURIComponent(c.id)}">${label(c)}</a></li>`).join("")}
              </ul>
            </details>
          </li>
        </ul>
        <p class="missing-checked">Last checked ${escapeHtml(state.missing.checked || "")}. <a href="methodology.html#gaps">How this list is kept</a>.</p>
      </div>`;
    return panel;
  }

  function contractTile(contract) {
    const tile = document.createElement("a");
    tile.className = "contract-tile";
    tile.href = `#/contract/${encodeURIComponent(contract.id)}`;
    const unit = state.unitByContract[contract.id];
    const term = (contract.term_start && contract.term_end) ? `${contract.term_start}–${contract.term_end}` : "term n/a";
    const clauseCount = state.clauses.filter(cl => cl.contract_id === contract.id).length;
    const sector = unit?.sector ? (SECTOR_LABELS[unit.sector] || unit.sector) : "";
    const headcountBadge = unit?.headcount
      ? `<span class="contract-tile-headcount">${unit.headcount.toLocaleString()} covered</span>`
      : "";
    const qualityBadge = contract.ocr_quality === "poor"
      ? `<span class="contract-tile-ocr poor" title="This contract had a high density of OCR errors. Many have been corrected, but more may remain — verify quotes against the source PDF.">⚠ heavy OCR errors</span>`
      : contract.ocr_quality === "fair"
      ? `<span class="contract-tile-ocr fair" title="This contract had some OCR errors. Most have been corrected; verify quotes against the source PDF.">some OCR errors</span>`
      : "";
    const amendBadge = !contract.amends_predecessor ? ""
      : contract.predecessor
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
      ${gapBadges}
      ${amendBadge}
      ${contract.predecessor ? `<span class="contract-tile-haspred" title="${escapeHtml(contract.predecessor.label)} — published by ${escapeHtml(contract.predecessor.publisher)}">underlying agreement linked</span>` : ""}
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
    const headcount = unit?.headcount ? ` · ~${unit.headcount.toLocaleString()} covered` : "";
    const sector = unit?.sector ? `<span class="contract-group-sector">${SECTOR_LABELS[unit.sector] || unit.sector}${headcount}</span>` : "";
    const moreNote = items.length < totalInGroup
      ? `<span class="contract-group-more">Showing ${items.length} of ${totalInGroup} matches</span>`
      : `<span class="contract-group-count">${totalInGroup} match${totalInGroup === 1 ? "" : "es"}</span>`;
    wrap.innerHTML = `
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
    header.innerHTML = `<h2>Compare contracts side-by-side</h2><p>Pick 2-4 contracts and a topic to see their clauses on that topic next to each other.</p>`;
    root.appendChild(header);
    const ctrl = document.createElement("div");
    ctrl.className = "controls";
    ctrl.innerHTML = `
      <p>Selected: <strong id="cmp-list">${Array.from(state.compareSet).map(id => escapeHtml(state.contractById[id]?.label || id)).join(", ") || "(none)"}</strong></p>
      <select id="cmp-add"><option value="">Add a contract…</option></select>
      <button id="cmp-clear" type="button">Clear</button>
    `;
    root.appendChild(ctrl);
    const sel = ctrl.querySelector("#cmp-add");
    state.contracts.slice().sort((a,b)=>a.label.localeCompare(b.label)).forEach(c => {
      if (state.compareSet.has(c.id)) return;
      const o = document.createElement("option"); o.value = c.id; o.textContent = window.expandContractLabel ? window.expandContractLabel(c.label) : c.label;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => {
      if (sel.value && state.compareSet.size < 4) state.compareSet.add(sel.value);
      writeHash(); render();
    });
    ctrl.querySelector("#cmp-clear").addEventListener("click", () => { state.compareSet.clear(); writeHash(); render(); });

    if (state.compareSet.size < 1) return;
    const grid = document.createElement("div");
    grid.className = `compare-grid cols-${Math.max(2, state.compareSet.size)}`;
    Array.from(state.compareSet).forEach(cid => {
      const col = document.createElement("div");
      col.className = "compare-col";
      const c = state.contractById[cid];
      col.innerHTML = `<h3>${escapeHtml(c?.label || cid)}</h3>`;
      const matches = state.clauses.filter(cl => cl.contract_id === cid && (state.topic ? (cl.topics||[]).includes(state.topic) : true));
      matches.slice(0, 6).forEach(cl => col.appendChild(clauseCard(cl, "", true)));
      if (matches.length === 0) col.innerHTML += `<p style="color:var(--muted)">No clauses tagged ${escapeHtml(TOPIC_LABELS[state.topic] || state.topic || "any")}.</p>`;
      grid.appendChild(col);
    });
    root.appendChild(grid);
  }

  function renderContracts(root) {
    const list = state.contracts.slice().sort((a,b)=>a.label.localeCompare(b.label));
    $("#result-count").textContent = `${list.length} documents`;
    const byType = new Map();
    list.forEach(c => {
      const t = c.doc_type || "moa";
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(c);
    });
    DOC_TYPE_ORDER.filter(t => byType.has(t)).forEach(t => {
      const items = byType.get(t);
      const head = document.createElement("div");
      head.className = "doc-type-header doc-type-header-inline";
      head.innerHTML = `
        <h2 class="doc-type-title">${DOC_TYPE_LABELS[t]} <span class="doc-type-count">${items.length}</span></h2>
        <p class="doc-type-blurb">${DOC_TYPE_BLURB[t]}</p>`;
      root.appendChild(head);
      items.forEach(c => {
        const card = document.createElement("div");
        card.className = "contract-card";
        const clauseCount = state.clauses.filter(cl => cl.contract_id === c.id).length;
        const term = (c.term_start && c.term_end) ? `${c.term_start}–${c.term_end}` : "term n/a";
        card.innerHTML = `
          <div>
            <h3><a href="#/contract/${encodeURIComponent(c.id)}">${escapeHtml(window.expandContractLabel ? window.expandContractLabel(c.label) : c.label)}</a></h3>
            <div class="term">${term} · <a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">source PDF</a>${c.amends_predecessor ? ' · <span class="contract-card-amends">amends a prior agreement</span>' : ""}</div>
          </div>
          <div class="stats">${clauseCount} clauses</div>
        `;
        root.appendChild(card);
      });
    });
  }

  function renderExpirations(root) {
    const cur = new Date().getFullYear();
    const list = state.contracts.slice().filter(c => c.term_end).sort((a,b) => a.term_end - b.term_end);
    const expired = list.filter(c => c.term_end < cur);
    const expiring = list.filter(c => c.term_end === cur);
    const current = list.filter(c => c.term_end > cur);
    const wrap = document.createElement("div");
    wrap.className = "expirations";
    wrap.innerHTML = `
      <h3>Contract expirations</h3>
      <p>Under New York's Triborough Amendment, expired contracts remain in force until a successor is signed. Listing reflects stated term end dates.</p>
      <ul>
        <li><strong>${current.length}</strong> with stated term not yet expired</li>
        <li><strong>${expiring.length}</strong> expiring this year (${cur})</li>
        <li><strong>${expired.length}</strong> with stated term already expired (Triborough hold-over)</li>
      </ul>
    `;
    root.appendChild(wrap);

    // Visual timeline: one bar per contract, stated term start → end, with a
    // "today" line. Sorted by end date so the next expirations rise to the top.
    const withTerms = state.contracts.filter(c => c.term_start && c.term_end && c.term_end >= c.term_start);
    if (withTerms.length) {
      const minY = Math.min(...withTerms.map(c => c.term_start));
      const maxY = Math.max(...withTerms.map(c => c.term_end)) + 1;
      const span = maxY - minY;
      const now = new Date();
      const nowY = now.getFullYear() + (now.getMonth() + 0.5) / 12;
      const tl = document.createElement("div");
      tl.className = "term-timeline";
      const axisTicks = [];
      for (let y = minY; y <= maxY; y += (span > 14 ? 2 : 1)) {
        axisTicks.push(`<span class="term-timeline-tick" style="left:${((y - minY) / span * 100).toFixed(2)}%">${y}</span>`);
      }
      const rows = withTerms.slice().sort((a,b) => (a.term_end - b.term_end) || (a.term_start - b.term_start) || a.label.localeCompare(b.label)).map(c => {
        const left = ((c.term_start - minY) / span * 100).toFixed(2);
        const width = Math.max((c.term_end + 1 - c.term_start) / span * 100, 0.8).toFixed(2);
        const cls = c.term_end < cur ? "expired" : (c.term_end === cur ? "expiring" : "current");
        const label = window.expandContractLabel ? window.expandContractLabel(c.label) : c.label;
        return `
          <a class="term-timeline-row" href="#/contract/${encodeURIComponent(c.id)}" title="${escapeHtml(label)} · ${c.term_start}–${c.term_end}">
            <span class="term-timeline-label">${escapeHtml(label)}</span>
            <span class="term-timeline-track"><span class="term-timeline-bar ${cls}" style="left:${left}%;width:${width}%"></span></span>
          </a>`;
      }).join("");
      tl.innerHTML = `
        <h3>Every contract's stated term</h3>
        <p class="term-timeline-legend">
          <span><span class="term-timeline-swatch current"></span> in stated term</span>
          <span><span class="term-timeline-swatch expiring"></span> expires ${cur}</span>
          <span><span class="term-timeline-swatch expired"></span> stated term expired (Triborough hold-over)</span>
          <span><span class="term-timeline-swatch todayline"></span> today</span>
        </p>
        <div class="term-timeline-axis">${axisTicks.join("")}</div>
        <div class="term-timeline-rows" style="--now-left:${((nowY - minY) / span * 100).toFixed(2)}">${rows}</div>
      `;
      root.appendChild(tl);
    }
    [["Expired (Triborough hold-over)", expired], ["Expiring this year", expiring], ["Currently in stated term", current]].forEach(([title, items]) => {
      const sec = document.createElement("div");
      sec.className = "expirations";
      sec.innerHTML = `<h3>${title} — ${items.length}</h3>`;
      items.forEach(c => {
        const row = document.createElement("div");
        row.style.padding = "4px 0";
        row.innerHTML = `<a href="#/contract/${encodeURIComponent(c.id)}">${escapeHtml(window.expandContractLabel ? window.expandContractLabel(c.label) : c.label)}</a> <span style="color:var(--muted)">${c.term_start||"?"}–${c.term_end||"?"}</span>`;
        sec.appendChild(row);
      });
      root.appendChild(sec);
    });
  }

  function renderContractDetail(cid) {
    const c = state.contractById[cid];
    const unit = state.unitByContract[cid];
    const root = $("#results");
    root.innerHTML = "";
    if (!c) { root.innerHTML = `<p>Contract not found.</p>`; return; }
    const items = state.clauses.filter(cl => cl.contract_id === cid);
    const term = (c.term_start && c.term_end) ? `${c.term_start}–${c.term_end}` : "term n/a";
    const expandedLabel = window.expandContractLabel ? window.expandContractLabel(c.label) : c.label;
    const ocrPages = new Set(items.filter(it => it.ocr).map(it => it.page));
    const totalPages = items.length ? Math.max(...items.map(it => it.page || 1)) : 0;

    const wrap = document.createElement("article");
    wrap.className = "doc-view";
    wrap.innerHTML = `
      <header class="doc-view-header">
        <p class="doc-view-back"><a href="#">← Back to all contracts</a></p>
        ${unit?.sector ? `<p class="doc-view-kicker">${SECTOR_LABELS[unit.sector] || unit.sector}${unit.headcount ? " · ~" + unit.headcount.toLocaleString() + " covered" : ""}</p>` : ""}
        <h2 class="doc-view-title">${escapeHtml(expandedLabel)}</h2>
        ${unit?.summary ? `<p class="doc-view-summary">${escapeHtml(unit.summary)}</p>` : ""}
        ${(state.missingByContract[cid] || []).map(g => `
          <aside class="doc-view-missing-note">
            <p><strong>Known missing document: ${escapeHtml(g.badge)}.</strong> ${escapeHtml(g.missing)}</p>
            <p>${escapeHtml(g.have_note)}</p>
            <p class="doc-view-amend-quote">Evidence: ${escapeHtml(g.evidence.publisher)}, ${escapeHtml(g.evidence.date)}: &ldquo;${escapeHtml(g.evidence.quote)}&rdquo; <a href="${escapeHtml(g.evidence.url)}" target="_blank" rel="noopener">Source &#8599;</a> · <a href="#missing">All known missing documents</a></p>
          </aside>`).join("")}
        ${c.amends_predecessor ? `
          <aside class="doc-view-amend-note">
            <p><strong>This is an amendment, not a complete contract.</strong> It changes the specific terms set out below and expressly leaves the rest of an underlying agreement in force, so provisions on grievance procedure, discipline, seniority and similar subjects may govern these workers without appearing anywhere in this document. ${c.predecessor ? "" : `<strong>That underlying agreement is missing from this database.</strong> It is a public record, but the city does not link it from this document. <a href="#missing">All known missing documents</a> · <a href="methodology.html#doc-types">Where to look for it</a>.`}</p>
            ${c.predecessor ? `
              <p class="doc-view-predecessor">
                <strong>Read the underlying agreement:</strong>
                <a href="${escapeHtml(c.predecessor.url)}" target="_blank" rel="noopener">${escapeHtml(c.predecessor.label)} &#8599;</a>
                <span class="doc-view-predecessor-src">Published by ${escapeHtml(c.predecessor.publisher)}, and checked when this site was built. The city does not link it from this document.</span>
              </p>` : ""}
            ${c.amends_evidence ? `<p class="doc-view-amend-quote">Language in this document: &ldquo;${escapeHtml(c.amends_evidence)}&hellip;&rdquo;</p>` : ""}
          </aside>` : ""}
        <div class="doc-view-meta">
          <span><strong>Type</strong> ${DOC_TYPE_SHORT[c.doc_type] || "Document"}</span>
          <span><strong>Term</strong> ${term}</span>
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
    items.forEach((cl, idx) => {
      const anchor = `sec-${idx}`;
      // TOC entry
      const li = document.createElement("li");
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
    const c = state.clauses.find(c => c.id === id);
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
    const pool = applyFilters(state.clauses);
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
        <p class="badge-tip-sector">${SECTOR_LABELS[unit.sector] || unit.sector}${unit.headcount ? ` · ~${unit.headcount.toLocaleString()} covered` : ""}</p>
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
    wrap.innerHTML = `
      ${badgeBlock}
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

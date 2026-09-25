/* Wage pattern tracker — visualizes GWI schedules across NYC labor contracts. */
(() => {
  const $ = (s) => document.querySelector(s);

  const state = { wages: [], sort: "cumulative", show: "curated" };

  async function init() {
    const r = await fetch("data/wages.json");
    state.wages = await r.json();
    bind();
    renderOverview();
    render();
  }

  function bind() {
    $("#sort").addEventListener("change", () => { state.sort = $("#sort").value; render(); });
    $("#show").addEventListener("change", () => { state.show = $("#show").value; render(); });
  }

  function renderOverview() {
    const curated = state.wages.filter(w => w.curated && w.cumulative_pct);
    // The civilian pattern is the DC 37 schedule; later civilian deals such as
    // CSA's end in 3.25/3.50 steps and would skew an average.
    const dc37 = state.wages.find(w => w.contract_id === "dc37-moa-2021-2026");
    const uniformed = curated.filter(w => w.cumulative_pct >= 18 && w.cumulative_pct < 25);
    const pba = state.wages.find(w => w.contract_id === "pba-mou-2017-2025");

    const civAvg = dc37 && dc37.cumulative_pct ? dc37.cumulative_pct.toFixed(2) : "—";
    const uniAvg = uniformed.length ? (uniformed.reduce((s, w) => s + w.cumulative_pct, 0) / uniformed.length).toFixed(2) : "—";

    $("#overview").innerHTML = `
      <div class="wages-stat-grid">
        <div class="wages-stat">
          <div class="wages-stat-num">${civAvg}<span class="wages-stat-unit">%</span></div>
          <div class="wages-stat-label">Civilian-pattern compounded GWI</div>
          <div class="wages-stat-sub">Set by DC 37: 5 steps of 3.00/3.00/3.00/3.00/3.25%, plus a $3,000 ratification bonus. UFT and CSA got 3.25% and 3.50% in their last two steps (16.77%).</div>
        </div>
        <div class="wages-stat">
          <div class="wages-stat-num">${uniAvg}<span class="wages-stat-unit">%</span></div>
          <div class="wages-stat-label">Uniformed coalition compounded GWI</div>
          <div class="wages-stat-sub">5 steps of 3.25/3.25/3.50/3.50/4.00% at months 1, 13, 25, 37, 49 of each unit's successor agreement. No standard ratification bonus in the coalition agreement.</div>
        </div>
        <div class="wages-stat">
          <div class="wages-stat-num">${pba ? pba.cumulative_pct.toFixed(2) : "—"}<span class="wages-stat-unit">%</span></div>
          <div class="wages-stat-label">PBA, prior round</div>
          <div class="wages-stat-sub">8 annual steps Aug 1, 2017 through Aug 1, 2024. 2.25 → 4.00% per year. No $3,000 bonus; settlement included separate retroactive-pay provisions.</div>
        </div>
        <div class="wages-stat">
          <div class="wages-stat-num">$3,000</div>
          <div class="wages-stat-label">Ratification bonus (civilian round)</div>
          <div class="wages-stat-sub">Pensionable lump sum, pro-rated, paid to DC 37, UFT, CSA, CWA 1180, IBT 237, 1199 SEIU H+H, Doctors Council. Not present in the uniformed pattern.</div>
        </div>
      </div>
    `;
  }

  function render() {
    let list = state.wages.slice();
    if (state.show === "curated") list = list.filter(w => w.curated);
    if (state.sort === "cumulative") {
      list.sort((a, b) => (b.cumulative_pct || 0) - (a.cumulative_pct || 0));
    } else if (state.sort === "alpha") {
      list.sort((a, b) => a.contract_label.localeCompare(b.contract_label));
    } else if (state.sort === "bargained") {
      list.sort((a, b) => (a.term_start || 9999) - (b.term_start || 9999) || a.contract_label.localeCompare(b.contract_label));
    }
    const root = $("#wages");
    root.innerHTML = "";
    list.forEach(w => root.appendChild(card(w)));
    if (list.length === 0) {
      root.innerHTML = `<div class="unit-card"><div class="unit-body"><p>No entries to show.</p></div></div>`;
    }
  }

  const VERIFICATION_LABELS = {
    "full":     { text: "Verified against contract text", cls: "verified-full" },
    "partial":  { text: "Partially verified · some dates inferred", cls: "verified-partial" },
    "pattern":  { text: "Set by parent agreement (UOCEA)", cls: "verified-pattern" },
    "appendix": { text: "GWI lives in PDF appendix · see source", cls: "verified-appendix" },
  };

  function card(w) {
    const div = document.createElement("div");
    div.className = "wage-card";
    const titleHtml = `<h3><a href="index.html#/contract/${encodeURIComponent(w.contract_id)}">${escapeHtml(window.expandContractLabel ? window.expandContractLabel(w.contract_label) : w.contract_label)}</a></h3>`;
    const verBadge = w.verified && VERIFICATION_LABELS[w.verified]
      ? `<span class="wage-verified ${VERIFICATION_LABELS[w.verified].cls}">${VERIFICATION_LABELS[w.verified].text}</span>` : "";
    const bonusesHtml = (w.bonuses || []).map(b => `
      <div class="wage-bonus">+ $${b.amount.toLocaleString()} ${escapeHtml(b.type)}${b.effective && b.effective !== "on-ratification" ? ` (${formatDate(b.effective)})` : ""}</div>
    `).join("");

    if (w.curated && w.increases.length) {
      const allCurated = state.wages.filter(x => x.curated).flatMap(x => x.increases);
      const maxPct = Math.max(...allCurated.map(i => i.pct), 4);
      const stepsHtml = w.increases.map(inc => `
        <div class="wage-step">
          <div class="wage-step-bar" style="width: ${(inc.pct / maxPct * 100).toFixed(1)}%"></div>
          <div class="wage-step-meta">
            <span class="wage-step-pct">${inc.pct.toFixed(2)}%</span>
            <span class="wage-step-date">${formatDate(inc.effective)}</span>
          </div>
        </div>
      `).join("");
      div.innerHTML = `
        <div class="wage-header">
          ${titleHtml}
          <div class="wage-cumulative">
            <span class="wage-cumulative-num">${w.cumulative_pct.toFixed(2)}%</span>
            <span class="wage-cumulative-label">compounded over ${w.increases.length} steps</span>
          </div>
        </div>
        ${verBadge}
        <div class="wage-steps">${stepsHtml}</div>
        ${bonusesHtml ? `<div class="wage-bonuses">${bonusesHtml}</div>` : ""}
        ${w.source_note ? `<p class="wage-source">${escapeHtml(w.source_note)}</p>` : ""}
      `;
    } else if (w.curated && w.verified === "appendix") {
      // GWI not enumerable from text; show bonuses + source note.
      div.classList.add("wage-card-appendix");
      div.innerHTML = `
        <div class="wage-header">
          ${titleHtml}
          <div class="wage-cumulative wage-cumulative-pending">
            <span class="wage-cumulative-num">PDF</span>
            <span class="wage-cumulative-label">see source for GWI</span>
          </div>
        </div>
        ${verBadge}
        ${bonusesHtml ? `<div class="wage-bonuses">${bonusesHtml}</div>` : ""}
        ${w.source_note ? `<p class="wage-source">${escapeHtml(w.source_note)}</p>` : ""}
      `;
    } else {
      const pcts = (w.auto_pcts || []).slice(0, 6);
      const lumps = (w.auto_lump_sums || []).slice(0, 2);
      div.classList.add("wage-card-uncurated");
      div.innerHTML = `
        <div class="wage-header">
          <h3><a href="index.html#/contract/${encodeURIComponent(w.contract_id)}">${escapeHtml(window.expandContractLabel ? window.expandContractLabel(w.contract_label) : w.contract_label)}</a></h3>
          <div class="wage-cumulative wage-cumulative-pending">
            <span class="wage-cumulative-num">—</span>
            <span class="wage-cumulative-label">not yet curated</span>
          </div>
        </div>
        <p class="wage-auto">${pcts.length ? `Candidate increases extracted: ${pcts.map(p => p.toFixed(2)+"%").join(" · ")}` : "No GWI percentages auto-detected on first page."}</p>
        ${lumps.length ? `<p class="wage-auto">Possible lump sums: ${lumps.map(l => "$"+l.toLocaleString()).join(" · ")}</p>` : ""}
        <p class="wage-source">Auto-extracted candidates from OCR'd text — not verified. <a href="index.html#/contract/${encodeURIComponent(w.contract_id)}">Read the agreement →</a></p>
      `;
    }
    return div;
  }

  function formatDate(s) {
    if (!s) return "";
    if (s.startsWith("month-")) {
      const n = parseInt(s.slice(6));
      if (n === 1) return "Day 1 of unit agreement";
      return `Month ${n}`;
    }
    if (s === "on-ratification") return "On ratification";
    if (s.startsWith("20") && s.length >= 7) {
      const [y, m, d] = s.split("-");
      const month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][(parseInt(m)||1)-1];
      return d ? `${month} ${parseInt(d)}, ${y}` : `${month} ${y}`;
    }
    return s.replace(/-on-ratification/, " on ratification");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[ch]);
  }

  init().catch(err => { $("#wages").innerHTML = `<p>Failed to load: ${escapeHtml(err.message)}</p>`; });
})();

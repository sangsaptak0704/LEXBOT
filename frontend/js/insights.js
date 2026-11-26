// Insights: your usage (from local activity) as simple charts, knowledge-base size, and an
// accuracy self-test of the rule-based engine.
(() => {
  "use strict";
  const { el } = LB;
  const box = document.getElementById("insights-body");
  const SVG_NS = "http://www.w3.org/2000/svg";

  function svg(tag, attrs, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    node.append(...children);
    return node;
  }

  const tile = (value, label) => el("div", { class: "card stat-tile" },
    el("div", { class: "stat-value" }, String(value)), el("div", { class: "stat-label" }, label));

  /**
   * Single-series vertical bar chart (one hue, so no legend; the card title names it).
   * Thin bars with rounded tops anchored to the baseline, hover tooltip per bar, and a
   * hidden table for screen readers.
   */
  function columnChart(rows, { title, unit }) {
    const W = 380, H = 190, padL = 24, padB = 24, padT = 10;
    const max = Math.max(1, ...rows.map((r) => r.value));
    const step = (W - padL) / rows.length;
    const barW = Math.min(26, step * 0.6);
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "ichart", role: "img", "aria-label": title });
    const ticks = [0, Math.ceil(max / 2), max];
    for (const t of [...new Set(ticks)]) {
      const y = H - padB - (t / max) * (H - padB - padT);
      root.append(svg("line", { x1: padL, x2: W, y1: y, y2: y, class: "grid" }),
        svg("text", { x: padL - 6, y: y + 4, class: "axis", "text-anchor": "end" }, String(t)));
    }
    rows.forEach((r, i) => {
      const h = (r.value / max) * (H - padB - padT);
      const x = padL + i * step + (step - barW) / 2;
      const y = H - padB - h;
      const rad = Math.min(4, h / 2, barW / 2);
      // Rounded top corners only; the bar sits on the baseline.
      const d = h > 0
        ? `M${x},${H - padB} V${y + rad} Q${x},${y} ${x + rad},${y} H${x + barW - rad} Q${x + barW},${y} ${x + barW},${y + rad} V${H - padB} Z`
        : "";
      const g = svg("g", { class: "bar-g", tabindex: "0" },
        svg("rect", { x: padL + i * step, y: padT, width: step, height: H - padB - padT, class: "hit" }),
        d ? svg("path", { d, class: "bar" }) : svg("line", { x1: x, x2: x + barW, y1: H - padB, y2: H - padB, class: "bar-zero" }));
      const label = `${r.label}: ${r.value} ${unit}`;
      g.addEventListener("mousemove", (e) => LB.showTooltip(e, label));
      g.addEventListener("mouseleave", LB.hideTooltip);
      g.addEventListener("focus", () => {
        const b = g.getBoundingClientRect();
        LB.showTooltip({ clientX: b.left + b.width / 2, clientY: b.top + 20 }, label);
      });
      g.addEventListener("blur", LB.hideTooltip);
      root.append(g);
      if (r.tick) root.append(svg("text", { x: x + barW / 2, y: H - 8, class: "axis", "text-anchor": "middle" }, r.tick));
    });
    root.append(svg("line", { x1: padL, x2: W, y1: H - padB, y2: H - padB, class: "baseline" }));
    return el("figure", { class: "card chart-card" },
      el("figcaption", {}, title), root, dataTable(rows, unit));
  }

  /** Single-series horizontal bars for ranked categories, direct-labelled with values. */
  function barList(rows, { title, unit, empty }) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return el("figure", { class: "card chart-card" },
      el("figcaption", {}, title),
      rows.length ? el("ol", { class: "hbars" }, rows.map((r) => {
        const row = el("li", { class: "hbar", tabindex: "0" },
          el("span", { class: "hbar-label" }, r.label),
          el("span", { class: "hbar-track" }, el("span", { class: "hbar-fill", style: `width:${(r.value / max) * 100}%` })),
          el("span", { class: "hbar-value" }, String(r.value)));
        row.addEventListener("mousemove", (e) => LB.showTooltip(e, `${r.label}: ${r.value} ${unit}`));
        row.addEventListener("mouseleave", LB.hideTooltip);
        return row;
      })) : el("p", { class: "muted small" }, empty));
  }

  function dataTable(rows, unit) {
    return el("details", { class: "chart-table" }, el("summary", {}, "Show as table"),
      el("table", { class: "rel-table" },
        el("thead", {}, el("tr", {}, el("th", {}, "Item"), el("th", {}, unit))),
        el("tbody", {}, rows.map((r) => el("tr", {}, el("td", {}, r.label), el("td", {}, String(r.value)))))));
  }

  function usage(items) {
    const questions = items.filter((i) => i.type === "question");
    const day = (t) => new Date(t).toISOString().slice(0, 10);
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ key, label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        tick: i % 2 === 1 ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }), value: 0 });
    }
    for (const q of questions) {
      const slot = days.find((d) => d.key === day(q.time));
      if (slot) slot.value += 1;
    }
    const topics = {};
    for (const q of questions) for (const c of q.concepts || []) topics[c.label] = (topics[c.label] || 0) + 1;
    const intents = {};
    const INTENT = { definition: "Definitions", advice: "Guidance", comparison: "Comparisons", types: "Types",
      requirements: "Requirements", unknown: "Other" };
    for (const q of questions) {
      const k = INTENT[q.intent] || "Other";
      intents[k] = (intents[k] || 0) + 1;
    }
    const kb = questions.filter((q) => !q.ai).length;
    const aiKb = questions.filter((q) => q.ai && q.aiSource !== "general").length;
    const aiGen = questions.filter((q) => q.ai && q.aiSource === "general").length;
    const ranked = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));

    return [
      el("h2", { class: "ins-h" }, "Your usage"),
      el("div", { class: "stat-tiles" },
        tile(questions.length, "Questions asked"),
        tile(kb, "Answered by the knowledge base"),
        tile(aiKb, "AI answers built on the knowledge base"),
        tile(aiGen, "AI answers from general knowledge")),
      el("div", { class: "ins-grid" },
        columnChart(days, { title: "Questions per day (last 14 days)", unit: "questions" }),
        barList(ranked(topics), { title: "Most asked-about legal terms", unit: "questions",
          empty: "Ask a few questions and your top topics will appear here." }),
        barList(ranked(intents), { title: "What kind of help you asked for", unit: "questions",
          empty: "No questions yet." })),
    ];
  }

  async function knowledge() {
    try {
      const s = await LB.cached("/api/stats");
      return [el("h2", { class: "ins-h" }, "Knowledge base"),
        el("div", { class: "stat-tiles" },
          tile(s.concepts, "Legal terms"), tile(s.relations, "Relations between terms"),
          tile(s.domains, "Areas of law"), tile(s.rules, "Reasoning rules"))];
    } catch { return []; }
  }

  function selfTestPanel() {
    const out = el("div", { class: "st-out" });
    const run = el("button", { type: "button" }, "Run accuracy test");
    run.addEventListener("click", async () => {
      run.disabled = true;
      out.replaceChildren(el("p", { class: "muted" }, "Running..."));
      try {
        const r = await LB.get("/api/selftest");
        out.replaceChildren(
          el("div", { class: "st-head" },
            el("div", { class: "quiz-score small-ring", style: `--pct:${r.score}` }, el("span", {}, `${Math.round(r.score)}%`)),
            el("div", {}, el("strong", {}, `${r.passed} of ${r.total} questions answered correctly`),
              el("p", { class: "muted small" }, "Each question is run through a fresh copy of the rule-based engine (no AI) and checked against the expected term or guidance."))),
          el("table", { class: "rel-table st-table" },
            el("thead", {}, el("tr", {}, el("th", {}, ""), el("th", {}, "Question"), el("th", {}, "Expected"), el("th", {}, "LexBot found"))),
            el("tbody", {}, r.results.map((x) => el("tr", { class: x.passed ? "" : "st-fail" },
              el("td", {}, el("span", { class: `dl-status ${x.passed ? "ok" : "late"}` }, x.passed ? "✓ Pass" : "✗ Fail")),
              el("td", {}, x.question), el("td", { class: "muted" }, x.expected), el("td", {}, x.got))))));
      } catch (err) {
        out.replaceChildren(LB.errorBox(err.message));
      } finally {
        run.disabled = false;
      }
    });
    return [el("h2", { class: "ins-h" }, "Accuracy self-test"),
      el("div", { class: "card" },
        el("p", {}, "Check how well LexBot's reasoning engine understands 40 sample questions: definitions, misspellings, step-by-step guidance and questions it should admit it doesn't know."),
        run, out)];
  }

  LB.insights = {
    async show() {
      const items = LB.activity.items();
      box.replaceChildren(...usage(items));
      box.append(...(await knowledge()), ...selfTestPanel());
    },
  };
})();

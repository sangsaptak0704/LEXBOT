// Activity view: a local history of questions asked and concepts viewed.
(() => {
  "use strict";
  const { el } = LB;
  const STORAGE_KEY = () => LB.userKey("activity");
  const MAX_ITEMS = 300;

  const listBox = document.getElementById("activity-list");
  const summaryBox = document.getElementById("activity-summary");
  const filtersBox = document.getElementById("activity-filters");
  const search = document.getElementById("activity-search");

  const FILTERS = [
    ["", "All"],
    ["question", "Questions"],
    ["concept", "Terms viewed"],
  ];
  let filter = "";

  function load() {
    try {
      const items = JSON.parse(localStorage.getItem(STORAGE_KEY()) || "[]");
      return Array.isArray(items) ? items : [];
    } catch {
      return [];
    }
  }

  function save(items) {
    try {
      localStorage.setItem(STORAGE_KEY(), JSON.stringify(items.slice(0, MAX_ITEMS)));
    } catch {
      /* storage full or disabled: activity just isn't kept */
    }
  }

  /** Add an entry (newest first). Only the fields the view needs are stored. */
  function record(entry) {
    const items = load();
    const now = Date.now();
    let item;
    if (entry.type === "question") {
      const t = entry.trace;
      item = {
        type: "question", time: now, text: entry.text,
        intent: t ? t.intent : null,
        concepts: t ? t.concepts.map((c) => ({ id: c.id, label: c.label, category: c.category })) : [],
        advice: t ? t.chosen_advice : null,
        rules: t ? t.fired.length : 0,
        ai: !!entry.ai, aiSource: entry.aiSource || null,
      };
    } else if (entry.type === "concept") {
      // Re-opening the same term straight away isn't new activity.
      const last = items[0];
      if (last && last.type === "concept" && last.id === entry.id && now - last.time < 60000) return;
      item = { type: "concept", time: now, id: entry.id, label: entry.label, category: entry.category };
    } else {
      return;
    }
    items.unshift(item);
    save(items);
  }

  // ------------------------------------------------------------- render
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return dayFmt.format(d);
  }

  function tile(label, value) {
    return el("div", { class: "card stat-tile" },
      el("div", { class: "stat-value" }, String(value)),
      el("div", { class: "stat-label" }, label));
  }

  function renderSummary(items) {
    const questions = items.filter((i) => i.type === "question");
    const viewed = items.filter((i) => i.type === "concept");
    const counts = new Map();
    for (const q of questions) {
      for (const c of q.concepts) counts.set(c.label, (counts.get(c.label) || 0) + 1);
    }
    for (const v of viewed) counts.set(v.label, (counts.get(v.label) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    summaryBox.replaceChildren(
      tile("Questions asked", questions.length),
      tile("Terms viewed", viewed.length),
      tile("Advice given", questions.filter((q) => q.advice).length),
      tile("Most explored topic", top ? top[0] : "-"));
  }

  function questionItem(item) {
    const meta = [];
    if (item.intent) meta.push(el("span", { class: "badge" }, item.intent));
    if (item.rules) meta.push(el("span", { class: "muted small" }, `${item.rules} rules fired`));
    return el("div", { class: "activity-item" },
      el("div", { class: "activity-icon q", "aria-hidden": "true" }, "?"),
      el("div", { class: "activity-body" },
        el("div", { class: "activity-title" }, item.text),
        item.advice ? el("div", { class: "small" }, `Advice: ${item.advice}`) : null,
        el("div", { class: "chip-row" }, meta, item.concepts.map(LB.conceptLink))),
      el("div", { class: "activity-side" },
        el("time", { class: "muted small", datetime: new Date(item.time).toISOString() },
          timeFmt.format(item.time)),
        el("button", { type: "button", class: "secondary small-btn", onclick: () => {
          LB.chat.ask(item.text);
        } }, "Ask again")));
  }

  function conceptItem(item) {
    return el("div", { class: "activity-item" },
      el("div", { class: "activity-icon c", "aria-hidden": "true" }, "i"),
      el("div", { class: "activity-body" },
        el("div", { class: "activity-title" }, "Viewed ", LB.conceptLink(item)),
        el("div", { class: "muted small" }, LB.CATEGORY_LABELS[item.category] || item.category)),
      el("div", { class: "activity-side" },
        el("time", { class: "muted small", datetime: new Date(item.time).toISOString() },
          timeFmt.format(item.time)),
        el("a", { class: "button-link", href: `#explore/${encodeURIComponent(item.id)}` }, "Open")));
  }

  function renderFilters() {
    filtersBox.replaceChildren(...FILTERS.map(([value, label]) => el("button", {
      type: "button", class: `chip${value === filter ? " active" : ""}`,
      "aria-pressed": String(value === filter),
      onclick: () => { filter = value; render(); },
    }, label)));
  }

  function render() {
    const items = load();
    renderSummary(items);
    renderFilters();
    const q = search.value.trim().toLowerCase();
    const shown = items.filter((i) => (!filter || i.type === filter) &&
      (!q || (i.text || i.label || "").toLowerCase().includes(q) ||
        (i.concepts || []).some((c) => c.label.toLowerCase().includes(q))));

    if (!items.length) {
      listBox.replaceChildren(el("div", { class: "card empty" },
        el("p", {}, "No activity yet."),
        el("p", { class: "muted small" },
          "Ask LexBot a question in Chat or open a term in the Knowledge Graph, and it will appear here."),
        el("a", { class: "button-link", href: "#chat" }, "Go to Chat")));
      return;
    }
    if (!shown.length) {
      listBox.replaceChildren(el("p", { class: "muted" }, "No matching activity."));
      return;
    }
    const groups = [];
    for (const item of shown) {
      const label = dayLabel(item.time);
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
      groups[groups.length - 1].items.push(item);
    }
    listBox.replaceChildren(...groups.map((g) => el("section", { class: "activity-day" },
      el("h2", {}, g.label),
      el("div", { class: "card activity-card" },
        g.items.map((i) => (i.type === "question" ? questionItem(i) : conceptItem(i)))))));
  }

  search.addEventListener("input", render);
  document.getElementById("clear-activity").addEventListener("click", () => {
    if (!load().length) return;
    if (confirm("Clear all activity history from this browser?")) {
      localStorage.removeItem(STORAGE_KEY());
      render();
    }
  });

  LB.activity = { record, show: render, items: load };
})();

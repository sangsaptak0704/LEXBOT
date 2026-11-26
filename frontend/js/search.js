// Search view: find saved chats, projects and legal terms.
(() => {
  "use strict";
  const { el } = LB;
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  const MAX_PER_GROUP = 20;
  let concepts = null;

  /** Text with every occurrence of `q` wrapped in <mark> (built safely, no innerHTML). */
  function highlight(text, q) {
    if (!q) return [text];
    const out = [];
    const lower = text.toLowerCase();
    let i = 0;
    for (let j = lower.indexOf(q); j !== -1; j = lower.indexOf(q, i)) {
      if (j > i) out.push(text.slice(i, j));
      out.push(el("mark", {}, text.slice(j, j + q.length)));
      i = j + q.length;
    }
    if (i < text.length) out.push(text.slice(i));
    return out;
  }

  /** A short excerpt of `text` around the first match. */
  function snippet(text, q) {
    const flat = text.replace(/\s+/g, " ");
    const at = flat.toLowerCase().indexOf(q);
    if (at === -1) return flat.slice(0, 120);
    const start = Math.max(0, at - 50);
    return (start ? "..." : "") + flat.slice(start, at + q.length + 70)
      + (at + q.length + 70 < flat.length ? "..." : "");
  }

  function group(title, count, items) {
    return el("section", { class: "search-group" },
      el("h2", {}, `${title} `, el("span", { class: "muted" }, `(${count})`)),
      el("div", { class: "card chat-list" }, items));
  }

  function render() {
    const q = input.value.trim().toLowerCase();
    const chats = LB.store.chats();
    const projects = LB.store.projects();
    const projectName = (id) => (projects.find((p) => p.id === id) || {}).name;

    if (!q) {
      const recent = chats.slice(0, 8);
      results.replaceChildren(recent.length
        ? group("Recent chats", recent.length, recent.map((c) => resultRow(
          `#chat/${c.id}`, [c.title], projectName(c.projectId), LB.relativeTime(c.updated))))
        : el("p", { class: "muted" }, "Type to search your chats, projects and the legal terms LexBot knows."));
      return;
    }

    const groups = [];

    const chatHits = [];
    for (const c of chats) {
      const msg = c.messages.find((m) => m.text.toLowerCase().includes(q));
      if (c.title.toLowerCase().includes(q) || msg) {
        chatHits.push(resultRow(`#chat/${c.id}`, highlight(c.title, q), projectName(c.projectId),
          LB.relativeTime(c.updated), msg ? highlight(snippet(msg.text, q), q) : null));
      }
    }
    if (chatHits.length) groups.push(group("Chats", chatHits.length, chatHits.slice(0, MAX_PER_GROUP)));

    const projectHits = projects.filter((p) =>
      p.name.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q));
    if (projectHits.length) {
      groups.push(group("Projects", projectHits.length, projectHits.map((p) => resultRow(
        `#projects/${p.id}`, highlight(p.name, q), null,
        `${LB.store.projectChats(p.id).length} chats`,
        p.description ? highlight(p.description, q) : null))));
    }

    if (concepts) {
      const termHits = concepts.filter((c) =>
        c.label.toLowerCase().includes(q) || c.aliases.some((a) => a.includes(q)));
      if (termHits.length) {
        groups.push(group("Legal terms", termHits.length, termHits.slice(0, MAX_PER_GROUP).map((c) => {
          const alias = c.label.toLowerCase().includes(q) ? null : c.aliases.find((a) => a.includes(q));
          return resultRow(`#explore/${c.id}`, highlight(c.label, q), c.domain_label,
            LB.CATEGORY_LABELS[c.category] || c.category,
            alias ? ["Also known as: ", ...highlight(alias, q)] : null, c.category);
        })));
      }
    }

    results.replaceChildren(...(groups.length ? groups
      : [el("p", { class: "muted" }, `No results for “${input.value.trim()}”.`)]));
  }

  function resultRow(href, titleParts, tag, meta, sub, category) {
    return el("a", { class: "chat-row", href: href.replace(/\/(.*)$/, (m, id) => `/${encodeURIComponent(id)}`) },
      el("div", { class: "chat-row-main" },
        el("div", { class: "chat-row-title" },
          category ? el("span", { class: "dot", style: `background:${LB.CATEGORY_COLORS[category]}` }) : null,
          titleParts,
          tag ? el("span", { class: "badge" }, tag) : null),
        sub ? el("div", { class: "muted small chat-row-sub" }, sub) : null),
      el("span", { class: "muted small" }, meta));
  }

  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") results.querySelector("a.chat-row")?.click();
  });

  LB.search = {
    async show() {
      render();
      input.focus();
      input.select();
      if (!concepts) {
        try {
          concepts = (await LB.cached("/api/concepts")).concepts;
          render();
        } catch {
          /* chats and projects are still searchable without the server */
        }
      }
    },
    focus() { input.focus(); input.select(); },
  };
})();

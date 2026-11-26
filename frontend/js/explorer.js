// Knowledge Graph view: browse concepts and draw each one's neighbourhood.
(() => {
  "use strict";
  const { el } = LB;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const HIERARCHY = new Set(["is_a", "part_of", "party_to", "belongs_to"]);
  const MAX_NEIGHBOURS = 16;

  const listBox = document.getElementById("concept-list");
  const detailBox = document.getElementById("concept-detail");
  const search = document.getElementById("concept-search");
  const domainSelect = document.getElementById("concept-domain");
  const countBox = document.getElementById("concept-count");

  let concepts = [];
  let selected = null;

  function svg(tag, attrs, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    for (const c of children) node.append(c);
    return node;
  }

  // ---------------------------------------------------------------- list
  function renderList() {
    const q = search.value.trim().toLowerCase();
    const domain = domainSelect.value;
    const matches = concepts.filter((c) =>
      (!domain || c.domain === domain) &&
      (!q || c.label.toLowerCase().includes(q) || c.aliases.some((a) => a.includes(q))));
    countBox.textContent = `${matches.length} of ${concepts.length} concepts`;

    const groups = new Map();
    for (const c of matches) {
      const key = c.domain_label || "General";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    listBox.replaceChildren(...[...groups.keys()].sort().map((name) =>
      el("div", { class: "concept-group" },
        el("div", { class: "group-title" }, name),
        groups.get(name).map((c) => el("a", {
          class: `concept-item${c.id === selected ? " active" : ""}`,
          href: `#explore/${encodeURIComponent(c.id)}`,
        }, el("span", { class: "dot", style: `background:${LB.CATEGORY_COLORS[c.category]}` }),
        c.label)))));
    if (!matches.length) listBox.append(el("p", { class: "muted" }, "No matching concepts."));
  }

  // --------------------------------------------------------------- graph
  function neighbourhood(detail) {
    // Merge multiple edges to the same neighbour into one spoke.
    const byId = new Map();
    for (const e of detail.edges) {
      const id = e.concept.id;
      if (!byId.has(id)) byId.set(id, { concept: e.concept, edges: [] });
      byId.get(id).edges.push(e);
    }
    return [...byId.values()];
  }

  function drawGraph(detail) {
    const all = neighbourhood(detail);
    const spokes = all.slice(0, MAX_NEIGHBOURS);
    const W = 640, H = 440, cx = W / 2, cy = H / 2, R = 165;

    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "graph", role: "img",
      "aria-label": `${detail.label} and its ${all.length} directly connected concepts` });
    root.append(svg("defs", {},
      svg("marker", { id: "arrow", viewBox: "0 0 10 10", refX: "10", refY: "5",
        markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" },
      svg("path", { d: "M0,0 L10,5 L0,10 z", fill: "#98a2b3" }))));

    const edgeLayer = svg("g", {});
    const nodeLayer = svg("g", {});
    root.append(edgeLayer, nodeLayer);

    spokes.forEach((spoke, i) => {
      const angle = (2 * Math.PI * i) / spokes.length - Math.PI / 2;
      const x = cx + R * Math.cos(angle);
      const y = cy + R * Math.sin(angle);
      const e = spoke.edges[0];
      const hierarchical = spoke.edges.some((x) => HIERARCHY.has(x.relation));
      // Shorten the line so arrows stop at the node edge (node radius 9 + ring).
      const dx = x - cx, dy = y - cy, len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len, gap = 14;
      const [x1, y1, x2, y2] = e.direction === "out"
        ? [cx + ux * gap, cy + uy * gap, x - ux * gap, y - uy * gap]
        : [x - ux * gap, y - uy * gap, cx + ux * gap, cy + uy * gap];
      edgeLayer.append(svg("line", { x1, y1, x2, y2, class: `edge${hierarchical ? "" : " dashed"}`,
        "marker-end": "url(#arrow)" }));
      const relText = spoke.edges.map((x) => x.relation.replace(/_/g, " ")).join(", ");
      edgeLayer.append(svg("text", { x: cx + dx * 0.5, y: cy + dy * 0.5, class: "edge-label",
        "text-anchor": "middle", "dominant-baseline": "middle" }, document.createTextNode(relText)));

      const sentence = spoke.edges.map((x) => x.direction === "out"
        ? `${detail.label} ${x.phrase} ${spoke.concept.label}`
        : `${spoke.concept.label} ${x.phrase} ${detail.label}`).join("\n");
      const cos = Math.cos(angle);
      const anchor = Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end";
      const lx = x + (anchor === "middle" ? 0 : cos > 0 ? 14 : -14);
      const ly = y + (anchor === "middle" ? (Math.sin(angle) > 0 ? 24 : -16) : 4);
      const node = svg("g", { class: "node", tabindex: "0", role: "link",
        "aria-label": sentence },
      svg("circle", { cx: x, cy: y, r: 18, class: "hit" }),
      svg("circle", { cx: x, cy: y, r: 9, fill: LB.CATEGORY_COLORS[spoke.concept.category] || "#888",
        class: "node-dot" }),
      svg("text", { x: lx, y: ly, "text-anchor": anchor, class: "node-label" },
        document.createTextNode(spoke.concept.label)));
      const go = () => { location.hash = `#explore/${encodeURIComponent(spoke.concept.id)}`; };
      node.addEventListener("click", go);
      node.addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(); });
      node.addEventListener("mousemove", (ev) => LB.showTooltip(ev, sentence));
      node.addEventListener("mouseleave", LB.hideTooltip);
      nodeLayer.append(node);
    });

    nodeLayer.append(svg("g", { class: "node center" },
      svg("circle", { cx, cy, r: 13, fill: LB.CATEGORY_COLORS[detail.category] || "#888",
        class: "node-dot" }),
      svg("text", { x: cx, y: cy + 32, "text-anchor": "middle", class: "node-label center-label" },
        document.createTextNode(detail.label))));

    const used = [...new Set([detail.category, ...spokes.map((s) => s.concept.category)])];
    const legend = el("div", { class: "legend" },
      used.map((cat) => el("span", { class: "legend-item" },
        el("span", { class: "dot", style: `background:${LB.CATEGORY_COLORS[cat]}` }),
        LB.CATEGORY_LABELS[cat] || cat)),
      el("span", { class: "legend-item" }, el("span", { class: "line-solid" }), "hierarchy"),
      el("span", { class: "legend-item" }, el("span", { class: "line-dashed" }), "other relation"));

    return el("div", { class: "graph-wrap" }, root, legend,
      all.length > spokes.length
        ? el("p", { class: "muted small" },
          `Showing ${spokes.length} of ${all.length} connections; all are listed below.`)
        : null);
  }

  // -------------------------------------------------------------- detail
  function section(title, content) {
    return el("div", { class: "detail-section" }, el("h3", {}, title), content);
  }

  function renderDetail(d) {
    const chainText = d.chain.length
      ? el("div", { class: "chain" }, LB.conceptLink(d), d.chain.map((e) =>
          [el("span", { class: "chain-arrow" }, ` ${e.phrase} `), LB.conceptLink(e.target)]))
      : el("span", { class: "muted small" }, "Top-level concept");

    const subtypes = d.subtypes.length
      ? el("ul", { class: "tree" }, d.subtypes.map((s) =>
          el("li", { style: `padding-left:${s.depth * 18}px` }, LB.conceptLink(s))))
      : null;

    const reqs = d.requirements.length
      ? el("ul", { class: "plain" }, d.requirements.map((r) => el("li", {}, LB.conceptLink(r),
          r.inherited_from ? el("span", { class: "muted small" },
            ` (inherited from ${r.inherited_from.label})`) : null)))
      : null;

    const relTable = el("table", { class: "rel-table" },
      el("thead", {}, el("tr", {}, el("th", {}, "Relation"), el("th", {}, "Concept"))),
      el("tbody", {}, d.edges.map((e) => el("tr", {},
        el("td", {}, e.direction === "out" ? `${d.label} ${e.phrase}` : `is the target of: ${e.phrase}`),
        el("td", {}, LB.conceptLink(e.concept))))));

    detailBox.replaceChildren(...[
      el("div", { class: "detail-head" },
        el("div", {},
          el("span", { class: "badge", style: `border-color:${LB.CATEGORY_COLORS[d.category]}` },
            LB.CATEGORY_LABELS[d.category] || d.category),
          el("h2", {}, d.label)),
        el("button", { type: "button", onclick: () => {
          LB.chat.ask(`What is ${d.label}?`);
        } }, "Ask LexBot")),
      el("p", { class: "definition" }, d.definition),
      d.aliases.length ? el("p", { class: "muted small" }, `Also recognised as: ${d.aliases.join(", ")}`) : null,
      section("Classification", chainText),
      drawGraph(d),
      reqs ? section("Requirements", reqs) : null,
      subtypes ? section(`Types (${d.subtypes.length})`, subtypes) : null,
      d.related.length ? section("Related", el("div", { class: "chip-row" }, d.related.map(LB.conceptLink))) : null,
      d.rules.length ? section("Used by rules", el("div", { class: "chip-row" }, d.rules.map((id) =>
        el("span", { class: "fact" }, id)))) : null,
      section(`All relations (${d.edges.length})`, relTable),
    ].filter(Boolean));
  }

  async function load() {
    if (concepts.length) return;
    const data = await LB.cached("/api/concepts");
    concepts = data.concepts;
    const domains = concepts.filter((c) => c.category === "domain")
      .sort((a, b) => a.label.localeCompare(b.label));
    domainSelect.append(...domains.map((c) => el("option", { value: c.id }, c.label)));
  }

  search.addEventListener("input", renderList);
  domainSelect.addEventListener("change", renderList);

  LB.explorer = {
    async show(conceptId) {
      try {
        await load();
      } catch (err) {
        listBox.replaceChildren(LB.errorBox(err.message));
        return;
      }
      selected = conceptId || selected || "contract";
      renderList();
      try {
        const detail = await LB.cached(`/api/concepts/${encodeURIComponent(selected)}`);
        renderDetail(detail);
        if (conceptId) LB.activity.record({ type: "concept", id: detail.id, label: detail.label,
          category: detail.category });
        detailBox.scrollTop = 0;
        listBox.querySelector(".concept-item.active")?.scrollIntoView({ block: "nearest" });
      } catch (err) {
        detailBox.replaceChildren(LB.errorBox(err.message));
      }
    },
  };
})();

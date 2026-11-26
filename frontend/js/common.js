// Shared helpers: API calls, safe DOM building, tooltip, category colours.
window.LB = window.LB || {};

(() => {
  "use strict";
  const API = window.LEXBOT_API_BASE || "";

  async function request(path, options) {
    const res = await fetch(API + path, { credentials: "same-origin", ...options });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.startsWith("/api/auth/") && LB.auth) LB.auth.expired();
    if (!res.ok) {
      const err = new Error(data.error || `Server error (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** Small sparkle icon as inline SVG (emoji fonts aren't available everywhere). */
  LB.sparkle = () => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "sparkle");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z");
    svg.append(path);
    return svg;
  };

  /** localStorage key that belongs to the signed-in user. */
  LB.userKey = (name) => `lexbot_u${LB.user ? LB.user.id : "anon"}_${name}`;

  LB.get = (path) => request(path);
  LB.del = (path) => request(path, { method: "DELETE" });
  LB.post = (path, body) => request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // Cache read-only data so switching views doesn't refetch it.
  const cache = {};
  LB.cached = (path) => (cache[path] = cache[path] || LB.get(path).catch((e) => {
    delete cache[path];
    throw e;
  }));

  /** Build an element. Text is always set with textContent, never parsed as HTML. */
  LB.el = (tag, attrs, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  };

  // Categorical slots in fixed order (validated reference palette, light mode).
  LB.CATEGORY_COLORS = {
    root: "#2a78d6",
    domain: "#eb6834",
    concept: "#1baf7a",
    element: "#eda100",
    remedy: "#e87ba4",
    party: "#008300",
  };
  LB.CATEGORY_LABELS = {
    root: "Root", domain: "Area of law", concept: "Concept",
    element: "Element", remedy: "Remedy", party: "Party",
  };

  /** Link chip to a concept in the Knowledge Graph view. */
  LB.conceptLink = (c) => LB.el("a", {
    class: "concept-chip", href: `#explore/${encodeURIComponent(c.id)}`,
    title: LB.CATEGORY_LABELS[c.category] || c.category,
  }, LB.el("span", { class: "dot", style: `background:${LB.CATEGORY_COLORS[c.category] || "#888"}` }),
  c.label);

  /** A fact such as "concept:lease" becomes a link; others become plain chips. */
  LB.factChip = (fact, extraClass) => {
    const [prefix, value] = fact.includes(":") ? fact.split(/:(.*)/s) : [fact, ""];
    const cls = `fact ${extraClass || ""} fact-${prefix}`;
    if ((prefix === "concept" || prefix === "isa" || prefix === "domain") && value) {
      return LB.el("a", { class: cls, href: `#explore/${encodeURIComponent(value)}` }, fact);
    }
    return LB.el("span", { class: cls }, fact);
  };

  // Shared hover tooltip.
  const tip = () => document.getElementById("tooltip");
  LB.showTooltip = (event, text) => {
    const t = tip();
    t.textContent = text;
    t.hidden = false;
    const pad = 12;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    const r = t.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = event.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = event.clientY - r.height - pad;
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
  };
  LB.hideTooltip = () => { tip().hidden = true; };

  LB.errorBox = (message) => LB.el("div", { class: "error-box" },
    `Couldn't load data from the server. ${message}`);
})();

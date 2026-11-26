// Chat view: saved conversations with the backend plus a live reasoning panel.
(() => {
  "use strict";
  const { el } = LB;
  const COMMANDS = /^\s*(why|topics|help|reset|trace|reasoning)\s*$/i;

  const messages = document.getElementById("messages");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-btn");
  const traceBody = document.getElementById("trace-body");
  const tracePanel = document.getElementById("trace-panel");
  const toggleTrace = document.getElementById("toggle-trace");
  const title = document.getElementById("chat-title");
  const projectSelect = document.getElementById("chat-project");
  const deleteBtn = document.getElementById("delete-chat");
  const suggestions = document.getElementById("suggestions");
  const aiWrap = document.getElementById("ai-toggle-wrap");
  const aiToggle = document.getElementById("ai-toggle");
  const hero = document.getElementById("chat-hero");
  const langSelect = document.getElementById("chat-lang");
  const micBtn = document.getElementById("mic-btn");
  const sosBanner = document.getElementById("sos-banner");
  const lawOfDay = document.getElementById("law-of-day");

  // Speech: language codes for recognition / read-aloud.
  const SPEECH_LANG = { en: "en-IN", hi: "hi-IN", bn: "bn-IN", ta: "ta-IN", te: "te-IN", mr: "mr-IN" };
  const lang = () => langSelect.value || "en";

  // Guidance that has a matching template in the document drafter.
  const DRAFTS = [
    [/FIR/i, "fir", "Draft the FIR complaint"],
    [/RTI/i, "rti", "Draft the RTI application"],
    [/consumer|faulty|defective/i, "consumer", "Draft the consumer complaint"],
    [/cheque/i, "cheque", "Draft the cheque-bounce notice"],
    [/deposit|wages|salary|contract|legal action/i, "notice", "Draft a legal notice"],
  ];

  // ---------------------------------------------------------------- icons
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICONS = {
    scales: "M12 3v18M7 21h10M4 7h16M7 7l-3 7h6zM17 7l-3 7h6z",
    book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 1 2-2h13v2",
    compare: "M7 4v16M17 4v16M3 8h8M13 16h8M3 8l3-3M13 16l3 3",
    compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
    grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  };
  /** Line icon from ICONS as inline SVG. */
  function icon(name, cls) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", `icon ${cls || ""}`);
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICONS[name]);
    svg.append(path);
    return svg;
  }

  function avatar(role) {
    if (role === "user") {
      const name = (LB.user && LB.user.name) || "You";
      const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
      return el("div", { class: "avatar-chip user-av", "aria-hidden": "true" }, initials || "Y");
    }
    return el("div", { class: "avatar-chip bot-av", "aria-hidden": "true" }, icon("scales"));
  }

  // ------------------------------------------------------ answer formatting
  /*
   * LexBot's rule-based replies are hard-wrapped plain text. A reply can hold:
   *   - lines before the first section, e.g. "(I assumed you meant: X.)" or "Continuing with: X"
   *   - one or more sections: a title line underlined with dashes, then an indented body of
   *     "Label: value" rows, "1." steps, "*"/"-" bullets (nested by indentation), sub-headings
   *     ("Keep in mind:") and paragraphs; wrapped lines are indented further and get joined
   *   - closing "Note:" / "Tip:" lines at the left margin
   * Replies with no section at all (help, "couldn't match", small talk) use the same body parser.
   * Everything is built with textContent, never parsed as HTML.
   */
  const TAG_LABELS = /^(Relevant terms|Related terms|Types|Remedies|Elements|Requires|Parties|See also)$/i;
  const isRule = (line) => /^\s*-{3,}\s*$/.test(line || "");

  function sectionKind(title) {
    const g = title.match(/^Guidance:\s*(.*)$/i);
    if (g) return { title: g[1], label: "Guidance", icon: "compass", cls: "k-guide" };
    if (/\svs\.?\s/i.test(title)) return { title, label: "Comparison", icon: "compare", cls: "k-compare" };
    if (/^topics\b/i.test(title)) return { title, label: "Topics", icon: "grid", cls: "k-topics" };
    if (/^types of\b/i.test(title)) return { title, label: "Types", icon: "grid", cls: "k-topics" };
    if (/\brequires?\b|^elements of\b/i.test(title)) return { title, label: "Requirements", icon: "compass", cls: "k-compare" };
    return { title, label: "Definition", icon: "book", cls: "k-define" };
  }

  /** Split "Term - description" or "Term: description" bullets into a bold term + text. */
  function labelled(text) {
    const m = text.match(/^([^:]{2,40}?)(?::| - |\s{2,})\s*(.+)$/);
    if (!m) return [text];
    return [el("strong", {}, m[1].trim()), " ", m[2]];
  }

  /** "A -> b -> C" classification chains become linked pills. */
  function chain(text) {
    const parts = text.split(/\s*->\s*/);
    if (parts.length < 2) return text;
    return el("span", { class: "chain-row" }, parts.map((p, i) => [
      i ? el("span", { class: "chain-arrow", "aria-hidden": "true" }, "→") : null,
      el("span", { class: i === 0 ? "chain-node first" : "chain-node" }, p)]));
  }

  function parseBody(lines) {
    const items = [];
    let cur = null;
    let bulletBase = null;   // indent of the outermost bullet in the current list
    for (const raw of lines) {
      if (!raw.trim()) { cur = null; continue; }
      const indent = raw.length - raw.trimStart().length;
      const t = raw.trim();
      const bullet = t.match(/^[-*•]\s+(.*)$/);
      if (bullet && cur && cur.type === "ul" && indent > cur.indent) {
        cur = { type: "ul", indent, level: 2, text: bullet[1] };   // nested bullet
        items.push(cur);
        continue;
      }
      const numbered = t.match(/^(\d+)\.\s+(.*)$/);
      // A deeper line continues the item above, unless it starts a list of its own.
      if (cur && indent > cur.indent && !((bullet || numbered) && cur.type !== "ul" && cur.type !== "ol")) {
        cur.text += cur.sep || " ";
        cur.text += t;
        continue;
      }
      let m;
      if (/^!!/.test(t)) cur = { type: "note", indent, tone: "warning", label: "", text: t.replace(/^!+\s*/, "") };
      else if (numbered) cur = { type: "ol", indent, text: numbered[2] };
      else if (bullet) {
        if (!cur || cur.type !== "ul") bulletBase = indent;
        cur = { type: "ul", indent, level: indent > bulletBase ? 2 : 1, text: bullet[1] };
        // Two-column lines ("Define a term     What is X?") continue as alternatives.
        if (/\S\s{2,}\S/.test(bullet[1])) cur.sep = " / ";
      } else if ((m = t.match(/^(Note|Tip|Warning|Important):\s*(.*)$/i))) {
        cur = { type: "note", indent, tone: m[1].toLowerCase(), label: m[1], text: m[2] };
      } else if ((m = t.match(/^([A-Z][^:]{0,40}):\s*(.*)$/)) && !/[.?!]$/.test(m[1])) {
        cur = m[2] ? { type: "kv", indent, label: m[1], text: m[2] } : { type: "sub", indent, text: m[1] };
      } else if (cur && ["p", "note", "kv"].includes(cur.type) && indent >= cur.indent) {
        cur.text += ` ${t}`;
        continue;
      } else cur = { type: "p", indent, text: t };
      items.push(cur);
    }
    return items;
  }

  function renderBody(items, allTags) {
    const body = el("div", { class: "answer-body" });
    let group = null;
    for (const it of items) {
      const tag = { ol: "ol", ul: "ul", kv: "dl" }[it.type];
      if (!tag) group = null;
      else if (!group || group.dataset.kind !== it.type) {
        group = el(tag, { class: `answer-${it.type}`, "data-kind": it.type });
        body.append(group);
      }
      if (it.type === "ol") group.append(el("li", {}, it.text));
      else if (it.type === "ul") {
        const parts = it.sep ? labelled(it.text.replace(/\s{2,}/, "  ")) : labelled(it.text);
        group.append(el("li", { class: it.level === 2 ? "lvl2" : null }, parts));
      } else if (it.type === "kv") {
        let value;
        if (allTags || TAG_LABELS.test(it.label)) {
          value = el("dd", { class: "tag-row" }, it.text.replace(/\.$/, "").split(/,\s*/)
            .map((v) => el("span", { class: "term-tag" }, v)));
        } else value = el("dd", {}, /->/.test(it.text) ? chain(it.text) : it.text);
        group.append(el("div", { class: "kv-row" }, el("dt", {}, it.label), value));
      } else if (it.type === "sub") body.append(el("h4", { class: "answer-sub" }, it.text));
      else if (it.type === "note") {
        body.append(el("p", { class: `answer-note tone-${it.tone}` },
          icon("info"), el("span", {}, it.label ? el("strong", {}, `${it.label}: `) : null, it.text)));
      } else body.append(el("p", {}, it.text));
    }
    return body;
  }

  function formatAnswer(text) {
    const lines = text.replace(/\r/g, "").split("\n");
    const sections = [];
    const preamble = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() && isRule(lines[i + 1]) && !/^\s/.test(lines[i])) {
        cur = { title: lines[i].trim(), lines: [] };
        sections.push(cur);
        i++;                      // skip the dashes
      } else if (cur) cur.lines.push(lines[i]);
      else preamble.push(lines[i]);
    }

    // Closing "Note:"/"Tip:" paragraphs at the left margin belong to the whole reply.
    const footer = [];
    const last = sections[sections.length - 1];
    if (last) {
      const at = last.lines.findIndex((l) => /^(Note|Tip|Warning|Important):/i.test(l));
      if (at >= 0) footer.push(...last.lines.splice(at));
    }

    const card = el("div", { class: "answer" });
    const pre = preamble.join("\n").trim();
    if (pre) {
      for (const line of pre.split(/\n(?=\S)/)) {
        const assumed = line.match(/^\(I assumed you meant:\s*(.*?)\.?\)$/);
        if (assumed) {
          card.append(el("div", { class: "answer-assumed" }, icon("info"),
            el("span", {}, "Showing results for ", el("strong", {}, assumed[1]))));
        } else if (!sections.length) {
          card.append(renderBody(parseBody(pre.split("\n"))));
          break;
        } else card.append(el("div", { class: "answer-assumed" }, icon("info"), el("span", {}, line.trim())));
      }
    }
    sections.forEach((sec, idx) => {
      const kind = sectionKind(sec.title);
      card.append(el("section", { class: `answer-section${idx ? " follow" : ""}` },
        el("div", { class: `answer-head ${kind.cls}` },
          el("span", { class: "answer-kind" }, icon(kind.icon), kind.label),
          el("h3", { class: "answer-title" }, kind.title)),
        renderBody(parseBody(sec.lines), kind.label === "Topics")));
    });
    if (footer.length) {
      const f = renderBody(parseBody(footer));
      f.classList.add("answer-footer");
      card.append(f);
    }
    return card;
  }

  // ------------------------------------------------------ AI answer markdown
  /** Inline **bold** as <strong> and *italic* as <em>; everything else stays text. */
  function inline(text) {
    return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) return el("strong", {}, part.slice(2, -2));
      return part.split(/(\*[^*\s][^*]*\*)/g).filter(Boolean).map((bit) =>
        /^\*[^*\s][^*]*\*$/.test(bit) ? el("em", {}, bit.slice(1, -1)) : bit.replace(/\*/g, ""));
    });
  }

  /**
   * Render the small Markdown subset the AI is asked to use (headings, bold, bullets,
   * numbered steps, paragraphs) as DOM nodes. Never parses HTML.
   */
  function renderMarkdown(text) {
    const body = el("div", { class: "answer-body md" });
    let list = null;
    let para = null;
    const endBlocks = () => { list = null; para = null; };
    for (const raw of text.replace(/\r/g, "").split("\n")) {
      const line = raw.trimEnd();
      const t = line.trim();
      if (!t || /^[-*_=\s]+$/.test(t)) { endBlocks(); continue; }   // blank line or a rule
      let m;
      if ((m = t.match(/^#{1,6}\s+(.*)$/))) {
        endBlocks();
        body.append(el("h4", { class: "md-h" }, inline(m[1].replace(/\*\*/g, ""))));
      } else if ((m = t.match(/^(?:[-*\u2022])\s+(.*)$/)) || (m = t.match(/^(\d+)[.)]\s+(.*)$/))) {
        const ordered = m.length === 3;
        const content = ordered ? m[2] : m[1];
        const nested = /^\s{2,}/.test(line) && list;
        const tag = ordered ? "ol" : "ul";
        if (!list || list.tagName.toLowerCase() !== tag || list.dataset.nested !== String(!!nested)) {
          list = el(tag, { class: ordered ? "answer-ol" : "answer-ul", "data-nested": String(!!nested) });
          if (ordered && m[1] !== "1") list.setAttribute("start", m[1]);
          body.append(list);
        }
        list.append(el("li", { class: nested ? "lvl2" : null }, inline(content)));
        para = null;
      } else if (list && /^\s{2,}/.test(line)) {
        list.lastElementChild.append(" ", ...inline(t));     // wrapped list item
      } else if (para) {
        para.append(" ", ...inline(t));
      } else {
        list = null;
        para = el("p", {}, inline(t));
        body.append(para);
      }
    }
    // The closing "general information, not legal advice" line becomes a note.
    const last = body.lastElementChild;
    if (last && last.tagName === "P" && /not legal advice|general information/i.test(last.textContent)) {
      last.classList.add("answer-note");
      last.prepend(icon("info"));
    }
    return body;
  }

  /** Fill a bot bubble: structured card for rule-based answers, Markdown card for AI answers. */
  function fillBotBubble(bubble, text, ai) {
    bubble.classList.add("rich");
    bubble.replaceChildren(ai ? el("div", { class: "answer" }, renderMarkdown(text)) : formatAnswer(text));
  }

  /** AI answers are used when the server has Gemini configured and the user hasn't switched them off. */
  const aiOn = () => !!(LB.config && LB.config.ai_available)
    && localStorage.getItem(LB.userKey("ai")) !== "off";

  let current = null;      // the open chat (may be unsaved until its first message)
  let busy = false;
  let greeting = null;     // cached welcome text
  let pending = null;      // question to send once the chat view is showing

  const isSaved = (chat) => !!LB.store.chat(chat.id);

  /** One message row: avatar plus a column with label, bubble and any extras. */
  function messageRow(role, extraClass, bubble, ...extras) {
    const row = el("div", { class: `msg ${role} ${extraClass || ""}` },
      avatar(role),
      el("div", { class: "msg-col" },
        el("div", { class: "msg-label" }, role === "user" ? "You" : "LexBot"),
        bubble, ...extras));
    showMessages(true);
    messages.append(row);
    messages.scrollTop = messages.scrollHeight;
    return row;
  }

  function addMessage(role, text, extraClass) {
    const bubble = el("div", { class: "bubble" });
    if (role === "bot" && !extraClass) fillBotBubble(bubble, text);
    else bubble.textContent = text;
    return messageRow(role, extraClass, bubble);
  }

  function addTyping() {
    return messageRow("bot", "typing",
      el("div", { class: "bubble" },
        el("span", { class: "dots", "aria-hidden": "true" }, el("i"), el("i"), el("i")),
        el("span", { class: "typing-text" }, "Reasoning over the knowledge base")));
  }

  /** Switch between the welcome screen and the message list. */
  function showMessages(on) {
    messages.hidden = !on;
    hero.hidden = on;
  }

  /** A LexBot reply; AI-written ones get a badge and a switch to the rule-based original. */
  function addBotMessage(m) {
    const row = buildBotMessage(m);
    decorateBotRow(row, m);
    messages.scrollTop = messages.scrollHeight;   // actions and follow-ups were added after the row
    return row;
  }

  /** Actions under a reply (listen, copy, verify, draft) and follow-up questions. */
  function decorateBotRow(row, m) {
    const col = row.querySelector(".msg-col");
    const bubble = row.querySelector(".bubble");
    const actions = el("div", { class: "msg-actions" });
    if ("speechSynthesis" in window) {
      const listen = el("button", { type: "button", class: "act-btn", title: "Read this answer aloud" },
        actionIcon("speaker"), "Listen");
      listen.addEventListener("click", () => speak(bubble.innerText, listen));
      actions.append(listen);
    }
    const copy = el("button", { type: "button", class: "act-btn", title: "Copy this answer" }, actionIcon("copy"), "Copy");
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(bubble.innerText); copy.lastChild.textContent = "Copied"; }
      catch { copy.lastChild.textContent = "Copy failed"; }
      setTimeout(() => { copy.lastChild.textContent = "Copy"; }, 1500);
    });
    actions.append(copy);
    if (m.ai) {
      actions.append(el("a", { class: "act-btn", target: "_blank", rel: "noopener noreferrer",
        href: "https://www.indiacode.nic.in/", title: "Check Acts and sections in the official India Code" },
      actionIcon("check"), "Verify on India Code"));
    }
    const draft = m.advice && DRAFTS.find(([re]) => re.test(m.advice));
    if (draft) {
      actions.append(el("a", { class: "act-btn primary", href: `#tools/draft/${draft[1]}` },
        actionIcon("doc"), draft[2]));
    }
    col.append(actions);
    if (m.suggestions && m.suggestions.length) {
      col.append(el("div", { class: "followups" },
        el("span", { class: "followups-label" }, "Ask next"),
        m.suggestions.map((q) => el("button", { type: "button", class: "followup", "data-q": q }, q))));
    }
  }

  const ACTION_ICONS = {
    speaker: "M4 10v4h4l5 4V6L8 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11",
    stop: "M7 7h10v10H7z",
    copy: "M9 9h10v11H9zM5 15V4h10",
    check: "M5 12l4 4L19 6",
    doc: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5",
  };
  function actionIcon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ACTION_ICONS[name]);
    svg.append(path);
    return svg;
  }

  // ---------------------------------------------------------- voice
  let speakingBtn = null;
  function speak(text, btn) {
    const synth = window.speechSynthesis;
    const wasMe = speakingBtn === btn;
    synth.cancel();
    if (speakingBtn) speakingBtn.classList.remove("speaking");
    speakingBtn = null;
    if (wasMe) return;                                   // second click stops
    const u = new SpeechSynthesisUtterance(text.replace(/\s+/g, " "));
    const target = /[\u0900-\u097F]/.test(text) ? (lang() === "mr" ? "mr-IN" : "hi-IN")
      : /[\u0980-\u09FF]/.test(text) ? "bn-IN" : /[\u0B80-\u0BFF]/.test(text) ? "ta-IN"
        : /[\u0C00-\u0C7F]/.test(text) ? "te-IN" : "en-IN";
    u.lang = target;
    const voice = synth.getVoices().find((v) => v.lang === target)
      || synth.getVoices().find((v) => v.lang.startsWith(target.slice(0, 2)));
    if (voice) u.voice = voice;
    u.onend = u.onerror = () => { btn.classList.remove("speaking"); if (speakingBtn === btn) speakingBtn = null; };
    btn.classList.add("speaking");
    speakingBtn = btn;
    synth.speak(u);
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  if (Recognition) {
    micBtn.hidden = false;
    micBtn.addEventListener("click", () => {
      if (recognizer) { recognizer.stop(); return; }
      recognizer = new Recognition();
      recognizer.lang = SPEECH_LANG[lang()] || "en-IN";
      recognizer.interimResults = true;
      micBtn.classList.add("listening");
      input.placeholder = "Listening... speak your question";
      recognizer.onresult = (e) => {
        input.value = [...e.results].map((r) => r[0].transcript).join(" ");
        if (e.results[e.results.length - 1].isFinal) send(input.value);
      };
      const done = () => {
        micBtn.classList.remove("listening");
        input.placeholder = "Ask a legal question, e.g. What is a power of attorney?";
        recognizer = null;
      };
      recognizer.onend = done;
      recognizer.onerror = done;
      recognizer.start();
    });
  }

  function buildBotMessage(m) {
    if (!m.ai) {
      const row = addMessage("bot", m.text);
      if (m.aiError) {
        row.querySelector(".msg-col").append(el("div", { class: "ai-note", title: m.aiError },
          icon("info"), "AI answer unavailable, showing the rule-based answer"));
      }
      return row;
    }
    const general = m.aiSource === "general";
    const bubble = el("div", { class: "bubble ai-text" });
    fillBotBubble(bubble, m.text, true);
    let showingRule = false;
    const toggle = el("button", { type: "button", class: "link-btn" }, "Show rule-based answer");
    toggle.addEventListener("click", () => {
      showingRule = !showingRule;
      fillBotBubble(bubble, showingRule ? m.ruleText : m.text, !showingRule);
      bubble.classList.toggle("ai-text", !showingRule);
      toggle.textContent = showingRule ? "Show AI answer" : "Show rule-based answer";
    });
    const badge = general
      ? el("span", { class: "ai-badge general",
          title: "LexBot's knowledge base doesn't cover this topic, so Google Gemini answered "
            + "from general legal knowledge. Check important details with a lawyer or the official text." },
        LB.sparkle(), "AI answer \u00b7 general legal knowledge")
      : el("span", { class: "ai-badge", title: "Written by Google Gemini, building on LexBot's "
          + "knowledge-base answer; it may add detail from general legal knowledge." },
        LB.sparkle(), "AI-written");
    return messageRow("bot", "", bubble,
      el("div", { class: "ai-meta" }, badge, general ? null : toggle));
  }

  function renderAIToggle() {
    const available = !!(LB.config && LB.config.ai_available);
    aiWrap.hidden = !available;
    aiToggle.checked = aiOn();
  }

  function setBusy(value) {
    busy = value;
    sendBtn.disabled = value;
    input.disabled = value;
    if (!value) input.focus();
  }

  // ------------------------------------------------------------ reasoning
  function step(num, heading, ...content) {
    return el("div", { class: `trace-step${heading === "Decision" ? " decision" : ""}` },
      el("div", { class: "step-num" }, String(num)),
      el("div", { class: "step-body" }, el("h3", {}, heading), ...content));
  }

  function chips(items, render) {
    if (!items.length) return el("span", { class: "muted small" }, "none");
    return el("div", { class: "chip-row" }, items.map(render));
  }

  function renderTrace(trace, emptyText) {
    traceBody.replaceChildren();
    if (!trace && emptyText === "pipeline") {
      const stages = [
        ["Language analysis", "Intent, signals and keywords"],
        ["Legal terms", "Concepts recognised in your words"],
        ["Semantic net", "Facts inherited from related terms"],
        ["Rules fired", "Forward chaining picks the advice"],
      ];
      traceBody.append(
        el("p", { class: "muted small" }, "Ask a question and each step will appear here:"),
        el("ol", { class: "pipeline" }, stages.map(([name, desc], i) => el("li", {},
          el("span", { class: "pipe-num" }, String(i + 1)),
          el("span", {}, el("strong", {}, name), el("span", { class: "muted small" }, desc))))));
      return;
    }
    if (!trace) {
      traceBody.append(el("p", { class: "muted trace-empty" }, emptyText ||
        "That message was a command or small talk, so no reasoning was needed."));
      return;
    }
    traceBody.append(el("p", { class: "trace-question" }, `"${trace.question}"`));

    traceBody.append(step(1, "Language analysis",
      el("div", { class: "kv" }, el("span", {}, "Intent"), el("span", { class: "badge" }, trace.intent)),
      el("div", { class: "kv" }, el("span", {}, "Signals"),
        chips(trace.signals, (s) => el("span", { class: "fact" }, s))),
      el("div", { class: "kv" }, el("span", {}, "Keywords"),
        chips(trace.keywords, (k) => el("span", { class: "fact" }, k)))));

    traceBody.append(step(2, "Legal terms recognised",
      trace.matched_by ? el("p", { class: "muted small" }, `Matched by ${trace.matched_by}`) : null,
      chips(trace.concepts, LB.conceptLink)));

    traceBody.append(step(3, "Inherited from the semantic net",
      chips(trace.inherited, (f) => LB.factChip(f))));

    traceBody.append(step(4, `Rules fired (${trace.fired.length})`,
      trace.fired.length
        ? el("ol", { class: "fired-list" }, trace.fired.map((r) => el("li", {},
            el("span", { class: "rule-id" }, r.id),
            el("span", { class: "muted small" }, ` ${r.kind}`),
            el("div", { class: "small" }, r.description))))
        : el("span", { class: "muted small" }, "none")));

    if (trace.derived_facts.length) {
      traceBody.append(step(5, "New facts derived",
        chips(trace.derived_facts, (f) => LB.factChip(f, "derived"))));
    }
    traceBody.append(step(trace.derived_facts.length ? 6 : 5, "Decision",
      el("p", {}, trace.chosen_advice
        ? `Conflict resolution chose: "${trace.chosen_advice}"`
        : "No advice rule won, so LexBot answered from the semantic net.")));
  }

  // --------------------------------------------------------------- header
  function renderHeader() {
    title.textContent = current.title;
    const projects = LB.store.projects();
    projectSelect.replaceChildren(
      el("option", { value: "" }, "No project"),
      ...projects.map((p) => el("option", { value: p.id }, p.name)));
    projectSelect.value = current.projectId || "";
    deleteBtn.hidden = !isSaved(current);
    langSelect.value = localStorage.getItem(LB.userKey("lang")) || "en";
    renderAIToggle();
  }

  // --------------------------------------------------------------- render
  let lawLoaded = false;
  async function showLawOfTheDay() {
    if (lawLoaded) return;
    try {
      const d = await LB.get("/api/law-of-the-day");
      lawLoaded = true;
      const ask = el("button", { type: "button", class: "lod-ask" }, `Ask about ${d.label}`);
      ask.addEventListener("click", () => send(`What is ${d.label}?`));
      lawOfDay.replaceChildren(
        el("div", { class: "lod-head" }, el("span", { class: "lod-tag" }, "Law of the day"),
          d.area ? el("span", { class: "lod-area" }, d.area) : null),
        el("div", { class: "lod-title" }, d.label),
        el("p", { class: "lod-def" }, d.definition),
        ask);
      lawOfDay.hidden = false;
    } catch { /* optional card */ }
  }

  async function showGreeting() {
    showLawOfTheDay();
    if (greeting === null) {
      try {
        greeting = (await LB.get("/api/greeting")).reply;
      } catch {
        addMessage("bot", "The LexBot server isn't reachable. Start it with: python3 backend/server.py",
          "error");
        return;
      }
    }
  }

  function render() {
    renderHeader();
    messages.replaceChildren();
    sosBanner.hidden = !current.messages.some((m) => m.urgent);
    const lastBot = [...current.messages].reverse().find((m) => m.role !== "user");
    for (const m of current.messages) {
      if (m.role === "user") addMessage("user", m.text);
      else addBotMessage(m === lastBot ? m : { ...m, suggestions: [] });
    }
    showMessages(current.messages.length > 0);
    if (!current.messages.length) showGreeting();   // only to report an unreachable server
    renderTrace(current.lastTrace, current.messages.length
      ? "No reasoning saved for this chat yet." : "pipeline");
    LB.sidebar && LB.sidebar.highlight(isSaved(current) ? current.id : null);
  }

  // -------------------------------------------------------------- actions
  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    const chat = current;
    const firstMessage = !chat.messages.length;

    if (firstMessage) {
      chat.title = text.length > 60 ? `${text.slice(0, 57)}...` : text;
      messages.replaceChildren();
    }
    chat.messages.push({ role: "user", text, time: Date.now() });
    LB.store.saveChat(chat);
    if (firstMessage) {
      history.replaceState(null, "", `#chat/${chat.id}`);
      renderHeader();
      LB.sidebar && LB.sidebar.highlight(chat.id);
    }

    addMessage("user", text);
    input.value = "";
    setBusy(true);
    const typing = addTyping();
    try {
      const data = await LB.post("/api/chat",
        { message: text, session_id: chat.sessionId, ai: aiOn(), lang: lang() });
      chat.sessionId = data.session_id;
      const reply = { role: "bot", text: data.reply, time: Date.now(),
        advice: data.trace ? data.trace.chosen_advice : null,
        suggestions: data.suggestions || [], urgent: !!data.urgent };
      if (data.ai) Object.assign(reply, { ai: true, ruleText: data.rule_reply, aiSource: data.ai_source });
      if (data.ai_error) reply.aiError = data.ai_error;
      chat.messages.push(reply);
      // Commands like "why" or "topics" don't change the last answer, so keep its trace.
      if (data.trace || !COMMANDS.test(text)) chat.lastTrace = data.trace;
      LB.store.saveChat(chat);
      LB.activity.record({ type: "question", text, trace: data.trace, ai: !!data.ai, aiSource: data.ai_source });
      if (chat === current) {
        typing.remove();
        messages.querySelectorAll(".followups").forEach((f) => f.remove());   // only the latest reply suggests
        addBotMessage(reply);
        if (reply.urgent) sosBanner.hidden = false;
        renderTrace(chat.lastTrace);
      }
    } catch (err) {
      if (chat === current) {
        typing.remove();
        addMessage("bot", `Sorry, I couldn't reach the server. ${err.message}`, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  function newChat(projectId) {
    current = LB.store.newChat(projectId);
    if (!document.getElementById("view-chat").hidden) render();   // clear the screen right away
    if (location.hash !== "#chat") location.hash = "#chat";       // the router then calls show()
    input.focus();
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  messages.addEventListener("click", (e) => {
    const f = e.target.closest(".followup");
    if (f && !busy) send(f.dataset.q);
  });
  langSelect.addEventListener("change", () => localStorage.setItem(LB.userKey("lang"), langSelect.value));
  document.getElementById("sos-close").addEventListener("click", () => { sosBanner.hidden = true; });
  document.getElementById("export-chat").addEventListener("click", () => {
    if (!current || !current.messages.length) { alert("Ask a question first, then export the chat."); return; }
    let head = document.getElementById("print-head");
    if (!head) {
      head = el("div", { id: "print-head", class: "print-head" });
      messages.before(head);
    }
    head.replaceChildren(el("h1", {}, `LexBot: ${current.title}`),
      el("p", {}, `Chat exported on ${new Date().toLocaleString("en-IN")}. General legal information, not legal advice.`));
    document.body.classList.add("print-chat");
    window.print();
  });
  window.addEventListener("afterprint", () => document.body.classList.remove("print-chat"));
  suggestions.addEventListener("click", (e) => {
    const card = e.target.closest(".suggest");
    if (card) send(card.dataset.q);
  });
  toggleTrace.addEventListener("click", () => {
    const show = tracePanel.hidden;
    tracePanel.hidden = !show;
    toggleTrace.querySelector("span").textContent = show ? "Hide reasoning" : "Show reasoning";
    toggleTrace.setAttribute("aria-pressed", String(show));
  });
  aiToggle.addEventListener("change", () => {
    localStorage.setItem(LB.userKey("ai"), aiToggle.checked ? "on" : "off");
  });
  projectSelect.addEventListener("change", () => {
    current.projectId = projectSelect.value || null;
    if (isSaved(current)) LB.store.updateChat(current.id, { projectId: current.projectId });
  });
  deleteBtn.addEventListener("click", () => {
    if (!isSaved(current)) return;
    if (confirm(`Delete the chat "${current.title}"?`)) {
      LB.store.deleteChat(current.id);
      newChat();
    }
  });
  // Keep the open chat's header in sync when projects change elsewhere.
  LB.store.onChange(() => {
    if (current && !document.getElementById("view-chat").hidden) renderHeader();
  });

  LB.chat = {
    /** Open a saved chat by id, or keep the current one (a new chat if none). */
    show(chatId) {
      if (!LB.config) {
        LB.get("/api/config").then((c) => { LB.config = c; renderAIToggle(); }).catch(() => {});
      }
      if (chatId) {
        if (current && current.id === chatId) { render(); input.focus(); return; }
        const saved = LB.store.chat(chatId);
        if (saved) {
          current = saved;
        } else {
          current = LB.store.newChat();
          history.replaceState(null, "", "#chat");
        }
      } else if (!current) {
        current = LB.store.newChat();
      } else if (isSaved(current)) {
        history.replaceState(null, "", `#chat/${current.id}`);
      }
      render();
      input.focus();
      if (pending) { const q = pending; pending = null; send(q); }
    },
    newChat,
    /** Ask a question in a fresh chat (reuses the open one if it's still empty). */
    ask(text) {
      if (!current || current.messages.length) current = LB.store.newChat();
      if (location.hash.split("/")[0] === "#chat") { render(); send(text); return; }
      pending = text;           // show() sends it once the router has opened the chat
      location.hash = "#chat";
    },
    currentId: () => (current && isSaved(current) ? current.id : null),
    /** Forget the open chat (on log out), so the next user starts clean. */
    reset() {
      current = null;
      pending = null;
      greeting = null;
      messages.replaceChildren();
      showMessages(false);
      sosBanner.hidden = true;
      traceBody.replaceChildren();
    },
  };
})();

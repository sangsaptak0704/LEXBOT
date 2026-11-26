// API keys view: personal keys for calling LexBot from other programs, plus Gemini AI status.
(() => {
  "use strict";
  const { el } = LB;
  const body = document.getElementById("apikeys-body");
  let newKey = null;          // the full key, shown once right after creation
  let busy = false;

  const fmtDate = (ts) => (ts ? new Date(ts * 1000).toLocaleString(undefined,
    { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never");

  async function copy(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied!";
    } catch {
      button.textContent = "Select and copy manually";
    }
    setTimeout(() => { button.textContent = "Copy"; }, 2000);
  }

  function codeBlock(text) {
    const btn = el("button", { type: "button", class: "secondary small-btn copy-btn" }, "Copy");
    btn.addEventListener("click", () => copy(text, btn));
    return el("div", { class: "code-block" }, el("pre", {}, el("code", {}, text)), btn);
  }

  // ------------------------------------------------------------- sections
  function newKeyPanel() {
    return el("div", { class: "card new-key", role: "status" },
      el("h2", {}, "Your new API key"),
      el("p", { class: "warn" }, "Copy it now and keep it somewhere safe. For your security it won't be shown again."),
      codeBlock(newKey.key),
      el("button", { type: "button", onclick: () => { newKey = null; render(); } }, "Done"));
  }

  function createForm() {
    const name = el("input", { type: "text", maxlength: "50", required: true,
      placeholder: "Key name, e.g. My Python script", "aria-label": "Key name" });
    const error = el("p", { class: "form-error", role: "alert", hidden: true });
    const form = el("form", { class: "create-key", onsubmit: async (e) => {
      e.preventDefault();
      if (busy || !name.value.trim()) return;
      busy = true;
      try {
        const res = await LB.post("/api/keys", { name: name.value });
        newKey = { key: res.key, record: res.record };
        render();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      } finally {
        busy = false;
      }
    } }, name, el("button", { type: "submit" }, "Create key"));
    return el("div", { class: "card" },
      el("h2", {}, "Personal API keys"),
      el("p", { class: "muted" }, "Use a key to call LexBot from your own programs and scripts. "
        + "A key acts as you, so keep it secret, and revoke it if it might have leaked."),
      form, error);
  }

  function keyTable(keys) {
    if (!keys.length) return el("p", { class: "muted" }, "You don't have any API keys yet.");
    return el("table", { class: "rel-table keys-table" },
      el("thead", {}, el("tr", {}, ["Name", "Key", "Created", "Last used", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, keys.map((k) => el("tr", {},
        el("td", {}, k.name),
        el("td", {}, el("code", {}, `${k.prefix}…`)),
        el("td", {}, fmtDate(k.created)),
        el("td", {}, fmtDate(k.last_used)),
        el("td", {}, el("button", { type: "button", class: "secondary danger small-btn", onclick: async () => {
          if (!confirm(`Revoke the key "${k.name}"? Programs using it will stop working immediately.`)) return;
          try {
            await LB.del(`/api/keys/${k.id}`);
          } catch (err) {
            alert(err.message);
          }
          render();
        } }, "Revoke"))))));
  }

  function usage() {
    const origin = location.origin;
    const curl = `curl -X POST ${origin}/api/chat \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "What is a tort?"}'`;
    const py = `import json, urllib.request

req = urllib.request.Request(
    "${origin}/api/chat",
    data=json.dumps({"message": "What is a tort?"}).encode(),
    headers={"Authorization": "Bearer YOUR_API_KEY",
             "Content-Type": "application/json"},
)
reply = json.load(urllib.request.urlopen(req))
print(reply["reply"])`;
    return el("div", { class: "card" },
      el("h2", {}, "Using a key"),
      el("p", { class: "muted" }, "Send it in the Authorization header. To continue the same conversation, pass the returned ",
        el("code", {}, "session_id"), " back. Add ", el("code", {}, '"ai": false'), " to get the rule-based answer only."),
      el("h3", {}, "curl"), codeBlock(curl),
      el("h3", {}, "Python"), codeBlock(py),
      el("p", { class: "muted small endpoints" }, "Endpoints: POST /api/chat, POST /api/explain, GET /api/concepts, "
        + "GET /api/concepts/<id>, GET /api/rules, GET /api/stats, GET /api/auth/me."));
  }

  function aiStatus(config) {
    const on = config && config.ai_available;
    return el("div", { class: "card" },
      el("h2", {}, "Gemini AI answers"),
      el("p", {}, el("span", { class: `status-dot ${on ? "ok" : ""}` }), " ",
        on ? `On, using Google ${config.ai_model}. Answers are rewritten in plain language from LexBot's rule-based reasoning.`
          : `Off. ${config && config.ai_reason ? config.ai_reason : ""}`),
      on ? el("p", { class: "muted small" }, "Turn it off for yourself with the \u201cAI answers\u201d switch at the top of a chat.")
        : el("div", {},
          el("p", { class: "muted" }, "To turn it on, the person running the server adds a Google API key:"),
          el("ol", { class: "setup-steps" },
            el("li", {}, "In the Firebase console, open your project \u2192 AI Logic \u2192 Get started, and choose the ",
              el("strong", {}, "Gemini Developer API"), " (this enables Gemini for the project). "
              + "Or create a key at aistudio.google.com."),
            el("li", {}, "Copy the project's API key (Project settings \u2192 General \u2192 Web API key)."),
            el("li", {}, "Create ", el("code", {}, "backend/.env"), " containing ",
              el("code", {}, "GEMINI_API_KEY=AIza..."), "."),
            el("li", {}, "Restart the server: ", el("code", {}, "python3 backend/server.py"), ".")),
          el("p", { class: "muted small" }, "The key stays on the server; it is never sent to browsers. "
            + "No extra Python packages are needed.")));
  }

  async function render() {
    let keys = [];
    let config = LB.config;
    try {
      [keys, config] = await Promise.all([
        LB.get("/api/keys").then((r) => r.keys),
        LB.get("/api/config"),
      ]);
      LB.config = config;
    } catch (err) {
      body.replaceChildren(LB.errorBox(err.message));
      return;
    }
    body.replaceChildren(...[
      newKey ? newKeyPanel() : null,
      createForm(),
      el("div", { class: "card" }, el("h2", {}, `Your keys (${keys.length})`), keyTable(keys)),
      usage(),
      aiStatus(config),
    ].filter(Boolean));
  }

  LB.apikeys = { show: render, reset() { newKey = null; } };
})();

// Projects view: group saved chats into named projects.
(() => {
  "use strict";
  const { el } = LB;
  const body = document.getElementById("projects-body");
  const newBtn = document.getElementById("new-project-btn");
  let openId = null;
  let formOpen = false;

  function lastMessage(chat) {
    const m = [...chat.messages].reverse().find((x) => x.role === "user");
    return m ? m.text : "";
  }

  function chatRow(chat) {
    return el("a", { class: "chat-row", href: `#chat/${encodeURIComponent(chat.id)}` },
      el("div", { class: "chat-row-main" },
        el("div", { class: "chat-row-title" }, chat.title),
        el("div", { class: "muted small chat-row-sub" },
          `${chat.messages.filter((m) => m.role === "user").length} questions · last: ${lastMessage(chat)}`)),
      el("span", { class: "muted small" }, LB.relativeTime(chat.updated)));
  }

  // ------------------------------------------------------------- new form
  function projectForm() {
    const name = el("input", { type: "text", maxlength: "80", required: true,
      placeholder: "Project name, e.g. Tenancy dispute", "aria-label": "Project name" });
    const desc = el("input", { type: "text", maxlength: "200",
      placeholder: "Description (optional)", "aria-label": "Project description" });
    const close = () => { formOpen = false; render(); };
    const form = el("form", { class: "card project-form", onsubmit: (e) => {
      e.preventDefault();
      if (!name.value.trim()) return;
      const p = LB.store.createProject(name.value, desc.value);
      formOpen = false;
      location.hash = `#projects/${encodeURIComponent(p.id)}`;
    } },
    el("h2", {}, "New project"), name, desc,
    el("div", { class: "form-actions" },
      el("button", { type: "submit" }, "Create project"),
      el("button", { type: "button", class: "secondary", onclick: close }, "Cancel")));
    setTimeout(() => name.focus(), 0);
    return form;
  }

  // ----------------------------------------------------------------- list
  function renderList() {
    newBtn.hidden = false;
    const projects = LB.store.projects();
    const parts = [];
    if (formOpen) parts.push(projectForm());

    if (!projects.length && !formOpen) {
      parts.push(el("div", { class: "card empty" },
        el("p", {}, "No projects yet."),
        el("p", { class: "muted small" },
          "Projects keep related chats together, for example everything about one tenancy or one job."),
        el("button", { type: "button", onclick: () => { formOpen = true; render(); } }, "Create a project")));
    } else if (projects.length) {
      parts.push(el("div", { class: "project-grid" }, projects.map((p) => {
        const chats = LB.store.projectChats(p.id);
        const updated = chats.length ? chats[0].updated : p.created;
        return el("a", { class: "card project-card", href: `#projects/${encodeURIComponent(p.id)}` },
          el("div", { class: "project-icon", "aria-hidden": "true" }, p.name.charAt(0).toUpperCase()),
          el("div", { class: "project-name" }, p.name),
          p.description ? el("div", { class: "muted small project-desc" }, p.description) : null,
          el("div", { class: "muted small" },
            `${chats.length} chat${chats.length === 1 ? "" : "s"} · ${LB.relativeTime(updated)}`));
      })));
    }

    const loose = LB.store.chats().filter((c) => !c.projectId);
    if (loose.length) {
      parts.push(el("section", { class: "project-section" },
        el("h2", {}, "Chats not in a project"),
        el("p", { class: "muted small" }, "Open a chat and pick a project from the menu at the top to move it."),
        el("div", { class: "card chat-list" }, loose.slice(0, 10).map(chatRow))));
    }
    body.replaceChildren(...parts);
  }

  // --------------------------------------------------------------- detail
  function renderDetail(project) {
    newBtn.hidden = true;
    const chats = LB.store.projectChats(project.id);
    body.replaceChildren(
      el("a", { href: "#projects", class: "back-link" }, "← All projects"),
      el("div", { class: "card project-head" },
        el("div", {},
          el("h2", {}, project.name),
          project.description ? el("p", { class: "muted" }, project.description) : null,
          el("p", { class: "muted small" },
            `${chats.length} chat${chats.length === 1 ? "" : "s"} · created ${LB.relativeTime(project.created)}`)),
        el("div", { class: "header-actions" },
          el("button", { type: "button", onclick: () => LB.chat.newChat(project.id) }, "New chat in project"),
          el("button", { type: "button", class: "secondary", onclick: () => {
            const name = prompt("Project name:", project.name);
            if (name && name.trim()) {
              const description = prompt("Description (optional):", project.description || "");
              LB.store.updateProject(project.id, { name: name.trim(),
                description: (description ?? project.description ?? "").trim() });
              render();
            }
          } }, "Rename"),
          el("button", { type: "button", class: "secondary danger", onclick: () => {
            if (confirm(`Delete the project "${project.name}"? Its chats are kept.`)) {
              LB.store.deleteProject(project.id);
              location.hash = "#projects";
            }
          } }, "Delete"))),
      chats.length
        ? el("div", { class: "card chat-list" }, chats.map(chatRow))
        : el("div", { class: "card empty" },
          el("p", {}, "No chats in this project yet."),
          el("p", { class: "muted small" },
            "Start one with “New chat in project”, or open an existing chat and choose this project from its menu.")));
  }

  function render() {
    const project = openId ? LB.store.project(openId) : null;
    if (openId && !project) {
      history.replaceState(null, "", "#projects");
      openId = null;
    }
    if (project) renderDetail(project); else renderList();
  }

  newBtn.addEventListener("click", () => { formOpen = true; render(); });
  LB.store.onChange(() => {
    if (!document.getElementById("view-projects").hidden && !formOpen) render();
  });

  LB.projects = {
    show(projectId) {
      openId = projectId || null;
      if (openId) formOpen = false;
      render();
    },
  };
})();

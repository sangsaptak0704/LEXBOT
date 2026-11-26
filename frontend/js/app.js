// Router: shows one view per URL hash (#chat/<id>, #search, #projects/<id>, #explore/<id>, #activity, #api-keys).
(() => {
  "use strict";
  const VIEWS = ["chat", "search", "projects", "explore", "activity", "api-keys", "tools", "quiz", "insights"];

  const AUTH_VIEWS = ["signin", "signup"];

  function route() {
    const [rawView, rawArg] = location.hash.replace(/^#/, "").split("/");

    // Signed out: only the sign-in / sign-up screen is available.
    if (!LB.user) {
      if (!AUTH_VIEWS.includes(rawView) && location.hash) {
        sessionStorage.setItem("lexbot_after_login", location.hash);
      }
      LB.auth.showScreen(rawView === "signup" ? "signup" : "signin");
      return;
    }
    if (AUTH_VIEWS.includes(rawView)) {
      history.replaceState(null, "", "#chat");
      route();
      return;
    }
    const view = VIEWS.includes(rawView) ? rawView : "chat";
    const arg = rawArg ? decodeURIComponent(rawArg) : null;

    for (const v of VIEWS) document.getElementById(`view-${v}`).hidden = v !== view;
    document.querySelectorAll(".nav-link").forEach((a) => {
      const active = a.dataset.view === view;
      a.classList.toggle("active", active);
      if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    LB.hideTooltip();

    if (view !== "chat") LB.sidebar.highlight(null);
    if (view === "chat") LB.chat.show(arg);
    else if (view === "search") LB.search.show();
    else if (view === "projects") LB.projects.show(arg);
    else if (view === "explore") LB.explorer.show(arg);
    else if (view === "api-keys") LB.apikeys.show();
    else if (view === "tools") LB.tools.show(arg);
    else if (view === "quiz") LB.quiz.show();
    else if (view === "insights") LB.insights.show();
    else LB.activity.show();
  }

  // Sidebar toggle: collapse to icons only; the choice is remembered.
  const SIDEBAR_KEY = "lexbot_sidebar_collapsed";
  const toggle = document.getElementById("sidebar-toggle");
  function setCollapsed(collapsed) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  }
  toggle.addEventListener("click", () =>
    setCollapsed(!document.body.classList.contains("sidebar-collapsed")));
  setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");

  LB.route = route;
  window.addEventListener("hashchange", route);
  (async () => {
    await LB.auth.init();   // signed in already? (cookie from an earlier visit)
    route();
  })();
})();

// Sign in / sign up screens, the signed-in user, and the account menu at the bottom of the sidebar.
(() => {
  "use strict";
  const { el } = LB;

  const screen = document.getElementById("auth-screen");
  const tabs = { signin: document.getElementById("tab-signin"), signup: document.getElementById("tab-signup") };
  const forms = { signin: document.getElementById("signin-form"), signup: document.getElementById("signup-form") };
  const notice = document.getElementById("auth-notice");

  const accountBtn = document.getElementById("account-btn");
  const accountMenu = document.getElementById("account-menu");

  LB.user = null;

  // -------------------------------------------------------------- helpers
  function initials(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  function setError(form, message) {
    const box = form.querySelector(".form-error");
    box.textContent = message || "";
    box.hidden = !message;
  }

  function setBusy(form, busy) {
    form.querySelectorAll("input, button").forEach((x) => { x.disabled = busy; });
    const submit = form.querySelector("button[type=submit]");
    submit.textContent = busy ? "Please wait..." : submit.dataset.label;
  }

  /** Chats saved before accounts existed are given to the first person who signs in here. */
  function adoptLegacyData() {
    for (const name of ["chats", "projects", "activity"]) {
      const old = localStorage.getItem(`lexbot_${name}`);
      if (old && !localStorage.getItem(LB.userKey(name))) localStorage.setItem(LB.userKey(name), old);
      localStorage.removeItem(`lexbot_${name}`);
    }
  }

  // ------------------------------------------------------------- screens
  function showScreen(which, message) {
    document.body.classList.add("signed-out");
    screen.hidden = false;
    for (const key of ["signin", "signup"]) {
      const active = key === which;
      tabs[key].classList.toggle("active", active);
      tabs[key].setAttribute("aria-selected", String(active));
      forms[key].hidden = !active;
      setError(forms[key], "");
    }
    notice.textContent = message || "";
    notice.hidden = !message;
    const first = forms[which].querySelector("input:not([type=hidden])");
    setTimeout(() => first && first.focus(), 0);
  }

  function hideScreen() {
    document.body.classList.remove("signed-out");
    screen.hidden = true;
  }

  function signedIn(user) {
    LB.user = user;
    adoptLegacyData();
    document.getElementById("account-avatar").textContent = initials(user.name);
    document.getElementById("account-name").textContent = user.name;
    document.getElementById("account-email").textContent = user.email;
    forms.signin.reset();
    forms.signup.reset();
    hideScreen();
    LB.sidebar && LB.sidebar.render();
  }

  // --------------------------------------------------------------- submit
  async function submit(kind, form) {
    const data = Object.fromEntries(new FormData(form).entries());
    if (kind === "signup" && data.password !== data.confirm) {
      setError(form, "The two passwords don't match.");
      form.elements.confirm.focus();
      return;
    }
    setError(form, "");
    setBusy(form, true);
    try {
      const body = kind === "signup"
        ? { name: data.name, email: data.email, password: data.password }
        : { email: data.email, password: data.password };
      const res = await LB.post(kind === "signup" ? "/api/auth/signup" : "/api/auth/login", body);
      signedIn(res.user);
      const target = sessionStorage.getItem("lexbot_after_login");
      sessionStorage.removeItem("lexbot_after_login");
      const next = target && !/^#(signin|signup)/.test(target) ? target : "#chat";
      if (location.hash === next) LB.route(); else location.hash = next;   // hashchange routes
    } catch (err) {
      setError(form, err.status ? err.message : "Couldn't reach the server. Is it running?");
    } finally {
      setBusy(form, false);
    }
  }

  forms.signin.addEventListener("submit", (e) => { e.preventDefault(); submit("signin", forms.signin); });
  forms.signup.addEventListener("submit", (e) => { e.preventDefault(); submit("signup", forms.signup); });
  document.querySelectorAll(".toggle-password").forEach((btn) => btn.addEventListener("click", () => {
    const input = btn.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? "Hide" : "Show";
    btn.setAttribute("aria-pressed", String(show));
  }));

  // -------------------------------------------------------- account menu
  function openMenu() {
    // The menu is position:fixed so the sidebar's overflow can't clip it.
    const r = accountBtn.getBoundingClientRect();
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    const collapsed = document.body.classList.contains("sidebar-collapsed");
    Object.assign(accountMenu.style, { left: "", top: "", bottom: "", width: "" });
    accountMenu.hidden = false;
    if (mobile) {                         // drop down below the button
      accountMenu.style.top = `${r.bottom + 6}px`;
      accountMenu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - accountMenu.offsetWidth - 8))}px`;
    } else if (collapsed) {               // open to the right of the icon
      accountMenu.style.left = `${r.right + 8}px`;
      accountMenu.style.bottom = `${window.innerHeight - r.bottom}px`;
    } else {                              // open upwards, same width as the button
      accountMenu.style.left = `${r.left}px`;
      accountMenu.style.bottom = `${window.innerHeight - r.top + 6}px`;
      accountMenu.style.width = `${r.width}px`;
    }
    accountBtn.setAttribute("aria-expanded", "true");
    accountMenu.querySelector("[role=menuitem]").focus();
  }

  function closeMenu(focusButton) {
    if (accountMenu.hidden) return;
    accountMenu.hidden = true;
    accountBtn.setAttribute("aria-expanded", "false");
    if (focusButton) accountBtn.focus();
  }

  accountBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (accountMenu.hidden) openMenu(); else closeMenu();
  });
  document.addEventListener("click", (e) => {
    if (!accountMenu.contains(e.target)) closeMenu();
  });
  accountMenu.addEventListener("keydown", (e) => {
    const items = [...accountMenu.querySelectorAll("[role=menuitem]")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "Escape") closeMenu(true);
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  accountMenu.addEventListener("click", (e) => {
    if (e.target.closest("[role=menuitem]")) closeMenu();
  });
  document.getElementById("logout-btn").addEventListener("click", () => LB.auth.logout());

  // ----------------------------------------------------------------- API
  LB.auth = {
    /** Find out whether the browser already has a valid sign-in cookie. */
    async init() {
      try {
        const res = await LB.get("/api/auth/me");
        signedIn(res.user);
      } catch {
        LB.user = null;
      }
    },
    showScreen,
    async logout() {
      try {
        await LB.post("/api/auth/logout", {});
      } catch {
        /* the cookie is cleared server-side; nothing else to do if offline */
      }
      LB.user = null;
      LB.config = null;
      LB.chat.reset();
      LB.apikeys.reset();
      history.replaceState(null, "", "#signin");   // no hashchange, so the notice below stays
      showScreen("signin", "You have been logged out.");
    },
    /** Called when the server says the sign-in is no longer valid. */
    expired() {
      if (!LB.user) return;
      LB.user = null;
      LB.config = null;
      LB.chat.reset();
      sessionStorage.setItem("lexbot_after_login", location.hash);
      showScreen("signin", "Your session has expired. Please sign in again.");
    },
  };

  // Keep the shown tab in sync with "Sign up" / "Sign in" links.
  tabs.signin.addEventListener("click", () => { location.hash = "#signin"; });
  tabs.signup.addEventListener("click", () => { location.hash = "#signup"; });
})();

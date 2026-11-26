// Light / dark theme, switched from the account menu and remembered in this browser.
(() => {
  "use strict";
  const KEY = "lexbot_theme";
  const btn = document.getElementById("theme-btn");
  const label = document.getElementById("theme-label");

  function apply(dark) {
    document.body.classList.toggle("theme-dark", dark);
    label.textContent = dark ? "Light mode" : "Dark mode";
    localStorage.setItem(KEY, dark ? "dark" : "light");
  }
  btn.addEventListener("click", () => apply(!document.body.classList.contains("theme-dark")));
  apply(localStorage.getItem(KEY) === "dark");
})();

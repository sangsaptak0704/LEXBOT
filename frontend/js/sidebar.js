// Sidebar: "New chat" button, recent chats list, Ctrl/Cmd+K for search.
(() => {
  "use strict";
  const { el } = LB;
  const MAX_RECENTS = 20;
  const recentBox = document.getElementById("recent-chats");
  let activeId = null;

  function render() {
    const chats = LB.store.chats().slice(0, MAX_RECENTS);
    if (!chats.length) {
      recentBox.replaceChildren(el("p", { class: "recent-empty" }, "Your chats will appear here."));
      return;
    }
    recentBox.replaceChildren(...chats.map((c) => el("a", {
      class: `recent-link${c.id === activeId ? " active" : ""}`,
      href: `#chat/${encodeURIComponent(c.id)}`,
      title: c.title,
    }, c.title)));
  }

  document.getElementById("new-chat-btn").addEventListener("click", () => LB.chat.newChat());

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (location.hash === "#search") LB.search.focus();
      else location.hash = "#search";
    }
  });

  LB.store.onChange(render);

  LB.sidebar = {
    render,
    /** Mark the open chat in the recents list (null = none). */
    highlight(id) {
      activeId = id;
      render();
    },
  };
  render();
})();

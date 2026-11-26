// Saved chats and projects, kept in this browser's localStorage.
(() => {
  "use strict";
  // Keys are per user (see LB.userKey), so people sharing a browser don't see each other's chats.
  const CHATS_KEY = "chats";
  const PROJECTS_KEY = "projects";
  const MAX_CHATS = 200;
  const listeners = [];

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function read(key) {
    try {
      const v = JSON.parse(localStorage.getItem(LB.userKey(key)) || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(LB.userKey(key), JSON.stringify(value));
    } catch {
      // Storage full: drop the oldest chats and try once more.
      if (key === CHATS_KEY && value.length > 10) {
        localStorage.setItem(LB.userKey(key), JSON.stringify(value.slice(0, Math.floor(value.length / 2))));
      }
    }
    listeners.forEach((fn) => fn());
  }

  const byUpdated = (a, b) => b.updated - a.updated;

  LB.store = {
    onChange(fn) { listeners.push(fn); },

    // ---------------------------------------------------------------- chats
    chats() { return read(CHATS_KEY).sort(byUpdated); },
    chat(id) { return read(CHATS_KEY).find((c) => c.id === id) || null; },

    /** A new, unsaved chat; it is stored the first time a message is added. */
    newChat(projectId) {
      const now = Date.now();
      return { id: uid(), title: "New chat", projectId: projectId || null, sessionId: null,
        messages: [], lastTrace: null, created: now, updated: now };
    },

    saveChat(chat) {
      chat.updated = Date.now();
      const chats = read(CHATS_KEY).filter((c) => c.id !== chat.id);
      chats.unshift(chat);
      write(CHATS_KEY, chats.sort(byUpdated).slice(0, MAX_CHATS));
    },

    /** Change fields without bumping the "last updated" order. */
    updateChat(id, fields) {
      const chats = read(CHATS_KEY);
      const chat = chats.find((c) => c.id === id);
      if (!chat) return;
      Object.assign(chat, fields);
      write(CHATS_KEY, chats);
    },

    deleteChat(id) { write(CHATS_KEY, read(CHATS_KEY).filter((c) => c.id !== id)); },

    // ------------------------------------------------------------- projects
    projects() { return read(PROJECTS_KEY).sort((a, b) => a.name.localeCompare(b.name)); },
    project(id) { return read(PROJECTS_KEY).find((p) => p.id === id) || null; },
    projectChats(id) { return this.chats().filter((c) => c.projectId === id); },

    createProject(name, description) {
      const project = { id: uid(), name: name.trim(), description: (description || "").trim(),
        created: Date.now() };
      write(PROJECTS_KEY, [...read(PROJECTS_KEY), project]);
      return project;
    },

    updateProject(id, fields) {
      const projects = read(PROJECTS_KEY);
      const p = projects.find((x) => x.id === id);
      if (!p) return;
      Object.assign(p, fields);
      write(PROJECTS_KEY, projects);
    },

    /** Deleting a project keeps its chats; they just stop belonging to it. */
    deleteProject(id) {
      const chats = read(CHATS_KEY);
      chats.forEach((c) => { if (c.projectId === id) c.projectId = null; });
      write(CHATS_KEY, chats);
      write(PROJECTS_KEY, read(PROJECTS_KEY).filter((p) => p.id !== id));
    },
  };

  /** "5 min ago", "Yesterday", "12 Mar" */
  LB.relativeTime = (ts) => {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return `${Math.floor(diff / 3600)} h ago`;
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };
})();

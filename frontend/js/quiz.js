// Rights quiz: five definition -> term questions from the knowledge base, with a score.
(() => {
  "use strict";
  const { el } = LB;
  const box = document.getElementById("quiz-body");
  const BEST_KEY = () => LB.userKey("quiz_best");

  let questions = [];
  let index = 0;
  let score = 0;
  let missed = [];

  async function start() {
    box.replaceChildren(el("p", { class: "muted" }, "Loading questions..."));
    try {
      questions = (await LB.get("/api/quiz")).questions;
    } catch (err) {
      box.replaceChildren(LB.errorBox(err.message));
      return;
    }
    index = 0; score = 0; missed = [];
    ask();
  }

  function progress() {
    return el("div", { class: "quiz-progress", role: "progressbar", "aria-valuemin": "0",
      "aria-valuemax": String(questions.length), "aria-valuenow": String(index) },
    questions.map((_, i) => el("span", { class: i < index ? "done" : i === index ? "now" : "" })));
  }

  function ask() {
    const q = questions[index];
    const feedback = el("div", { class: "quiz-feedback", "aria-live": "polite" });
    const next = el("button", { type: "button", hidden: true }, index + 1 < questions.length ? "Next question" : "See my score");
    next.addEventListener("click", () => { index += 1; if (index < questions.length) ask(); else finish(); });
    const options = el("div", { class: "quiz-options" }, q.options.map((o, i) => {
      const b = el("button", { type: "button", class: "quiz-option" },
        el("span", { class: "quiz-letter" }, "ABCD"[i]), o.label);
      b.addEventListener("click", () => {
        const right = o.id === q.answer;
        if (right) score += 1;
        else missed.push(q.options.find((x) => x.id === q.answer).label);
        options.querySelectorAll("button").forEach((btn, j) => {
          btn.disabled = true;
          if (q.options[j].id === q.answer) btn.classList.add("correct");
          else if (btn === b) btn.classList.add("wrong");
        });
        const answer = q.options.find((x) => x.id === q.answer).label;
        feedback.replaceChildren(el("strong", {}, right ? "Correct!" : `Not quite: it's ${answer}.`));
        feedback.className = `quiz-feedback ${right ? "good" : "bad"}`;
        next.hidden = false;
        next.focus();
      });
      return b;
    }));
    box.replaceChildren(el("div", { class: "quiz-card card" },
      progress(),
      el("div", { class: "quiz-meta" }, el("span", {}, `Question ${index + 1} of ${questions.length}`),
        q.area ? el("span", { class: "badge" }, q.area) : null),
      el("p", { class: "quiz-q" }, `"${q.definition}"`),
      el("p", { class: "muted small" }, "Which legal term is this?"),
      options, feedback, next));
  }

  function finish() {
    const best = Math.max(score, Number(localStorage.getItem(BEST_KEY()) || 0));
    localStorage.setItem(BEST_KEY(), String(best));
    const pct = Math.round((score / questions.length) * 100);
    const verdict = pct === 100 ? "Perfect score! You know your rights."
      : pct >= 60 ? "Well done. A little more and you'll be an expert."
        : "Good start. Ask LexBot about the terms you missed.";
    const again = el("button", { type: "button" }, "Play again");
    again.addEventListener("click", start);
    box.replaceChildren(el("div", { class: "quiz-card card quiz-result" },
      el("div", { class: "quiz-score", style: `--pct:${pct}` },
        el("span", {}, `${score}/${questions.length}`)),
      el("h2", {}, verdict),
      el("p", { class: "muted" }, `Your best score: ${best}/${questions.length}`),
      missed.length ? el("div", { class: "quiz-missed" }, el("p", {}, "Learn about the terms you missed:"),
        el("div", { class: "chip-row" }, missed.map((label) => {
          const c = el("button", { type: "button", class: "chip" }, `What is ${label}?`);
          c.addEventListener("click", () => LB.chat.ask(`What is ${label}?`));
          return c;
        }))) : null,
      again));
  }

  document.getElementById("quiz-new").addEventListener("click", start);

  LB.quiz = {
    show() { if (!questions.length || index >= questions.length) start(); },
  };
})();

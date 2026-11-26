"""Dialogue manager: parses a question, reasons over it, and picks a response strategy."""

from __future__ import annotations

from dataclasses import dataclass, field, replace

from .formatter import DISCLAIMER, SPECIFIC_ADVICE, Formatter, heading, wrap
from .knowledge import KnowledgeBase
from .nlp import Analysis, analyze, normalize
from .rule_engine import InferenceResult

BOT_NAME = "LexBot"

WHY_COMMANDS = {"why", "explain that", "how did you decide", "show reasoning", "reasoning", "trace"}
TOPIC_COMMANDS = {"topics", "list topics", "what topics", "what do you know"}
RESET_COMMANDS = {"reset", "start over", "new topic", "clear"}

HELP_TEXT = f"""\
I'm {BOT_NAME}, a legal FAQ assistant. You can ask me to:

  * Define a term          What is negligence?  /  Explain a power of attorney
  * List types             What are the types of tort?
  * Explain requirements   What are the elements of a contract?
  * Compare terms          Difference between libel and slander
  * Advise on a situation  My landlord won't return my security deposit
                           I was fired without notice. What can I do?

Commands: 'topics' (what I know), 'why' (show my reasoning for the last
answer), 'reset' (forget the conversation context), 'quit' (exit)."""

SMALL_TALK = {
    "greeting": f"Hello! I'm {BOT_NAME}. Ask me about a legal term or describe your situation. "
                "Type 'help' for examples.",
    "thanks": "You're welcome! Anything else I can help you with?",
    "farewell": "Goodbye, and good luck! Remember to consult a qualified lawyer for important matters.",
}


@dataclass
class Turn:
    question: str
    analysis: Analysis
    concepts: list[str]
    assumed: list[tuple[str, str]] = field(default_factory=list)
    used_context: bool = False
    result: InferenceResult | None = None


class LegalChatbot:
    def __init__(self, kb: KnowledgeBase | None = None):
        self.kb = kb or KnowledgeBase.load()
        self.net = self.kb.net
        self.fmt = Formatter(self.net)
        self.context: list[str] = []      # concepts from the previous turn, for follow-ups
        self.last_turn: Turn | None = None
        self.finished = False
        self._hinted = False              # the "describe your situation" hint is shown once

    def greeting(self) -> str:
        return (f"Hi, I'm {BOT_NAME}, your legal FAQ assistant. Ask me what a legal term means "
                "or describe your problem (e.g. \"my landlord won't return my deposit\").\n"
                "Type 'help' for examples or 'quit' to leave.\n\n" + wrap(DISCLAIMER, indent=""))

    # ------------------------------------------------------------- main entry
    def respond(self, text: str) -> str:
        command = normalize(text)
        if command in WHY_COMMANDS:
            return self.explain()
        if command in TOPIC_COMMANDS:
            return self.fmt.topics()
        if command in RESET_COMMANDS:
            self.context = []
            return "OK, I've cleared the conversation context. What would you like to ask?"

        analysis = analyze(text)
        if analysis.intent == "empty":
            return "Please type a question, or 'help' to see what I can do."
        if analysis.intent == "help":
            return HELP_TEXT
        if analysis.intent in SMALL_TALK:
            if analysis.intent == "farewell":
                self.finished = True
            return SMALL_TALK[analysis.intent]

        turn = self._understand(text, analysis)
        turn.result = self.kb.engine.infer(self.kb.facts_for(analysis, turn.concepts))

        # Intent refinement: an unclear sentence that *describes events* (more
        # content words than just term names) and triggers a situation is a
        # request for guidance, e.g. "The supplier broke the contract".
        is_narrative = len(analysis.keywords) > len(turn.concepts) + 1
        if analysis.intent == "unknown" and is_narrative and turn.result.has_prefix("situation:"):
            analysis = replace(analysis, intent="advice")
            turn.analysis = analysis
            turn.result = self.kb.engine.infer(self.kb.facts_for(analysis, turn.concepts))
        self.last_turn = turn
        if turn.concepts:
            self.context = turn.concepts

        notes = []
        if turn.assumed:
            notes.append("(I assumed you meant: "
                         + ", ".join(self.net.label(c) for c, _ in turn.assumed) + ".)")
        if turn.used_context:
            notes.append(f"(Continuing with: {self.fmt.labels(turn.concepts)}.)")
        urgent = self.fmt.urgent(turn.result)
        body = self._compose(turn)
        return "\n\n".join(part for part in ("\n".join(notes), urgent, body) if part)

    # --------------------------------------------------------------- pipeline
    def _understand(self, text: str, analysis: Analysis) -> Turn:
        concepts = self.kb.extractor.extract(analysis)
        turn = Turn(text, analysis, concepts)

        # Follow-up questions: "what are its types?", "how is it different from slander?"
        follow_up = analysis.has_pronoun or analysis.intent in ("types", "requirements", "comparison")
        if self.context and follow_up:
            if not concepts:
                turn.concepts = list(self.context)
                turn.used_context = True
            elif analysis.intent == "comparison" and len(concepts) == 1 and self.context[0] != concepts[0]:
                turn.concepts = [self.context[0], concepts[0]]
                turn.used_context = True

        # Spelling mistakes: fall back to fuzzy matching.
        if not turn.concepts:
            turn.assumed = self.kb.extractor.suggest(analysis)
            turn.concepts = [cid for cid, _ in turn.assumed]
        return turn

    def _compose(self, turn: Turn) -> str:
        intent, concepts, result = turn.analysis.intent, turn.concepts, turn.result
        assert result is not None

        if intent == "comparison":
            if len(concepts) >= 2:
                return self.fmt.compare(concepts[0], concepts[1])
            if concepts:
                return (self.fmt.definition(concepts[0]) + "\n\n(To compare, name two terms, "
                        "e.g. 'difference between libel and slander'.)")
        if intent == "types" and concepts:
            return self.fmt.types(concepts[0])
        if intent == "requirements" and concepts:
            return self.fmt.requirements(concepts[0])

        if intent == "advice":
            if result.advice and result.advice[0].priority >= SPECIFIC_ADVICE:
                return self.fmt.advice(result)
            if concepts:
                parts = [self.fmt.definition(concepts[0])]
                parts.append(self.fmt.advice(result) if result.advice else wrap(DISCLAIMER, indent=""))
                return "\n\n".join(parts)
            return self._not_understood()

        if concepts:
            parts = [self.fmt.definition(c) for c in concepts[:2]]
            if result.has_prefix("situation:") and not self._hinted:
                self._hinted = True
                parts.append(wrap("Tip: if this is about your own situation, describe it (e.g. "
                                  "\"what should I do if ...\") and I'll give step-by-step "
                                  "guidance.", indent=""))
            return "\n\n".join(parts)
        return self._not_understood()

    def _not_understood(self) -> str:
        return ("Sorry, I couldn't match that to a legal topic I know. Try naming the legal "
                "term or describing what happened, for example:\n"
                "  * What is a lease?\n"
                "  * My employer hasn't paid my salary\n"
                "  * Difference between mediation and arbitration\n"
                "Type 'topics' to see everything I know.")

    # ------------------------------------------------------------ explanation
    def explain(self) -> str:
        turn = self.last_turn
        if turn is None or turn.result is None:
            return "Ask me a question first, then type 'why' to see how I reasoned about it."
        a, result = turn.analysis, turn.result
        lines = [heading("How I reached my last answer"),
                 wrap(f'Question: "{turn.question}"'),
                 ""]
        flags = [f for f, on in (("negation", a.negated), ("first-person", a.first_person),
                                 ("pronoun/follow-up", a.has_pronoun)) if on]
        lines.append(wrap(f"1. NLP: intent = {a.intent}"
                          + (f"; signals: {', '.join(flags)}" if flags else "")
                          + f"; keywords (stemmed) = {', '.join(a.keywords) or '-'}",
                          hanging="     "))
        if turn.concepts:
            how = ("from conversation context" if turn.used_context
                   else "by fuzzy spelling match" if turn.assumed else "by phrase matching")
            lines.append(wrap(f"2. Legal terms recognised {how}: {self.fmt.labels(turn.concepts)}",
                              hanging="     "))
        else:
            lines.append("  2. No legal terms recognised.")
        semantic = sorted(f for f in result.initial_facts
                          if f.startswith(("isa:", "domain:")) and f.split(":", 1)[1] not in turn.concepts)
        lines.append(wrap("3. Inherited from the semantic net: " + (", ".join(semantic) or "-"),
                          hanging="     "))
        if result.fired:
            lines.append("  4. Rules fired (forward chaining, in order):")
            for rule in result.fired:
                outcome = []
                if rule.asserts:
                    outcome.append("assert " + ", ".join(rule.asserts))
                if rule.advice_title:
                    outcome.append(f"advice '{rule.advice_title}' (priority {rule.priority})")
                if rule.tip:
                    outcome.append("tip")
                lines.append(wrap(f"{rule.id}: IF {rule.describe_conditions()} THEN {'; '.join(outcome)}",
                                  indent="     - ", hanging="       "))
        else:
            lines.append("  4. No rules fired.")
        if result.advice:
            lines.append(wrap(f"5. Conflict resolution chose: '{result.advice[0].title}' "
                              f"(highest priority/specificity)", hanging="     "))
        return "\n".join(lines)

"""JSON views of the knowledge base and the reasoning trace, used by the web API."""

from __future__ import annotations

import re
from collections import Counter

from .chatbot import Turn
from .knowledge import KnowledgeBase
from .rule_engine import Rule
from .semantic_net import RELATIONS

RULE_KINDS = {
    "S": "Situation",
    "D": "Derived fact",
    "A": "Advice",
    "G": "General guidance",
    "T": "Tip",
}


def _ref(kb: KnowledgeBase, cid: str) -> dict:
    c = kb.net.get(cid)
    return {"id": c.id, "label": c.label, "category": c.category}


def _primary_domain(kb: KnowledgeBase, cid: str) -> str | None:
    domains = kb.net.domains(cid)
    return domains[0] if domains else None


def stats(kb: KnowledgeBase) -> dict:
    net = kb.net
    rules = kb.engine.rules
    return {
        "concepts": len(net),
        "relations": len(net.edges()),
        "domains": sum(1 for c in net.concepts() if c.category == "domain"),
        "rules": len(rules),
        "categories": dict(Counter(c.category for c in net.concepts())),
        "relation_types": dict(Counter(e.relation for e in net.edges())),
        "rule_kinds": {RULE_KINDS.get(k, k): n
                       for k, n in Counter(r.id.split("_")[0] for r in rules).items()},
    }


def concept_list(kb: KnowledgeBase) -> list[dict]:
    out = []
    for c in kb.net.concepts():
        domain = c.id if c.category == "domain" else _primary_domain(kb, c.id)
        out.append({
            "id": c.id, "label": c.label, "category": c.category, "aliases": list(c.aliases),
            "domain": domain, "domain_label": kb.net.label(domain) if domain else None,
        })
    return sorted(out, key=lambda c: c["label"].lower())


def concept_detail(kb: KnowledgeBase, cid: str) -> dict | None:
    net = kb.net
    if cid not in net:
        return None
    c = net.get(cid)

    def edge(e, direction: str) -> dict:
        other = e.target if direction == "out" else e.source
        return {"relation": e.relation, "phrase": RELATIONS[e.relation],
                "direction": direction, "concept": _ref(kb, other)}

    return {
        **_ref(kb, cid),
        "definition": c.definition,
        "aliases": list(c.aliases),
        "domains": [_ref(kb, d) for d in net.domains(cid)],
        "chain": [{"source": _ref(kb, e.source), "relation": e.relation,
                   "phrase": RELATIONS[e.relation], "target": _ref(kb, e.target)}
                  for e in net.chain(cid)],
        "subtypes": [{"depth": d, **_ref(kb, s)} for d, s in net.subtypes(cid)],
        "requirements": [{**_ref(kb, r), "inherited_from": _ref(kb, src) if src != cid else None}
                         for r, src in net.requirements(cid)],
        "related": [_ref(kb, r) for r in net.related(cid)],
        "edges": ([edge(e, "out") for e in net.outgoing(cid)]
                  + [edge(e, "in") for e in net.incoming(cid)]),
        "rules": [r.id for r in kb.engine.rules
                  if f"concept:{cid}" in {f for g in r.conditions for f in g} or cid in r.refs],
    }


def rule_dict(rule: Rule) -> dict:
    prefix = rule.id.split("_")[0]
    return {
        "id": rule.id,
        "kind": RULE_KINDS.get(prefix, prefix),
        "description": rule.description,
        "conditions": [list(g) for g in rule.conditions],
        "none": list(rule.none),
        "conditions_text": rule.describe_conditions(),
        "asserts": list(rule.asserts),
        "advice_title": rule.advice_title,
        "advice_steps": list(rule.advice_steps),
        "tip": rule.tip,
        "refs": list(rule.refs),
        "priority": rule.priority,
    }


def rule_list(kb: KnowledgeBase) -> list[dict]:
    return [rule_dict(r) for r in kb.engine.rules]


def trace(kb: KnowledgeBase, turn: Turn | None) -> dict | None:
    """Structured version of LegalChatbot.explain() for the reasoning panel."""
    if turn is None or turn.result is None:
        return None
    a, result = turn.analysis, turn.result
    signals = [name for name, on in (("negation", a.negated), ("first-person", a.first_person),
                                     ("pronoun/follow-up", a.has_pronoun)) if on]
    how = ("conversation context" if turn.used_context
           else "fuzzy spelling match" if turn.assumed
           else "phrase matching" if turn.concepts else None)
    inherited = sorted(f for f in result.initial_facts
                       if f.startswith(("isa:", "domain:"))
                       and f.split(":", 1)[1] not in turn.concepts)
    return {
        "question": turn.question,
        "intent": a.intent,
        "signals": signals,
        "keywords": list(a.keywords),
        "concepts": [_ref(kb, c) for c in turn.concepts],
        "matched_by": how,
        "inherited": inherited,
        "initial_facts": sorted(result.initial_facts),
        "derived_facts": result.derived_facts,
        "fired": [rule_dict(r) for r in result.fired],
        "chosen_advice": result.advice[0].title if result.advice else None,
    }


# ---------------------------------------------------------------------------
# Extras for the web app: follow-up questions, urgency, quiz, law of the day, self-test
# ---------------------------------------------------------------------------

def follow_ups(kb: KnowledgeBase, turn: Turn | None, limit: int = 3) -> list[str]:
    """Up to `limit` natural next questions, built from the semantic net around the answer."""
    if turn is None or not turn.concepts:
        return []
    net = kb.net
    cid = turn.concepts[0]
    intent = turn.analysis.intent

    def short(concept_id: str) -> str:
        """"FIR (First Information Report)" -> "FIR": the shorter of a label and its bracket."""
        full = net.label(concept_id)
        m = re.match(r"^(.*?)\s*\((.*)\)$", full)
        return min(m.groups(), key=len) if m else full

    label = short(cid)
    out: list[str] = []

    def add(q: str) -> None:
        if q not in out and q.lower() != turn.question.strip().lower():
            out.append(q)

    if intent != "advice":
        from .chatbot import LegalChatbot
        question = f"What should I do about {label if label.isupper() else label.lower()}?"
        probe = LegalChatbot(kb)
        probe.respond(question)
        if probe.last_turn and probe.last_turn.result and probe.last_turn.result.advice:
            add(question)
    if intent != "types" and net.subtypes(cid, recursive=False):
        add(f"What are the types of {label}?")
    if intent != "requirements" and net.requirements(cid):
        add(f"What does {label} require?")
    related = net.related(cid)
    if related and intent != "comparison":
        add(f"Difference between {label} and {short(related[0])}")
    for r in related[1:] + [c for c in turn.concepts[1:]]:
        add(f"What is {short(r)}?")
    if intent != "definition":
        add(f"What is {label}?")
    return out[:limit]


def is_urgent(turn: Turn | None) -> bool:
    return bool(turn and turn.result and any(t.priority >= 100 for t in turn.result.tips))


def _quiz_pool(kb: KnowledgeBase) -> list:
    return [c for c in kb.net.concepts() if c.category not in ("root", "domain")]


def quiz(kb: KnowledgeBase, count: int = 5, seed: int | None = None) -> list[dict]:
    """Multiple-choice questions: pick the term that matches a definition."""
    import random
    rng = random.Random(seed)
    pool = _quiz_pool(kb)
    questions = []
    for c in rng.sample(pool, min(count, len(pool))):
        domain = _primary_domain(kb, c.id)
        same = [o for o in pool if o.id != c.id and _primary_domain(kb, o.id) == domain]
        others = [o for o in pool if o.id != c.id and o not in same]
        rng.shuffle(same)
        rng.shuffle(others)
        options = [c] + (same + others)[:3]
        rng.shuffle(options)
        questions.append({
            "definition": c.definition,
            "area": kb.net.label(domain) if domain else None,
            "options": [{"id": o.id, "label": o.label} for o in options],
            "answer": c.id,
        })
    return questions


def law_of_the_day(kb: KnowledgeBase, day_number: int) -> dict:
    """A different term each day (same for everyone on a given day)."""
    pool = sorted(_quiz_pool(kb), key=lambda c: c.id)
    c = pool[day_number % len(pool)]
    domain = _primary_domain(kb, c.id)
    return {**_ref(kb, c.id), "definition": c.definition,
            "area": kb.net.label(domain) if domain else None}


def self_test(kb: KnowledgeBase, cases: list[dict]) -> dict:
    """Run labelled questions through fresh chatbots and report what passed.

    A case is {"q": ..., and one of "concept": id, "advice": title-substring, "unmatched": true}.
    """
    from .chatbot import LegalChatbot
    results = []
    for case in cases:
        bot = LegalChatbot(kb)
        reply = bot.respond(case["q"])
        turn = bot.last_turn
        concepts = list(turn.concepts) if turn else []
        advice = turn.result.advice[0].title if turn and turn.result and turn.result.advice else None
        if "concept" in case:
            ok = case["concept"] in concepts
            expected = f"term: {kb.net.label(case['concept'])}"
        elif "advice" in case:
            ok = bool(advice and case["advice"].lower() in advice.lower())
            expected = f"guidance: {case['advice']}"
        else:
            ok = "couldn't match" in reply
            expected = "says it doesn't know"
        got = (f"guidance: {advice}" if advice else
               "terms: " + ", ".join(kb.net.label(c) for c in concepts) if concepts else
               "no match")
        results.append({"question": case["q"], "expected": expected, "got": got, "passed": ok})
    passed = sum(r["passed"] for r in results)
    return {"total": len(results), "passed": passed,
            "score": round(100 * passed / len(results), 1) if results else 0.0, "results": results}

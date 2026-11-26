"""Rule-based reasoning: a small forward-chaining production system.

Working memory is a set of string facts (``concept:lease``, ``intent:advice``,
``kw:evict`` ...). Each rule has IF conditions and THEN actions:

    IF   all of the condition groups hold     (a group is OR-ed alternatives)
    AND  none of the `none` facts are present (negation as failure)
    THEN assert new facts, and/or conclude advice / a tip

Inference runs until no rule can fire (a fixpoint). Rules that use negation
are *stratified*: they are only tried after every positive rule has finished,
so "no evidence the user is the accused" really means none could be derived.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable


@dataclass(frozen=True)
class Rule:
    id: str
    description: str
    conditions: tuple[tuple[str, ...], ...]   # AND of OR-groups
    none: tuple[str, ...] = ()
    asserts: tuple[str, ...] = ()
    advice_title: str | None = None
    advice_steps: tuple[str, ...] = ()
    tip: str | None = None
    refs: tuple[str, ...] = ()
    priority: int = 0

    def matches(self, facts: set[str] | frozenset[str]) -> bool:
        return (all(any(alt in facts for alt in group) for group in self.conditions)
                and not any(f in facts for f in self.none))

    @property
    def specificity(self) -> int:
        return len(self.conditions) + len(self.none)

    def describe_conditions(self) -> str:
        parts = [" OR ".join(g) if len(g) == 1 else "(" + " OR ".join(g) + ")"
                 for g in self.conditions]
        parts += [f"NOT {f}" for f in self.none]
        return " AND ".join(parts)


@dataclass(frozen=True)
class Conclusion:
    rule_id: str
    kind: str              # "advice" or "tip"
    title: str
    steps: tuple[str, ...]
    refs: tuple[str, ...]
    priority: int
    specificity: int
    order: int


@dataclass
class InferenceResult:
    initial_facts: frozenset[str]
    facts: frozenset[str]
    fired: list[Rule] = field(default_factory=list)
    advice: list[Conclusion] = field(default_factory=list)
    tips: list[Conclusion] = field(default_factory=list)

    @property
    def derived_facts(self) -> list[str]:
        return sorted(self.facts - self.initial_facts)

    def has_prefix(self, prefix: str) -> bool:
        return any(f.startswith(prefix) for f in self.facts)


class RuleEngine:
    def __init__(self, rules: Iterable[Rule]):
        self.rules: list[Rule] = list(rules)
        ids = [r.id for r in self.rules]
        duplicates = {i for i in ids if ids.count(i) > 1}
        if duplicates:
            raise ValueError(f"Duplicate rule ids: {sorted(duplicates)}")

    # ---------------------------------------------------------------- loading
    @classmethod
    def from_dict(cls, data: dict, keyword_normalizer: Callable[[str], str] | None = None) -> "RuleEngine":
        def norm(fact: str) -> str:
            if keyword_normalizer and fact.startswith("kw:"):
                return "kw:" + keyword_normalizer(fact[3:])
            return fact

        rules = []
        for item in data["rules"]:
            cond = item.get("if", {})
            groups: list[tuple[str, ...]] = []
            for entry in cond.get("all", []):
                alts = entry if isinstance(entry, list) else [entry]
                groups.append(tuple(dict.fromkeys(norm(a) for a in alts)))
            if cond.get("any"):
                groups.append(tuple(dict.fromkeys(norm(a) for a in cond["any"])))
            then = item.get("then", {})
            advice = then.get("advice") or {}
            rules.append(Rule(
                id=item["id"],
                description=item.get("description", ""),
                conditions=tuple(groups),
                none=tuple(norm(f) for f in cond.get("none", [])),
                asserts=tuple(then.get("assert", [])),
                advice_title=advice.get("title"),
                advice_steps=tuple(advice.get("steps", [])),
                tip=then.get("tip"),
                refs=tuple(then.get("refs", [])),
                priority=item.get("priority", 0),
            ))
        return cls(rules)

    @classmethod
    def from_json(cls, path: str | Path, keyword_normalizer: Callable[[str], str] | None = None) -> "RuleEngine":
        with open(path, encoding="utf-8") as fh:
            return cls.from_dict(json.load(fh), keyword_normalizer)

    # -------------------------------------------------------------- inference
    def infer(self, initial_facts: Iterable[str]) -> InferenceResult:
        facts = set(initial_facts)
        start = frozenset(facts)
        fired: list[Rule] = []
        done: set[str] = set()

        def fire(rule: Rule) -> None:
            done.add(rule.id)
            fired.append(rule)
            facts.update(rule.asserts)

        while True:
            # Stratum 1: positive rules until fixpoint.
            changed = True
            while changed:
                changed = False
                for rule in self.rules:
                    if rule.id not in done and not rule.none and rule.matches(facts):
                        fire(rule)
                        changed = True
            # Stratum 2: one negation-as-failure rule, then re-run stratum 1.
            pending = next((r for r in self.rules
                            if r.id not in done and r.none and r.matches(facts)), None)
            if pending is None:
                break
            fire(pending)

        advice, tips = [], []
        for order, rule in enumerate(fired):
            if rule.advice_title:
                advice.append(Conclusion(rule.id, "advice", rule.advice_title, rule.advice_steps,
                                         rule.refs, rule.priority, rule.specificity, order))
            if rule.tip:
                tips.append(Conclusion(rule.id, "tip", rule.tip, (), rule.refs,
                                       rule.priority, rule.specificity, order))
        # Conflict resolution: priority, then specificity, then firing order.
        key = lambda c: (-c.priority, -c.specificity, c.order)  # noqa: E731
        return InferenceResult(start, frozenset(facts), fired, sorted(advice, key=key), sorted(tips, key=key))

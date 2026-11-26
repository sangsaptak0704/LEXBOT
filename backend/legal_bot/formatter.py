"""Turns knowledge-base lookups and inference results into readable text."""

from __future__ import annotations

import textwrap

from .rule_engine import InferenceResult
from .semantic_net import SemanticNet

WIDTH = 78
SPECIFIC_ADVICE = 5   # advice below this priority is only generic domain guidance

DISCLAIMER = ("Note: this is general legal information, not legal advice. Laws differ "
              "between countries and states; consult a qualified lawyer about your situation.")


def wrap(text: str, indent: str = "  ", hanging: str | None = None) -> str:
    return textwrap.fill(text, WIDTH, initial_indent=indent,
                         subsequent_indent=hanging if hanging is not None else indent)


def heading(title: str) -> str:
    return f"{title}\n{'-' * len(title)}"


class Formatter:
    def __init__(self, net: SemanticNet):
        self.net = net

    def labels(self, ids) -> str:
        return ", ".join(self.net.label(i) for i in ids)

    def _field(self, name: str, value: str) -> str:
        prefix = f"  {name}: "
        return wrap(value, indent=prefix, hanging=" " * len(prefix))

    def chain_text(self, concept_id: str) -> str:
        parts = [self.net.label(concept_id)]
        for edge in self.net.chain(concept_id):
            parts.append(f"{edge.phrase} {self.net.label(edge.target)}")
        return " -> ".join(parts)

    # ------------------------------------------------------------ definitions
    def definition(self, cid: str) -> str:
        net = self.net
        concept = net.get(cid)
        lines = [heading(concept.label), wrap(concept.definition), ""]

        if net.chain(cid):
            lines.append(self._field("Classification", self.chain_text(cid)))
        domains = net.domains(cid)
        if domains and concept.category != "domain":
            lines.append(self._field("Area of law", self.labels(domains)))
        reqs = net.requirements(cid)
        if reqs:
            text = ", ".join(
                net.label(r) + ("" if src == cid else f" (inherited from {net.label(src)})")
                for r, src in reqs)
            lines.append(self._field("Requires", text))
        for relation, name in (("part_of", "Consists of"), ("party_to", "Parties"),
                               ("is_a", "Types"), ("remedy_for", "Remedies"),
                               ("exception_to", "Exceptions"), ("applies_to", "Governed by")):
            sources = [e.source for e in net.incoming(cid, relation)]
            if sources:
                lines.append(self._field(name, self.labels(sources)))
        if concept.category == "domain":
            topics = [e.source for e in net.incoming(cid, "belongs_to")]
            if topics:
                lines.append(self._field("Key topics", self.labels(topics)))
        related = net.related(cid)
        if related:
            lines.append(self._field("Related terms", self.labels(related)))
        return "\n".join(lines).rstrip()

    def types(self, cid: str) -> str:
        subtypes = self.net.subtypes(cid)
        title = f"Types of {self.net.label(cid)}"
        if not subtypes:
            return (f"I don't know of any sub-types of {self.net.label(cid)}.\n\n"
                    + self.definition(cid))
        lines = [heading(title)]
        for depth, sid in subtypes:
            prefix = "  " + "    " * depth + "* "
            label = self.net.label(sid)
            room = max(20, WIDTH - len(prefix) - len(label) - 3)
            summary = textwrap.shorten(self.net.get(sid).definition, width=room, placeholder="...")
            lines.append(f"{prefix}{label} - {summary}")
        return "\n".join(lines)

    def requirements(self, cid: str) -> str:
        net = self.net
        reqs = net.requirements(cid)
        parts = [e.source for e in net.incoming(cid, "part_of")]
        if not reqs and not parts:
            return (f"I have no specific requirements recorded for {net.label(cid)}.\n\n"
                    + self.definition(cid))
        lines = [heading(f"What {net.label(cid)} requires")]
        seen = set()
        for rid, src in reqs:
            seen.add(rid)
            note = "" if src == cid else f" [inherited: {net.label(cid)} is a {net.label(src)}]"
            lines.append(wrap(f"* {net.label(rid)}: {net.get(rid).definition}{note}",
                              indent="  ", hanging="    "))
        for pid in parts:
            if pid not in seen:
                lines.append(wrap(f"* {net.label(pid)}: {net.get(pid).definition}",
                                  indent="  ", hanging="    "))
        return "\n".join(lines)

    def compare(self, a: str, b: str) -> str:
        net = self.net
        lines = [heading(f"{net.label(a)} vs {net.label(b)}")]
        for cid in (a, b):
            lines.append(wrap(f"{net.label(cid)}: {net.get(cid).definition}",
                              indent="  ", hanging="    "))
        lines.append("")
        common = net.common_ancestor(a, b)
        if common in (a, b):
            child, parent = (b, a) if common == a else (a, b)
            lines.append(self._field("Relationship",
                                     f"{net.label(child)} is a kind of {net.label(parent)}."))
        elif common:
            verb = "types of" if net.is_a(a, common) and net.is_a(b, common) else "part of"
            if net.get(common).category == "domain":
                verb = "areas of"
                text = f"Both fall under {net.label(common)}."
            else:
                text = f"Both are {verb} {net.label(common)}."
            lines.append(self._field("In common", text))
        path = net.path(a, b)
        if path:
            lines.append(self._field("How they connect", self.path_text(a, path)))
        return "\n".join(lines)

    def path_text(self, start: str, path) -> str:
        node, text = start, self.net.label(start)
        for edge in path:
            if edge.source == node:
                node = edge.target
                text += f" -[{edge.relation}]-> {self.net.label(node)}"
            else:
                node = edge.source
                text += f" <-[{edge.relation}]- {self.net.label(node)}"
        return text

    # ----------------------------------------------------------------- advice
    def urgent(self, result: InferenceResult) -> str:
        urgent = [t for t in result.tips if t.priority >= 100]
        return "\n".join(f"!! {t.title}" for t in urgent)

    def advice(self, result: InferenceResult) -> str:
        best = result.advice[0]
        lines = [heading(f"Guidance: {best.title}")]
        for n, step in enumerate(best.steps, 1):
            lines.append(wrap(f"{n}. {step}", indent="  ", hanging="     "))
        tips = [t for t in result.tips if t.priority < 100]
        if tips:
            lines.append("")
            lines.append("  Keep in mind:")
            for tip in tips:
                lines.append(wrap(f"- {tip.title}", indent="  ", hanging="    "))
        refs = list(dict.fromkeys(r for c in [best, *tips] for r in c.refs if r in self.net))
        if refs:
            lines.append("")
            lines.append(self._field("Relevant terms", self.labels(refs)))
        others = [c.title for c in result.advice[1:] if c.priority >= SPECIFIC_ADVICE]
        if others:
            lines.append(self._field("Also relevant", "; ".join(others)))
        lines.append("")
        lines.append(wrap(DISCLAIMER, indent=""))
        return "\n".join(lines)

    # ------------------------------------------------------------------ misc
    def topics(self) -> str:
        net = self.net
        groups: dict[str, list[str]] = {}
        for concept in net.concepts():
            if concept.category in ("domain", "root"):
                continue
            domains = net.domains(concept.id)
            if domains:
                groups.setdefault(domains[0], []).append(concept.label)
        lines = [heading(f"Topics I know ({len(net)} legal terms)")]
        for domain_id in sorted(groups, key=net.label):
            lines.append(self._field(net.label(domain_id), ", ".join(sorted(groups[domain_id]))))
        return "\n".join(lines)

"""Knowledge representation: a semantic net of legal terms.

Nodes are legal concepts; edges are typed, directed relations such as
``libel --is_a--> defamation`` or ``security_deposit --part_of--> lease``.
The net supports the classic semantic-net inferences:

* inheritance along ``is_a`` links (a Lease *is a* Contract, so it inherits
  the Contract's requirements: offer, acceptance, consideration, capacity);
* classification chains and area-of-law lookup;
* sub-type trees, nearest common ancestor, and the path linking two terms.
"""

from __future__ import annotations

import json
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path

RELATIONS: dict[str, str] = {
    "is_a": "is a type of",
    "part_of": "is part of",
    "party_to": "is a party to",
    "belongs_to": "falls under",
    "requires": "requires",
    "related_to": "is related to",
    "remedy_for": "is a remedy for",
    "exception_to": "is an exception to",
    "applies_to": "applies to",
}

# Relations that point "upwards" towards broader concepts / areas of law.
HIERARCHY = ("is_a", "part_of", "party_to", "belongs_to")


@dataclass(frozen=True)
class Concept:
    id: str
    label: str
    definition: str
    category: str = "concept"
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class Edge:
    source: str
    relation: str
    target: str

    @property
    def phrase(self) -> str:
        return RELATIONS[self.relation]


class SemanticNet:
    def __init__(self) -> None:
        self._nodes: dict[str, Concept] = {}
        self._out: dict[str, list[Edge]] = defaultdict(list)
        self._in: dict[str, list[Edge]] = defaultdict(list)

    # ---------------------------------------------------------------- building
    def add_concept(self, concept: Concept) -> None:
        if concept.id in self._nodes:
            raise ValueError(f"Duplicate concept id: {concept.id}")
        self._nodes[concept.id] = concept

    def add_relation(self, source: str, relation: str, target: str) -> None:
        if relation not in RELATIONS:
            raise ValueError(f"Unknown relation '{relation}' ({source} -> {target})")
        for node in (source, target):
            if node not in self._nodes:
                raise ValueError(f"Relation refers to unknown concept '{node}'")
        edge = Edge(source, relation, target)
        self._out[source].append(edge)
        self._in[target].append(edge)

    @classmethod
    def from_dict(cls, data: dict) -> "SemanticNet":
        net = cls()
        for item in data["concepts"]:
            net.add_concept(Concept(
                id=item["id"],
                label=item["label"],
                definition=item["definition"],
                category=item.get("category", "concept"),
                aliases=tuple(item.get("aliases", ())),
            ))
        for source, relation, target in data["relations"]:
            net.add_relation(source, relation, target)
        return net

    @classmethod
    def from_json(cls, path: str | Path) -> "SemanticNet":
        with open(path, encoding="utf-8") as fh:
            return cls.from_dict(json.load(fh))

    # ----------------------------------------------------------------- access
    def __contains__(self, concept_id: str) -> bool:
        return concept_id in self._nodes

    def __len__(self) -> int:
        return len(self._nodes)

    def get(self, concept_id: str) -> Concept:
        return self._nodes[concept_id]

    def label(self, concept_id: str) -> str:
        return self._nodes[concept_id].label

    def concepts(self) -> list[Concept]:
        return list(self._nodes.values())

    def edges(self) -> list[Edge]:
        return [e for edges in self._out.values() for e in edges]

    def outgoing(self, concept_id: str, *relations: str) -> list[Edge]:
        return [e for e in self._out.get(concept_id, ()) if not relations or e.relation in relations]

    def incoming(self, concept_id: str, *relations: str) -> list[Edge]:
        return [e for e in self._in.get(concept_id, ()) if not relations or e.relation in relations]

    def alias_map(self) -> dict[str, str]:
        """Every surface form (label + aliases) mapped to its concept id."""
        mapping: dict[str, str] = {}
        for c in self._nodes.values():
            for alias in (c.label, *c.aliases):
                mapping.setdefault(alias.lower(), c.id)
        return mapping

    # -------------------------------------------------------------- inference
    def ancestors(self, concept_id: str, relations: tuple[str, ...] = HIERARCHY) -> dict[str, int]:
        """Breadth-first ancestors -> distance, nearest first (self excluded)."""
        distances: dict[str, int] = {}
        seen = {concept_id}
        queue = deque([(concept_id, 0)])
        while queue:
            node, dist = queue.popleft()
            for edge in self.outgoing(node, *relations):
                if edge.target not in seen:
                    seen.add(edge.target)
                    distances[edge.target] = dist + 1
                    queue.append((edge.target, dist + 1))
        return distances

    def is_a(self, concept_id: str, ancestor_id: str) -> bool:
        """Taxonomic test with inheritance: is `concept_id` a kind of `ancestor_id`?"""
        return concept_id == ancestor_id or ancestor_id in self.ancestors(concept_id, ("is_a",))

    def domains(self, concept_id: str) -> list[str]:
        """Areas of law a concept falls under, nearest first."""
        if self._nodes[concept_id].category == "domain":
            return [concept_id]
        return [n for n in self.ancestors(concept_id) if self._nodes[n].category == "domain"]

    def chain(self, concept_id: str, max_steps: int = 6) -> list[Edge]:
        """Classification chain upwards, e.g. Libel -> Defamation -> Tort -> Tort Law."""
        steps: list[Edge] = []
        node, seen = concept_id, {concept_id}
        for _ in range(max_steps):
            if steps and self._nodes[node].category in ("domain", "root"):
                break
            edge = next((e for rel in HIERARCHY for e in self.outgoing(node, rel)
                         if e.target not in seen), None)
            if edge is None:
                break
            steps.append(edge)
            seen.add(edge.target)
            node = edge.target
        return steps

    def requirements(self, concept_id: str) -> list[tuple[str, str]]:
        """`requires` links, including those inherited through `is_a`.

        Returns (required_concept, concept_it_was_inherited_from).
        """
        result: list[tuple[str, str]] = []
        seen: set[str] = set()
        for source in (concept_id, *self.ancestors(concept_id, ("is_a",))):
            for edge in self.outgoing(source, "requires"):
                if edge.target not in seen:
                    seen.add(edge.target)
                    result.append((edge.target, source))
        return result

    def subtypes(self, concept_id: str, recursive: bool = True) -> list[tuple[int, str]]:
        """Sub-types as (depth, id) pairs in tree order."""
        out: list[tuple[int, str]] = []
        visited = {concept_id}

        def walk(node: str, depth: int) -> None:
            for edge in self.incoming(node, "is_a"):
                if edge.source in visited:
                    continue
                visited.add(edge.source)
                out.append((depth, edge.source))
                if recursive:
                    walk(edge.source, depth + 1)

        walk(concept_id, 0)
        return out

    def related(self, concept_id: str) -> list[str]:
        ids = [e.target for e in self.outgoing(concept_id, "related_to")]
        ids += [e.source for e in self.incoming(concept_id, "related_to")]
        return list(dict.fromkeys(ids))

    def common_ancestor(self, a: str, b: str) -> str | None:
        """Nearest shared ancestor (ignoring the root node)."""
        da = {a: 0, **self.ancestors(a)}
        db = {b: 0, **self.ancestors(b)}
        common = [n for n in da if n in db and self._nodes[n].category != "root"]
        if not common:
            return None
        return min(common, key=lambda n: da[n] + db[n])

    def path(self, a: str, b: str) -> list[Edge] | None:
        """Shortest undirected path of edges linking two concepts (avoids the root)."""
        previous: dict[str, Edge | None] = {a: None}
        queue = deque([a])
        while queue:
            node = queue.popleft()
            if node == b:
                break
            for edge in self._out.get(node, []) + self._in.get(node, []):
                nxt = edge.target if edge.source == node else edge.source
                if nxt in previous:
                    continue
                if nxt != b and self._nodes[nxt].category == "root":
                    continue
                previous[nxt] = edge
                queue.append(nxt)
        if b not in previous:
            return None
        edges: list[Edge] = []
        node = b
        while previous[node] is not None:
            edge = previous[node]
            edges.append(edge)
            node = edge.source if edge.target == node else edge.target
        return list(reversed(edges))

    # ------------------------------------------------------------------ export
    def to_dot(self) -> str:
        """Graphviz DOT export (render with: dot -Tpng semantic_net.dot -o net.png)."""
        shapes = {"root": "doubleoctagon", "domain": "box", "party": "ellipse",
                  "remedy": "hexagon", "element": "note"}
        lines = ["digraph SemanticNet {", "  rankdir=BT;", '  node [fontname="Helvetica"];']
        for c in self._nodes.values():
            shape = shapes.get(c.category, "oval")
            lines.append(f'  {c.id} [label="{c.label}", shape={shape}];')
        for e in self.edges():
            style = "solid" if e.relation in HIERARCHY else "dashed"
            lines.append(f'  {e.source} -> {e.target} [label="{e.relation}", style={style}];')
        lines.append("}")
        return "\n".join(lines)

"""Knowledge base: ties the semantic net, the term extractor and the rule engine together."""

from __future__ import annotations

from pathlib import Path

from .nlp import Analysis, EntityExtractor, normalize, stem
from .rule_engine import RuleEngine
from .semantic_net import SemanticNet

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def normalize_keyword(word: str) -> str:
    """Rule keywords go through the same pipeline as user text (synonyms + stemming)."""
    return " ".join(stem(t) for t in normalize(word).split())


class KnowledgeBase:
    def __init__(self, net: SemanticNet, engine: RuleEngine):
        self.net = net
        self.engine = engine
        self.extractor = EntityExtractor(net.alias_map())

    @classmethod
    def load(cls, data_dir: str | Path = DATA_DIR) -> "KnowledgeBase":
        data_dir = Path(data_dir)
        net = SemanticNet.from_json(data_dir / "semantic_net.json")
        engine = RuleEngine.from_json(data_dir / "rules.json", keyword_normalizer=normalize_keyword)
        return cls(net, engine)

    def facts_for(self, analysis: Analysis, concepts: list[str]) -> set[str]:
        """Turn a parsed question into working-memory facts for the rule engine.

        The semantic net contributes inherited facts: mentioning "libel" also
        asserts isa:defamation and isa:tort, plus domain:tort_law.
        """
        facts = {f"intent:{analysis.intent}"}
        if analysis.negated:
            facts.add("negation")
        if analysis.first_person:
            facts.add("first_person")
        facts.update(f"kw:{k}" for k in analysis.keywords)
        for cid in concepts:
            facts.add(f"concept:{cid}")
            facts.add(f"isa:{cid}")
            facts.update(f"isa:{a}" for a in self.net.ancestors(cid, ("is_a",)))
            facts.update(f"domain:{d}" for d in self.net.domains(cid))
        return facts

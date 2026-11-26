import unittest

from legal_bot.knowledge import normalize_keyword
from legal_bot.rule_engine import RuleEngine

RULES = {"rules": [
    {"id": "R1", "if": {"all": ["a"]}, "then": {"assert": ["b"]}},
    {"id": "R2", "if": {"all": ["b", ["x", "c"]]}, "then": {"assert": ["d"]}},
    {"id": "R3", "if": {"all": ["c"]}, "then": {"assert": ["e"]}},
    {"id": "NEG", "if": {"all": ["a"], "none": ["e"]}, "then": {"assert": ["no_e"]}},
    {"id": "ADV_LOW", "priority": 1, "if": {"all": ["d"]}, "then": {"advice": {"title": "low", "steps": []}}},
    {"id": "ADV_HIGH", "priority": 9, "if": {"all": ["d"]}, "then": {"advice": {"title": "high", "steps": []}}},
    {"id": "KW", "if": {"all": ["kw:evicted"]}, "then": {"assert": ["evict_kw"]}},
]}


class RuleEngineTests(unittest.TestCase):
    def setUp(self):
        self.engine = RuleEngine.from_dict(RULES, keyword_normalizer=normalize_keyword)

    def test_forward_chaining(self):
        result = self.engine.infer({"a", "x"})
        self.assertIn("d", result.facts)                       # a -> b, b & x -> d
        self.assertEqual([r.id for r in result.fired][:2], ["R1", "R2"])

    def test_conflict_resolution_by_priority(self):
        result = self.engine.infer({"a", "x"})
        self.assertEqual([c.title for c in result.advice], ["high", "low"])

    def test_negation_as_failure_is_stratified(self):
        # NEG is listed before R3 could fire, but must wait until positive rules finish.
        self.assertIn("no_e", self.engine.infer({"a"}).facts)
        self.assertNotIn("no_e", self.engine.infer({"a", "c"}).facts)

    def test_keywords_are_stemmed_on_load(self):
        self.assertIn("evict_kw", self.engine.infer({"kw:evict"}).facts)

    def test_duplicate_ids_rejected(self):
        with self.assertRaises(ValueError):
            RuleEngine.from_dict({"rules": [{"id": "A", "if": {}}, {"id": "A", "if": {}}]})


if __name__ == "__main__":
    unittest.main()

"""Guards against mistakes when editing the JSON knowledge files."""

import unittest

from legal_bot.knowledge import KnowledgeBase


class KnowledgeIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.kb = KnowledgeBase.load()

    def test_no_alias_collisions(self):
        self.assertEqual(self.kb.extractor.collisions, [])

    def test_no_alias_shared_by_two_concepts(self):
        # alias_map() keeps only the first owner of a duplicate alias, so check the raw data.
        owners = {}
        dupes = []
        for c in self.kb.net.concepts():
            for alias in {c.label.lower(), *(a.lower() for a in c.aliases)}:
                if alias in owners and owners[alias] != c.id:
                    dupes.append((alias, owners[alias], c.id))
                owners.setdefault(alias, c.id)
        self.assertEqual(dupes, [])

    def test_every_concept_reaches_an_area_of_law(self):
        orphans = [c.id for c in self.kb.net.concepts()
                   if c.category != "root" and not self.kb.net.domains(c.id)]
        self.assertEqual(orphans, [])

    def test_rule_references_exist(self):
        net = self.kb.net
        for rule in self.kb.engine.rules:
            for ref in rule.refs:
                self.assertIn(ref, net, f"{rule.id} refers to unknown concept '{ref}'")
            for group in rule.conditions:
                for fact in group:
                    kind, _, value = fact.partition(":")
                    if kind in ("concept", "isa", "domain"):
                        self.assertIn(value, net, f"{rule.id} uses unknown concept '{value}'")

    def test_every_situation_has_advice(self):
        asserted = {f for r in self.kb.engine.rules for f in r.asserts if f.startswith("situation:")}
        consumed = {f for r in self.kb.engine.rules if r.advice_title
                    for g in r.conditions for f in g if f.startswith("situation:")}
        self.assertEqual(asserted - consumed, set())


if __name__ == "__main__":
    unittest.main()

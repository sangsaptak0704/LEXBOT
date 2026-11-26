import unittest

from legal_bot.knowledge import KnowledgeBase
from legal_bot.semantic_net import Concept, SemanticNet


class SemanticNetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.net = KnowledgeBase.load().net

    def test_inheritance_along_is_a(self):
        self.assertTrue(self.net.is_a("libel", "tort"))
        self.assertTrue(self.net.is_a("lease", "contract"))
        self.assertFalse(self.net.is_a("lease", "tort"))

    def test_requirements_are_inherited(self):
        reqs = dict(self.net.requirements("lease"))
        self.assertEqual(set(reqs), {"offer", "acceptance", "consideration", "capacity"})
        self.assertTrue(all(src == "contract" for src in reqs.values()))

    def test_domains_with_multiple_inheritance(self):
        self.assertEqual(self.net.domains("lease"), ["property_law", "contract_law"])
        self.assertEqual(self.net.domains("slander"), ["tort_law"])

    def test_subtypes_tree(self):
        subtypes = self.net.subtypes("tort")
        self.assertIn((0, "defamation"), subtypes)
        self.assertIn((1, "libel"), subtypes)

    def test_common_ancestor_and_path(self):
        self.assertEqual(self.net.common_ancestor("libel", "slander"), "defamation")
        self.assertEqual(self.net.common_ancestor("defamation", "libel"), "defamation")
        path = self.net.path("libel", "slander")
        self.assertEqual([e.target for e in path], ["defamation", "defamation"])

    def test_chain(self):
        chain = [e.target for e in self.net.chain("libel")]
        self.assertEqual(chain, ["defamation", "tort", "tort_law"])

    def test_rejects_bad_relations(self):
        net = SemanticNet()
        net.add_concept(Concept("a", "A", "def"))
        with self.assertRaises(ValueError):
            net.add_relation("a", "is_a", "missing")
        with self.assertRaises(ValueError):
            net.add_relation("a", "likes", "a")

    def test_dot_export(self):
        dot = self.net.to_dot()
        self.assertTrue(dot.startswith("digraph"))
        self.assertIn('libel -> defamation [label="is_a"', dot)


if __name__ == "__main__":
    unittest.main()

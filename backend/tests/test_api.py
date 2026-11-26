import json
import unittest

from legal_bot import KnowledgeBase, LegalChatbot, api


class ApiViewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.kb = KnowledgeBase.load()

    def test_stats_match_knowledge_base(self):
        s = api.stats(self.kb)
        self.assertEqual(s["concepts"], len(self.kb.net))
        self.assertEqual(s["rules"], len(self.kb.engine.rules))
        self.assertEqual(sum(s["categories"].values()), s["concepts"])
        self.assertEqual(sum(s["rule_kinds"].values()), s["rules"])

    def test_every_concept_detail_is_json_serialisable(self):
        for c in api.concept_list(self.kb):
            json.dumps(api.concept_detail(self.kb, c["id"]))

    def test_concept_detail(self):
        d = api.concept_detail(self.kb, "libel")
        self.assertEqual(d["label"], "Libel")
        self.assertEqual([e["target"]["id"] for e in d["chain"]][:2], ["defamation", "tort"])
        self.assertIsNone(api.concept_detail(self.kb, "no_such_concept"))

    def test_rules_have_known_kinds(self):
        for r in api.rule_list(self.kb):
            self.assertIn(r["kind"], api.RULE_KINDS.values(), r["id"])

    def test_trace_for_advice_question(self):
        bot = LegalChatbot(self.kb)
        bot.respond("My landlord won't return my security deposit")
        t = api.trace(self.kb, bot.last_turn)
        self.assertEqual(t["intent"], "advice")
        self.assertIn("security_deposit", [c["id"] for c in t["concepts"]])
        self.assertIn("A_DEPOSIT", [r["id"] for r in t["fired"]])
        self.assertEqual(t["chosen_advice"], "Security deposit not returned")

    def test_trace_is_none_before_any_question(self):
        self.assertIsNone(api.trace(self.kb, LegalChatbot(self.kb).last_turn))


if __name__ == "__main__":
    unittest.main()

"""End-to-end conversation tests."""

import unittest

from legal_bot import KnowledgeBase, LegalChatbot

KB = KnowledgeBase.load()


class ChatbotTests(unittest.TestCase):
    def setUp(self):
        self.bot = LegalChatbot(KB)

    def ask(self, text):
        return self.bot.respond(text)

    def test_definition(self):
        reply = self.ask("What is a lease?")
        self.assertIn("Lease\n-----", reply)
        self.assertIn("inherited from Contract", reply)
        self.assertIn("Landlord, Tenant", reply)

    def test_types(self):
        reply = self.ask("What are the types of defamation?")
        self.assertIn("Libel", reply)
        self.assertIn("Slander", reply)

    def test_comparison(self):
        reply = self.ask("What's the difference between libel and slander?")
        self.assertIn("Both are types of Defamation", reply)

    def test_requirements(self):
        self.assertIn("Consideration", self.ask("What are the elements of a contract?"))

    def test_advice_situations(self):
        cases = {
            "My landlord won't return my security deposit": "Security deposit not returned",
            "I got fired without any notice": "Terminated from your job",
            "My boss hasn't paid my salary for two months": "Unpaid or underpaid wages",
            "Someone is spreading lies about me online, it's defamation": "false statements",
            "I was scammed on a shopping website": "Scam, fraud or hacking",
            "My bike was stolen, what should I do?": "Victim of a crime",
            "I was arrested last night, what are my rights?": "Arrested or accused",
            "I bought a faulty laptop and they refuse a refund": "Faulty product",
            "The supplier broke the contract and didn't deliver": "Breach of contract",
            "Someone copied my copyrighted photos": "Intellectual property infringement",
            "How do I get a divorce?": "Divorce",
            "My landlord is trying to evict me": "Facing eviction",
            "I received a legal notice, how should I respond?": "You received a legal notice",
        }
        for question, expected in cases.items():
            with self.subTest(question=question):
                self.assertIn(expected, LegalChatbot(KB).respond(question))

    def test_accused_suppresses_victim_advice(self):
        reply = self.ask("I have been accused of theft")
        self.assertIn("Arrested or accused of a crime", reply)
        self.assertNotIn("Victim of a crime", reply)

    def test_urgent_warning(self):
        reply = self.ask("My partner threatened to hurt me")
        self.assertIn("immediate danger", reply)

    def test_follow_up_uses_context(self):
        self.ask("What is negligence?")
        reply = self.ask("What does it require?")
        self.assertIn("Continuing with: Negligence", reply)
        self.assertIn("Duty of Care", reply)

    def test_follow_up_comparison(self):
        self.ask("What is libel?")
        self.assertIn("Libel vs Slander", self.ask("How is it different from slander?"))

    def test_spelling_correction(self):
        reply = self.ask("what is negligance")
        self.assertIn("I assumed you meant: Negligence", reply)

    def test_statute_words_are_not_spell_corrected(self):
        # "section" is 80% similar to "eviction"; it must not be guessed as that term.
        reply = self.ask("what is section 420 IPC")
        self.assertNotIn("Eviction", reply)

    def test_general_legal_questions(self):
        for question, expected in [
            ("what is a constitution", "Constitution"),
            ("what is civil law", "Civil Law"),
            ("what is IPC", "Bharatiya Nyaya Sanhita"),
            ("what is article 21", "Right to Life"),
            ("what is a judgment", "Verdict (Judgment)"),
        ]:
            with self.subTest(question=question):
                self.assertTrue(self.ask(question).startswith(expected))

    def test_indian_procedure_guidance(self):
        for question, title in [
            ("how to file an FIR", "Filing an FIR"),
            ("how do I file an RTI", "Filing an RTI application"),
            ("my cheque bounced what should I do", "Cheque bounce"),
            ("how to file a complaint in consumer court", "Filing a consumer complaint"),
        ]:
            with self.subTest(question=question):
                self.assertIn(f"Guidance: {title}", self.ask(question))

    def test_general_guidance_fallback(self):
        reply = self.ask("What is my notice period?")
        self.assertIn("Notice Period", reply)
        self.assertIn("General guidance: employment", reply)

    def test_why_explains_reasoning(self):
        self.assertIn("Ask me a question first", self.ask("why"))
        self.ask("My landlord won't return my deposit")
        reply = self.ask("why")
        self.assertIn("S_DEPOSIT", reply)
        self.assertIn("Conflict resolution chose", reply)

    def test_small_talk_and_unknown(self):
        self.assertIn("Hello", self.ask("hi"))
        self.assertIn("couldn't match", self.ask("purple elephants"))
        self.assertIn("Topics I know", self.ask("topics"))
        self.ask("bye")
        self.assertTrue(self.bot.finished)


if __name__ == "__main__":
    unittest.main()

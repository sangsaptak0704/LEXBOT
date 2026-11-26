import unittest

from legal_bot.nlp import analyze, normalize, stem


class StemmerTests(unittest.TestCase):
    def test_word_families_share_a_stem(self):
        families = [
            ("evict", "evicted", "eviction", "evicting"),
            ("lease", "leases", "leased"),
            ("terminate", "terminated", "termination"),
            ("harass", "harassed", "harassment", "harassing"),
            ("copy", "copied", "copies"),
            ("receive", "received"),
        ]
        for family in families:
            with self.subTest(family=family):
                self.assertEqual(len({stem(w) for w in family}), 1, [stem(w) for w in family])

    def test_short_words_untouched(self):
        self.assertEqual(stem("sue"), "sue")
        self.assertEqual(stem("is"), "is")


class NormalizeTests(unittest.TestCase):
    def test_punctuation_and_apostrophes(self):
        self.assertEqual(normalize("Won't   they PAY?!"), "wont they pay")

    def test_synonyms(self):
        self.assertEqual(normalize("My boss fired me"), "my employer terminated me")
        self.assertEqual(normalize("I was laid off"), "i was terminated")


class IntentTests(unittest.TestCase):
    def assertIntent(self, text, intent):
        self.assertEqual(analyze(text).intent, intent, text)

    def test_intents(self):
        self.assertIntent("What is negligence?", "definition")
        self.assertIntent("Define bail", "definition")
        self.assertIntent("Difference between libel and slander", "comparison")
        self.assertIntent("libel vs slander", "comparison")
        self.assertIntent("What are the types of tort?", "types")
        self.assertIntent("What are the elements of a contract?", "requirements")
        self.assertIntent("What should I do if I am evicted?", "advice")
        self.assertIntent("My landlord kept my deposit", "advice")      # first person
        self.assertIntent("What is my notice period?", "advice")        # definition + "my"
        self.assertIntent("hello", "greeting")
        self.assertIntent("thanks a lot", "thanks")
        self.assertIntent("bye", "farewell")
        self.assertIntent("help", "help")
        self.assertIntent("", "empty")

    def test_signals(self):
        a = analyze("My landlord didn't return it")
        self.assertTrue(a.negated)
        self.assertTrue(a.first_person)
        self.assertTrue(a.has_pronoun)
        self.assertNotIn("my", a.keywords)
        self.assertIn("return", a.keywords)


if __name__ == "__main__":
    unittest.main()

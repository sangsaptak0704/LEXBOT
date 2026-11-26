"""NLP basics for the legal chatbot.

The pipeline is intentionally dependency-free so every step is easy to follow:

    raw text -> normalise (lower-case, strip punctuation, map synonyms)
             -> tokenise -> stem -> detect intent / negation / pronouns
             -> match legal terms (longest-phrase matching on stems)
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Lexical resources
# ---------------------------------------------------------------------------

# Words that refer to parts of statutes rather than legal concepts. They must not be
# "spell-corrected" into a term (e.g. "section" is 80% similar to "eviction").
NO_FUZZY = frozenset({
    "section", "sections", "article", "articles", "clause", "clauses", "chapter",
    "schedule", "subsection", "rule", "rules", "code", "penal", "statute", "statutes",
})

STOPWORDS = frozenset(
    """
    a an the is are was were be been being am i me my mine we our us you your yours
    he him his she her it its they them their this that these those of to in on at by
    for with from about as into over under and or but if then so than too very can
    could would should will shall may might must do does did done doing have has had
    having what which who whom whose when where why how there here just also any some
    all im ive id youre whats whos please tell know want need like one
    """.split()
)

NEGATIONS = frozenset(
    """
    not no never none nothing nobody didnt doesnt dont wont cant cannot couldnt
    wouldnt shouldnt wasnt werent isnt arent havent hasnt hadnt refuse refuses
    refused refusing without
    """.split()
)

FIRST_PERSON = frozenset("i me my mine myself im ive id we our us".split())
PRONOUNS = frozenset("it its this that they them these those".split())

GREETINGS = frozenset("hi hello hey hiya howdy greetings yo namaste".split())
THANKS = frozenset("thanks thank thx cheers ty".split())
FAREWELLS = frozenset({"bye", "goodbye", "good bye", "quit", "exit", "see you", "cya", "q"})
HELP_PHRASES = frozenset({"help", "menu", "commands", "what can you do", "how do you work"})

# Informal wording mapped to the vocabulary used in the knowledge base.
# Applied on whole words/phrases *before* tokenisation.
SYNONYMS = {
    "fired": "terminated",
    "sacked": "terminated",
    "laid off": "terminated",
    "let go": "terminated",
    "dismissed": "terminated",
    "boss": "employer",
    "landlady": "landlord",
    "renter": "tenant",
    "lessee": "tenant",
    "lessor": "landlord",
    "thrown out": "evicted",
    "ripped off": "scammed",
    "neighbor": "neighbour",
    "neighbors": "neighbours",
    # "judgment" stems to the same key as "judge", so route it to its other name.
    "judgment": "verdict",
    "judgement": "verdict",
}

_APOSTROPHES = re.compile(r"['’`]")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_SYNONYM_PATTERNS = [
    (re.compile(rf"\b{re.escape(src)}\b"), dst)
    for src, dst in sorted(SYNONYMS.items(), key=lambda kv: -len(kv[0]))
]
_VOWELS = set("aeiouy")

# Ordered: the first matching pattern wins.
_INTENT_PATTERNS = [
    ("comparison", re.compile(
        r"\b(difference|differences|differ|differs|different|vs|versus|compare|compared|distinguish)\b")),
    ("types", re.compile(
        r"\b(types?|kinds?|forms?|categories|examples?|sorts?) of\b|\bwhat (types|kinds)\b")),
    ("requirements", re.compile(
        r"\b(elements?|requirements?|essentials?|ingredients|conditions) (of|for)\b"
        r"|\b(require|requires|required)\b|\bwhat makes\b")),
    ("advice", re.compile(
        r"\b(what should i|what can i|what do i do|how (do|can|should|would) i|can i|should i"
        r"|am i (allowed|entitled)|is it (legal|illegal|allowed|lawful|unlawful)|my rights"
        r"|what are my options|help me|i want to|i need to|do i have to|what happens if"
        r"|what to do|how to)\b")),
    ("definition", re.compile(
        r"\b(what is|whats|what are|what does .+ mean|define|definition|meaning|explain"
        r"|tell me about|who is|whos|describe)\b")),
]


# ---------------------------------------------------------------------------
# Core text processing
# ---------------------------------------------------------------------------

def normalize(text: str) -> str:
    """Lower-case, drop apostrophes, replace punctuation with spaces, apply synonyms."""
    text = _APOSTROPHES.sub("", text.lower())
    text = _NON_ALNUM.sub(" ", text)
    for pattern, replacement in _SYNONYM_PATTERNS:
        text = pattern.sub(replacement, text)
    return " ".join(text.split())


def tokenize(text: str) -> list[str]:
    return normalize(text).split()


def _has_vowel(s: str) -> bool:
    return any(ch in _VOWELS for ch in s)


def stem(word: str) -> str:
    """A small, deterministic suffix-stripping stemmer (Porter-inspired).

    It does not need to produce real words; it only needs to map variants
    of a word to the same key, e.g. evict / evicted / eviction -> "evict",
    lease / leases / leased -> "leas".
    """
    w = word
    if len(w) <= 3 or not w.isalpha():
        return w
    # 1. plurals
    if w.endswith("ies") and len(w) > 4:
        w = w[:-3] + "y"
    elif w.endswith("sses"):
        w = w[:-2]
    elif w.endswith("s") and not w.endswith(("ss", "us", "is")):
        w = w[:-1]
    # 2. derivational / inflectional suffixes
    if w.endswith("ied") and len(w) > 4:
        w = w[:-3] + "y"
    elif w.endswith("ment") and len(w) - 4 >= 4:
        w = w[:-4]
    elif w.endswith("ing") and len(w) - 3 >= 3 and _has_vowel(w[:-3]):
        w = w[:-3]
    elif w.endswith("ed") and len(w) - 2 >= 3 and _has_vowel(w[:-2]):
        w = w[:-2]
    elif w.endswith(("tion", "sion")) and len(w) - 3 >= 4:
        w = w[:-3]
    # 3. trailing silent e
    if w.endswith("e") and len(w) > 4:
        w = w[:-1]
    return w


def phrase_key(text: str) -> tuple[str, ...]:
    """Normalised, stemmed token tuple used to match phrases."""
    return tuple(stem(t) for t in tokenize(text))


# ---------------------------------------------------------------------------
# Query analysis
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Analysis:
    raw: str
    normalized: str
    tokens: tuple[str, ...]
    stems: tuple[str, ...]
    keywords: tuple[str, ...]   # stems of content words (stop-words removed)
    intent: str
    negated: bool
    first_person: bool
    has_pronoun: bool


def detect_intent(normalized: str, tokens: list[str] | tuple[str, ...]) -> str:
    """Rule-based intent classification using ordered regular-expression patterns."""
    if not tokens:
        return "empty"
    if normalized in FAREWELLS:
        return "farewell"
    if normalized in HELP_PHRASES:
        return "help"
    first_person = any(t in FIRST_PERSON for t in tokens)
    for name, pattern in _INTENT_PATTERNS:
        if pattern.search(normalized):
            # "What is my notice period?" is really a request about *my* situation.
            if name == "definition" and first_person:
                return "advice"
            return name
    if len(tokens) <= 4 and (tokens[0] in GREETINGS or normalized.startswith("good ")):
        return "greeting"
    if len(tokens) <= 5 and any(t in THANKS for t in tokens):
        return "thanks"
    return "advice" if first_person else "unknown"


def analyze(text: str) -> Analysis:
    normalized = normalize(text)
    tokens = tuple(normalized.split())
    stems = tuple(stem(t) for t in tokens)
    keywords = tuple(dict.fromkeys(
        stem(t) for t in tokens if t not in STOPWORDS and not t.isdigit()
    ))
    return Analysis(
        raw=text,
        normalized=normalized,
        tokens=tokens,
        stems=stems,
        keywords=keywords,
        intent=detect_intent(normalized, tokens),
        negated=any(t in NEGATIONS for t in tokens),
        first_person=any(t in FIRST_PERSON for t in tokens),
        has_pronoun=any(t in PRONOUNS for t in tokens),
    )


# ---------------------------------------------------------------------------
# Legal-term (entity) extraction
# ---------------------------------------------------------------------------

class EntityExtractor:
    """Finds legal terms in a query using greedy longest-phrase matching on stems.

    Because both the aliases and the user's text go through the same
    normalise -> stem pipeline, "evicted", "eviction" and "evict" all match.
    """

    def __init__(self, alias_map: dict[str, str]):
        self._index: dict[tuple[str, ...], str] = {}
        self._surface: dict[str, str] = {}          # normalised alias -> concept id
        self.collisions: list[tuple[str, str, str]] = []
        for alias, concept_id in alias_map.items():
            key = phrase_key(alias)
            if not key:
                continue
            existing = self._index.get(key)
            if existing and existing != concept_id:
                self.collisions.append((alias, existing, concept_id))
                continue
            self._index[key] = concept_id
            self._surface.setdefault(normalize(alias), concept_id)
        self._max_len = max((len(k) for k in self._index), default=1)
        self._single_words = [a for a in self._surface if " " not in a and len(a) >= 4]
        self._phrases = [a for a in self._surface if " " in a]

    def extract(self, analysis: Analysis) -> list[str]:
        """Return concept ids in the order they appear, without duplicates."""
        found: list[str] = []
        stems = analysis.stems
        i = 0
        while i < len(stems):
            for length in range(min(self._max_len, len(stems) - i), 0, -1):
                concept_id = self._index.get(tuple(stems[i:i + length]))
                if concept_id:
                    if concept_id not in found:
                        found.append(concept_id)
                    i += length
                    break
            else:
                i += 1
        return found

    def suggest(self, analysis: Analysis, cutoff: float = 0.8) -> list[tuple[str, str]]:
        """Fuzzy fallback for misspellings: returns [(concept_id, matched_alias)]."""
        results: list[tuple[str, str]] = []
        seen: set[str] = set()

        def add(alias: str) -> None:
            concept_id = self._surface[alias]
            if concept_id not in seen:
                seen.add(concept_id)
                results.append((concept_id, alias))

        tokens = analysis.tokens
        for n in (3, 2):
            for i in range(len(tokens) - n + 1):
                chunk = " ".join(tokens[i:i + n])
                for alias in difflib.get_close_matches(chunk, self._phrases, n=1, cutoff=0.85):
                    add(alias)
        for token in tokens:
            if len(token) >= 4 and token not in STOPWORDS and token not in NO_FUZZY:
                for alias in difflib.get_close_matches(token, self._single_words, n=1, cutoff=cutoff):
                    add(alias)
        return results

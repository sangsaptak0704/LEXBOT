# Architecture

```
 user text
    │
    ▼
┌──────────────┐  normalise → synonyms → tokenise → stem
│   NLP layer  │  intent (ordered regex rules), negation, first-person, pronouns
│   nlp.py     │  term extraction (longest-phrase match on stems, fuzzy fallback)
└──────┬───────┘
       │ Analysis + concept ids
       ▼
┌──────────────┐  concept:X, isa:<every is_a ancestor>, domain:<area of law>,
│ Knowledge    │  intent:Y, kw:<stem>, negation, first_person
│ knowledge.py │◄──── Semantic net (semantic_net.py + backend/data/semantic_net.json)
└──────┬───────┘
       │ working-memory facts
       ▼
┌──────────────┐  forward chaining to fixpoint, stratified negation,
│ Rule engine  │  conflict resolution (priority → specificity → order)
│ rule_engine  │◄──── Production rules (backend/data/rules.json)
└──────┬───────┘
       │ derived facts, advice, tips, trace
       ▼
┌──────────────┐  picks a strategy from the intent: define / list types /
│ Dialogue mgr │  requirements / compare / advise / clarify; keeps context;
│ chatbot.py   │  explains its reasoning ("why")
└──────┬───────┘
       ▼
  formatted answer (formatter.py)
```

## 1. NLP basics (`nlp.py`)

| Step | Technique | Example |
|---|---|---|
| Normalisation | lower-case, remove apostrophes/punctuation | `Won't they PAY?!` → `wont they pay` |
| Synonym mapping | phrase substitution to KB vocabulary | `my boss fired me` → `my employer terminated me` |
| Tokenisation | whitespace split | |
| Stemming | Porter-style suffix stripping | `evicted`, `eviction` → `evict` |
| Stop-word removal | for keyword facts only | |
| Intent detection | ordered regular-expression rules | `difference between` → *comparison* |
| Signals | negation words, first-person pronouns, anaphora (`it`, `this`) | |
| Term extraction | greedy longest match of stemmed n-grams against all aliases | `breach of contract` beats `contract` |
| Spelling fallback | `difflib` similarity on aliases | `negligance` → Negligence |

Intents: `definition`, `types`, `requirements`, `comparison`, `advice`, plus small talk
(`greeting`, `thanks`, `farewell`, `help`). An unclear sentence that describes events and
triggers a situation is refined to `advice`.

## 2. Knowledge representation: the semantic net (`semantic_net.py`)

Nodes are legal concepts with a label, definition, category and aliases. Edges are typed:

| Relation | Meaning | Example |
|---|---|---|
| `is_a` | taxonomy (inheritable) | Libel → Defamation → Tort |
| `belongs_to` | area of law | Tort → Tort Law |
| `part_of` | component | Security Deposit → Lease |
| `party_to` | participant | Landlord → Lease |
| `requires` | essential element | Contract → Offer, Acceptance, Consideration, Capacity |
| `remedy_for` | legal remedy | Damages → Breach of Contract |
| `exception_to` | exception | Fair Use → Copyright |
| `related_to`, `applies_to` | association | Bail ↔ Arrest |

Inferences supported:

- **Inheritance**: a Lease *is a* Contract, so it inherits the Contract's `requires` links.
  "What is a lease?" shows *Requires: Offer (inherited from Contract), ...*
- **Classification chain** and **area-of-law lookup**, including multiple inheritance
  (Lease → Property & Tenancy Law *and* Contract Law).
- **Sub-type trees** for "types of" questions.
- **Nearest common ancestor** and **shortest connecting path** for comparisons.
- **Graphviz export** (`--export-graph`) for visualising the net.

## 3. Rule-based reasoning (`rule_engine.py`, `backend/data/rules.json`)

A forward-chaining production system. Working memory is a set of facts produced from the
question *and the semantic net*:

```
"My landlord won't return my security deposit"
→ intent:advice, negation, first_person, kw:landlord, kw:return, kw:deposit, ...
  concept:landlord, concept:security_deposit,
  domain:property_law, domain:contract_law          ← inferred from the net
```

Rules are organised in layers that chain into each other:

| Layer | Prefix | Role | Example |
|---|---|---|---|
| Situation | `S_` | recognise the user's situation | `concept:security_deposit ⇒ situation:deposit_dispute, claim:civil` |
| Derived | `D_` | general legal consequences | `claim:civil ⇒ reminder:time_limit` |
| Advice | `A_` | specific guidance | `intent:advice ∧ situation:deposit_dispute ⇒ advice` |
| General | `G_` | fallback guidance per area of law (priority 1) | `intent:advice ∧ domain:employment_law ⇒ advice` |
| Tips | `T_` | cross-cutting reminders and safety warnings | `urgency:high ⇒ "call emergency services"` |

Key features:

- **Inheritance-aware rules**: `S_DEFAMATION` tests `isa:defamation`, so it covers libel and
  slander automatically. `S_BREACH_INFERRED` tests `isa:contract`, so it covers leases,
  NDAs and employment contracts.
- **Negation as failure, stratified**: `S_CRIME_VICTIM` fires only if `situation:criminal_accused`
  could *not* be derived. Negated rules run only after every positive rule has reached a
  fixpoint, so the result does not depend on rule order.
- **Conflict resolution**: several advice rules may fire. They are ranked by priority, then
  specificity (number of conditions), then firing order. The best is shown; other
  specific ones are listed as "Also relevant".
- **Explainability**: every fired rule is recorded, and the `why` command prints the full
  trace.

## 4. Dialogue management (`chatbot.py`)

- Chooses the response strategy from the intent and the recognised concepts.
- Keeps the previous turn's concepts as **context** for follow-ups
  (`What is libel?` → `How is it different from slander?`).
- When advice is requested but only generic guidance applies, it shows the definition of
  the term plus the general guidance.
- Shows urgent safety warnings first, whatever the question type.

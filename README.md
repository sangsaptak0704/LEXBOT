# Smart Legal Advice Chatbot (LexBot)

An interactive text chatbot that answers common legal questions by **reasoning**
over a knowledge base, instead of relying on a black-box model.

| | |
|---|---|
| **Objective** | Answer common legal FAQs: definitions, comparisons, and step-by-step guidance for everyday legal situations |
| **Technologies** | NLP basics · Knowledge Representation (Semantic Net) · Rule-Based Reasoning (forward chaining) |
| **Deliverable** | Interactive command-line bot giving automated legal guidance, with an explainable reasoning trace |
| **Dependencies** | None. Python 3.10+ standard library only (optional Gemini AI answers need just an API key) |

> LexBot provides general legal information, not legal advice. Laws vary by jurisdiction.

---

## Quick start

The project is split into a **backend** (Python reasoning engine + JSON API) and a
**frontend** (static web chat UI).

### Web app (frontend + backend)

```bash
cd smart-legal-chatbot/backend
python3 server.py                 # then open http://localhost:8000
python3 server.py --port 9000     # use a different port
```

The backend serves the frontend too, so one command runs both.

### Deploy on Vercel

1. Import the GitHub repo in Vercel with **Root Directory** `./` and **Application Preset** *Other*.
   `vercel.json` routes every request to `api/index.py`, which runs the same backend.
2. Accounts need a shared database, because Vercel runs several short-lived copies of the
   app. Create a free [Turso](https://turso.tech) database and add these environment
   variables in Vercel (the Turso integration in the Vercel Marketplace adds them for you):
   - `TURSO_DATABASE_URL` - e.g. `libsql://lexbot-yourname.turso.io`
   - `TURSO_AUTH_TOKEN` - a database token
3. Optional: `GEMINI_API_KEY` for AI answers. Redeploy after changing variables.

Without Turso, sign-in on Vercel fails or logs out at random. Locally nothing changes: with
no `TURSO_DATABASE_URL`, accounts stay in `backend/instance/lexbot.db`.

### Accounts

Open the app and choose **Sign up** to create an account (name, email, password of at least
8 characters), or **Sign in** if you already have one. You stay signed in for 7 days. To sign out,
click your name at the bottom of the sidebar and choose **Log out**; that menu also has
Activity, Projects, Help and the server status.

- Accounts are stored in `backend/instance/lexbot.db` (SQLite, created automatically; set
  `LEXBOT_DB` to use another path). Passwords are hashed with scrypt, never stored as text.
- The sign-in is an `HttpOnly`, `SameSite=Lax` cookie; only a hash of its token is stored.
- After 10 failed sign-ins from one address, sign-in is paused for 15 minutes.
- Chat, explain, concepts, rules and stats endpoints require sign-in; each user can only
  continue their own conversations. Saved chats, projects and activity are kept per user.
- The app runs over plain HTTP locally. If you deploy it, put it behind HTTPS and add
  `Secure` to the cookie in `server.py`.

### API keys (connect your own programs)

Open the account menu (your name, bottom of the sidebar) → **API keys**. Create a key, copy it
(it is shown only once), and send it from any program:

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Authorization: Bearer lxb_your_key" -H "Content-Type: application/json" \
  -d '{"message": "What is a tort?"}'
```

A key acts as you (same chats, same limits). Up to 10 keys per user; revoke any key on the
same page and it stops working immediately. Keys can't be used to create more keys. Only a
hash of each key is stored.

### Gemini AI answers with your Firebase / Google key (optional)

With a Google API key, LexBot uses Google Gemini (`gemini-3.8-flash`) to write fuller answers.
The rule engine still runs first and the reasoning panel shows the rules that fired:

- **Topics in the knowledge base**: Gemini builds its reply on the rule-based answer, keeping
  its facts and every guidance step, and may add detail (e.g. a specific IPC/BNS section).
  These carry an "AI-written" badge and a **Show rule-based answer** switch.
- **Topics outside it** (e.g. "what is the POCSO Act 2012"): Gemini answers from general legal
  knowledge, assuming Indian law unless another country is named. These carry a separate
  "AI answer · general legal knowledge" badge so users know the knowledge base didn't cover it.

Answers are formatted with headings, bold terms and lists. Each user can turn AI answers off
with the **AI answers** switch at the top of a chat. No extra Python packages are needed:
Gemini is called with the standard library.

1. In the [Firebase console](https://console.firebase.google.com), open your project →
   **AI Logic** → **Get started** and choose the **Gemini Developer API**. This enables Gemini
   for the project. (Alternatively, create a key at aistudio.google.com.)
2. Copy the project's **Web API key** (Project settings → General). If the key has API
   restrictions in Google Cloud console → Credentials, allow the Generative Language API.
3. `cp backend/.env.example backend/.env` and set `GEMINI_API_KEY=AIza...` in it
   (`backend/.env` is git-ignored; `FIREBASE_API_KEY` is accepted as the variable name too).
4. Restart `python3 server.py`. It prints `AI answers: on (gemini-3.8-flash)`.

The key is used only by the server and never sent to browsers. If the key is missing or
rejected, Gemini isn't enabled for the project, the daily limit (`LEXBOT_AI_DAILY_LIMIT`,
default 200 per user) is reached, or Gemini declines or can't be reached, LexBot simply
answers rule-based and shows a short note saying why. Gemini usage beyond Google's free tier
is billed to the Firebase/Google Cloud project. Change the model with `LEXBOT_AI_MODEL`.
When a model is overloaded or out of quota, LexBot tries the backup models in
`LEXBOT_AI_FALLBACK_MODELS` (each Gemini model has its own free-tier daily quota).

Sidebar (collapse it to icons with the button next to the logo):

- **New chat**: start a fresh conversation. Every chat is saved in your browser and listed under *Recent chats*.
- **Search** (`Ctrl+K`): search your chats, projects and the legal terms LexBot knows
- **Projects**: group related chats (e.g. "Tenancy dispute"); move a chat with the folder menu at the top of the chat
- **Chat**: talk to LexBot, with a live panel showing each reasoning step and the rules that fired.
  Under each answer: **Listen** (read aloud), **Copy**, **Verify on India Code** (AI answers),
  **Draft the document** (when the guidance has a matching template) and three **Ask next**
  follow-up questions. The top bar has the **answer language** (English, Hindi, Bengali, Tamil,
  Telugu, Marathi; used for AI answers and voice input) and **Export** (save the chat as a PDF).
  The 🎤 button asks by voice (Chrome/Edge). A red **emergency banner** (112 / 181 / 1098) appears
  when a message suggests someone is in danger. The welcome screen shows a **Law of the day**.
- **Legal tools**:
  - *Document drafter*: legal notice, cheque-bounce notice (s.138 NI Act), RTI application,
    consumer complaint and FIR complaint; fill a form, see the document update live, then copy,
    download or print to PDF. Drafts are saved in the browser.
  - *Rights wizard*: pick an area and a situation to get step-by-step guidance.
  - *Deadline calculator*: limitation periods for cheque bounce, RTI, consumer complaints, money
    recovery and e-FIRs, on a timeline with days left.
  - *Compare terms* and *Helplines* (112, 181, 1098, 1930, 15100, 1915, 14567, official portals).
- **Rights quiz**: five multiple-choice questions generated from the knowledge base, with a score.
- **Insights**: your questions per day, top topics, how they were answered, knowledge-base size,
  and an **accuracy self-test** that runs 40 labelled questions (`backend/data/selftest.json`)
  through the reasoning engine.
- **Activity**: history of the questions you asked and terms you viewed, with "Ask again"
- **Dark mode**: from the account menu (your name at the bottom of the sidebar).

Legal terms in answers link to a Knowledge Graph page that shows each term's classification and
an interactive graph of its relations.

Chats, projects and activity are stored in the browser's localStorage (separately for each
user), not on the server. The frontend must be served by the backend (same origin), because
sign-in uses a cookie.

### Command line (backend only)

```bash
cd smart-legal-chatbot/backend
python3 main.py                                  # interactive chat
python3 main.py --trace                          # chat + show reasoning after every answer
python3 main.py -q "What is a tort?"             # single question
python3 main.py --export-graph semantic_net.dot  # export the semantic net (Graphviz)
python3 -m unittest discover -s tests -t .       # run the test suite
```

### API

| Method & path | Body | Returns |
|---|---|---|
| `POST /api/chat` | `{"message": "...", "session_id": "..."}` (`session_id` optional; `"lang": "hi"` etc. for AI answers in another language) | `{"session_id", "reply", "finished", "trace", "suggestions", "urgent", "ai", "rule_reply"?, "ai_source"?, "ai_error"?}`; send `"ai": false` for the rule-based answer only |
| `POST /api/explain` | `{"session_id": "..."}` | `{"session_id", "reply"}` (the reasoning trace) |
| `GET /api/greeting` | none | `{"reply"}` |
| `POST /api/auth/signup` | `{"name", "email", "password"}` | `{"user"}` and sets the sign-in cookie |
| `POST /api/auth/login` | `{"email", "password"}` | `{"user"}` and sets the sign-in cookie |
| `POST /api/auth/logout` | none | `{"ok": true}` and clears the cookie |
| `GET /api/auth/me` | none | `{"user"}`, or 401 when signed out |
| `GET /api/config` | none | `{"ai_available", "ai_model", "ai_reason"}` |
| `GET /api/keys` | none | your API keys (name, prefix, created, last used) |
| `POST /api/keys` | `{"name"}` | `{"key", "record"}` (the full key, shown once) |
| `DELETE /api/keys/<id>` | none | `{"ok": true}` (revokes the key) |
| `GET /api/concepts` | none | all semantic-net concepts |
| `GET /api/concepts/<id>` | none | one concept: definition, classification, relations, rules |
| `GET /api/rules` | none | all production rules |
| `GET /api/quiz` | none | 5 multiple-choice questions |
| `GET /api/law-of-the-day` | none | one legal term, different each day |
| `GET /api/selftest` | none | accuracy of the engine on `data/selftest.json` |
| `GET /api/stats` | none | knowledge-base counts |
| `GET /api/health` | none | `{"status": "ok"}` |

Each `session_id` keeps its own conversation context (follow-ups, `why`). Sessions expire
after an hour of inactivity.

To render the semantic net as an image (requires Graphviz):
`dot -Tpng semantic_net.dot -o semantic_net.png`

## What you can ask

| Kind of question | Example |
|---|---|
| Definition | `What is negligence?` · `Explain a power of attorney` |
| Types (sub-concepts) | `What are the types of tort?` |
| Requirements / elements | `What are the elements of a contract?` |
| Comparison | `Difference between libel and slander` |
| Situation advice | `My landlord won't return my security deposit` · `I was fired without notice` |
| Follow-ups (context) | `What is negligence?` → `What does it require?` |
| Typos | `what is negligance` → *I assumed you meant: Negligence* |
| Commands | `topics`, `why` (explain last answer), `reset`, `help`, `quit` |

## Sample session

```
You: My landlord won't return my security deposit

LexBot:
  Guidance: Security deposit not returned
  ---------------------------------------
    1. Check your lease for the deposit terms; many places require landlords to
       return the deposit, or itemise deductions, within a fixed number of days...
    ...
    Keep in mind:
    - Act promptly: most claims must be started within a limitation period...
    Relevant terms: Security Deposit, Lease, Legal Notice, Small Claims Court

You: why

LexBot:
  How I reached my last answer
  ----------------------------
    1. NLP: intent = advice; signals: negation, first-person; keywords = landlord, wont, return, ...
    2. Legal terms recognised by phrase matching: Landlord, Security Deposit
    3. Inherited from the semantic net: domain:contract_law, domain:property_law
    4. Rules fired (forward chaining, in order):
       - S_DEPOSIT: IF concept:security_deposit THEN assert situation:deposit_dispute, claim:civil
       - D_TIME_LIMIT: IF claim:civil THEN assert reminder:time_limit
       - A_DEPOSIT: IF intent:advice AND situation:deposit_dispute THEN advice (priority 10)
       ...
    5. Conflict resolution chose: 'Security deposit not returned'
```

## Project structure

```
smart-legal-chatbot/
├── backend/
│   ├── main.py                 # CLI entry point
│   ├── server.py               # HTTP JSON API (stdlib), also serves the frontend
│   ├── auth.py                 # accounts, sessions, personal API keys, sign-in rate limit
│   ├── ai.py                   # optional Google Gemini rewrite of answers (standard-library HTTPS)
│   ├── .env.example            # template for backend/.env (GEMINI_API_KEY, AI settings)
│   ├── requirements.txt
│   ├── legal_bot/
│   │   ├── nlp.py              # normalisation, synonyms, stemmer, intent detection, term extraction
│   │   ├── semantic_net.py     # semantic net: concepts, typed relations, inheritance queries
│   │   ├── rule_engine.py      # forward-chaining production system with stratified negation
│   │   ├── knowledge.py        # loads the knowledge files; converts a question into facts
│   │   ├── formatter.py        # renders definitions, comparisons, advice
│   │   ├── chatbot.py          # dialogue manager: context, follow-ups, response strategy, "why"
│   │   ├── cli.py              # interactive terminal interface
│   │   └── api.py              # JSON views of concepts, rules and reasoning traces
│   ├── data/
│   │   ├── semantic_net.json   # 130 legal concepts, 196 relations, 12 areas of law
│   │   └── rules.json          # ~77 production rules (situations, reminders, advice, tips)
│   └── tests/                  # unit + end-to-end tests (61 tests)
├── requirements.txt            # Python dependencies (pip install -r requirements.txt)
├── frontend/                   # HTML + JavaScript, no build step
│   ├── index.html              # page layout: collapsible sidebar + views
│   ├── style.css
│   ├── config.js               # API base URL (empty = same server)
│   ├── assets/                 # logo.png (original), logo-mark.png (sidebar), favicon.png
│   └── js/
│       ├── common.js           # API calls, safe DOM helpers, tooltip, colours
│       ├── store.js            # saved chats and projects (localStorage)
│       ├── sidebar.js          # New chat button, recent chats, Ctrl+K
│       ├── auth.js             # Sign in / Sign up screens, account menu, Log out
│       ├── apikeys.js          # API keys page (create / copy / revoke) + Gemini status
│       ├── chat.js             # Chat view: saved conversations + live reasoning panel
│       ├── search.js           # Search view (chats, projects, legal terms)
│       ├── projects.js         # Projects view (create, rename, delete, group chats)
│       ├── explorer.js         # Knowledge Graph view (concept list, SVG graph, details)
│       ├── activity.js         # Activity view (local history of questions and viewed terms)
│       └── app.js              # hash router (#chat/<id>, #search, #projects/<id>, #explore/<id>, #activity) + sidebar toggle
└── docs/architecture.md        # design and reasoning pipeline in detail
```

## Extending the knowledge base

No code changes are needed, only JSON edits:

- **New legal term**: add a concept to `backend/data/semantic_net.json` (id, label, definition,
  aliases) and connect it with relations such as `["new_term", "is_a", "tort"]`.
- **New situation**: add a situation rule (`S_...`) that asserts `situation:xyz`, and an
  advice rule (`A_...`) conditioned on `intent:advice` and `situation:xyz`.

The integrity tests (`backend/tests/test_knowledge_integrity.py`) catch alias collisions, dangling
references, concepts with no area of law, and situations with no advice.

See [docs/architecture.md](docs/architecture.md) for the full design.

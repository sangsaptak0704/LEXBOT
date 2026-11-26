"""End-to-end HTTP tests: a real server on a free port with a throwaway user database."""

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

_TMP = tempfile.TemporaryDirectory()
os.environ["LEXBOT_DB"] = os.path.join(_TMP.name, "test.db")
os.environ["LEXBOT_AI"] = "off"   # never call the real Gemini API from tests

import server  # noqa: E402  (must be imported after LEXBOT_DB is set)


class Client:
    """Minimal HTTP client that keeps cookies, like a browser."""

    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))

    def call(self, method, path, body=None, key=None):
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"}
        if key:
            headers["Authorization"] = f"Bearer {key}"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with self.opener.open(req) as res:
                return res.status, json.loads(res.read() or b"{}"), res.headers
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read() or b"{}"), err.headers


class ServerTestCase(unittest.TestCase):
    """Starts a real server on a free port for the test class."""

    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()


class ServerAuthTests(ServerTestCase):

    def test_protected_endpoints_need_sign_in(self):
        c = Client(self.base)
        self.assertEqual(c.call("GET", "/api/health")[0], 200)
        self.assertEqual(c.call("GET", "/api/greeting")[0], 200)
        self.assertEqual(c.call("GET", "/api/auth/me")[0], 401)
        self.assertEqual(c.call("GET", "/api/concepts")[0], 401)
        self.assertEqual(c.call("POST", "/api/chat", {"message": "What is a tort?"})[0], 401)

    def test_signup_chat_logout_login(self):
        c = Client(self.base)
        status, body, headers = c.call("POST", "/api/auth/signup",
                                       {"name": "Ravi", "email": "ravi@example.com", "password": "password123"})
        self.assertEqual(status, 200)
        self.assertEqual(body["user"]["name"], "Ravi")
        cookie = headers.get("Set-Cookie")
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Lax", cookie)

        self.assertEqual(c.call("GET", "/api/auth/me")[1]["user"]["email"], "ravi@example.com")
        status, body, _ = c.call("POST", "/api/chat", {"message": "What is a tort?"})
        self.assertEqual(status, 200)
        self.assertIn("Tort", body["reply"])

        self.assertEqual(c.call("POST", "/api/auth/logout")[0], 200)
        self.assertEqual(c.call("GET", "/api/auth/me")[0], 401)
        self.assertEqual(c.call("POST", "/api/chat", {"message": "hi"})[0], 401)

        status, body, _ = c.call("POST", "/api/auth/login", {"email": "RAVI@example.com", "password": "password123"})
        self.assertEqual(status, 200)
        self.assertEqual(c.call("GET", "/api/auth/me")[0], 200)

    def test_wrong_password_and_duplicate_signup(self):
        c = Client(self.base)
        c.call("POST", "/api/auth/signup", {"name": "Mei", "email": "mei@example.com", "password": "password123"})
        status, body, _ = Client(self.base).call("POST", "/api/auth/login",
                                                 {"email": "mei@example.com", "password": "nope-nope"})
        self.assertEqual(status, 401)
        self.assertEqual(body["error"], "Incorrect email or password.")
        status, _, _ = Client(self.base).call("POST", "/api/auth/signup",
                                              {"name": "Mei 2", "email": "mei@example.com", "password": "password456"})
        self.assertEqual(status, 409)

    def test_users_cannot_use_each_others_chat_sessions(self):
        a, b = Client(self.base), Client(self.base)
        a.call("POST", "/api/auth/signup", {"name": "A", "email": "a@example.com", "password": "password123"})
        b.call("POST", "/api/auth/signup", {"name": "B", "email": "b@example.com", "password": "password123"})
        sid = a.call("POST", "/api/chat", {"message": "What is negligence?"})[1]["session_id"]
        status, body, _ = b.call("POST", "/api/chat", {"message": "What does it require?", "session_id": sid})
        self.assertEqual(status, 200)
        self.assertNotEqual(body["session_id"], sid)          # B got a fresh session
        self.assertNotIn("Negligence", body["reply"])          # and no access to A's context


def gemini_response(text, finish="STOP"):
    """A Gemini generateContent response body."""
    return {"candidates": [{"content": {"role": "model", "parts": [{"text": text}]},
                            "finishReason": finish}]}


class FakeGemini:
    """Replaces AIWriter._post: records each request instead of calling Google."""

    def __init__(self, response):
        self.response, self.calls = response, []

    def __call__(self, url, body):
        self.calls.append((url, body))
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def enable_fake_ai(writer, fake):
    """Turn AI on for a test without a real key; returns a function that restores it."""
    saved = (writer.reason, writer._post)
    writer.reason, writer._post = "", fake
    return lambda: (setattr(writer, "reason", saved[0]), setattr(writer, "_post", saved[1]))


class ApiKeyAndAITests(ServerTestCase):
    def _signed_up(self, email):
        c = Client(self.base)
        c.call("POST", "/api/auth/signup", {"name": "Key User", "email": email, "password": "password123"})
        return c

    def test_api_key_lifecycle(self):
        c = self._signed_up("keys@example.com")
        status, body, _ = c.call("POST", "/api/keys", {"name": "My script"})
        self.assertEqual(status, 201)
        key = body["key"]
        self.assertTrue(key.startswith("lxb_"))
        listed = c.call("GET", "/api/keys")[1]["keys"]
        self.assertEqual(len(listed), 1)
        self.assertNotIn("key", listed[0])                       # full key never listed again

        robot = Client(self.base)                                 # no cookie, key only
        status, body, _ = robot.call("POST", "/api/chat", {"message": "What is a tort?"}, key=key)
        self.assertEqual(status, 200)
        self.assertIn("Tort", body["reply"])
        self.assertEqual(robot.call("GET", "/api/auth/me", key=key)[1]["user"]["email"], "keys@example.com")
        self.assertIsNotNone(c.call("GET", "/api/keys")[1]["keys"][0]["last_used"])

        # a key can't manage keys, a wrong key is rejected, a revoked key stops working
        self.assertEqual(robot.call("POST", "/api/keys", {"name": "x"}, key=key)[0], 403)
        status, body, _ = robot.call("GET", "/api/concepts", key="lxb_wrong")
        self.assertEqual((status, body["error"]), (401, "Invalid API key."))
        self.assertEqual(c.call("DELETE", f"/api/keys/{listed[0]['id']}")[0], 200)
        self.assertEqual(robot.call("GET", "/api/concepts", key=key)[0], 401)

    def test_users_cannot_revoke_each_others_keys(self):
        a, b = self._signed_up("ka@example.com"), self._signed_up("kb@example.com")
        key_id = a.call("POST", "/api/keys", {"name": "A's key"})[1]["record"]["id"]
        self.assertEqual(b.call("DELETE", f"/api/keys/{key_id}")[0], 404)
        self.assertEqual(len(a.call("GET", "/api/keys")[1]["keys"]), 1)

    def test_ai_rewrite_used_when_available(self):
        fake = FakeGemini(gemini_response("A tort is a civil wrong. This is general information."))
        restore = enable_fake_ai(server.AI, fake)
        try:
            c = self._signed_up("ai@example.com")
            config = c.call("GET", "/api/config")[1]
            self.assertTrue(config["ai_available"])
            self.assertEqual(config["ai_provider"], "Google Gemini")
            body = c.call("POST", "/api/chat", {"message": "What is a tort?"})[1]
            self.assertTrue(body["ai"])
            self.assertEqual(body["reply"], "A tort is a civil wrong. This is general information.")
            self.assertIn("Tort", body["rule_reply"])
            url, req = fake.calls[-1]
            self.assertTrue(url.endswith(f"/models/{server.AI.model}:generateContent"))
            self.assertIn("LexBot", req["systemInstruction"]["parts"][0]["text"])
            self.assertIn("<knowledge_base_answer>", req["contents"][0]["parts"][0]["text"])
            self.assertEqual(body["ai_source"], "knowledge_base")

            # topics outside the knowledge base are answered from general knowledge, and say so
            body = c.call("POST", "/api/chat", {"message": "What is the POCSO Act 2012?"})[1]
            self.assertTrue(body["ai"])
            self.assertEqual(body["ai_source"], "general")
            self.assertIn("couldn't match", body["rule_reply"])
            self.assertIn("does not cover this question", fake.calls[-1][1]["contents"][0]["parts"][0]["text"])

            # turned off per request, and not used for commands like "why"
            n = len(fake.calls)
            self.assertFalse(c.call("POST", "/api/chat", {"message": "What is a lease?", "ai": False})[1]["ai"])
            self.assertFalse(c.call("POST", "/api/chat", {"message": "why"})[1]["ai"])
            self.assertEqual(len(fake.calls), n)

            # a safety block falls back to the rule-based answer
            fake.response = gemini_response("", finish="SAFETY")
            body = c.call("POST", "/api/chat", {"message": "What is negligence?"})[1]
            self.assertFalse(body["ai"])
            self.assertIn("Negligence", body["reply"])
            self.assertIn("declined", body["ai_error"])
        finally:
            restore()

    def test_ai_failures_fall_back(self):
        from ai import AIError, AIWriter
        writer = AIWriter()
        cases = [
            ({"promptFeedback": {"blockReason": "SAFETY"}}, "declined"),
            (gemini_response("partial", finish="MAX_TOKENS"), "cut off"),
            ({"candidates": [{"content": {"parts": [{"text": "thinking...", "thought": True}]},
                              "finishReason": "STOP"}]}, "empty"),
            (AIError("The Gemini API key was rejected"), "key was rejected"),
        ]
        for response, expected in cases:
            restore = enable_fake_ai(writer, FakeGemini(response))
            reply, error = writer.enhance(1, "q", "answer", None)
            restore()
            self.assertIsNone(reply)
            self.assertIn(expected, error)

    def test_ai_busy_model_falls_back_to_another(self):
        import ai
        writer = ai.AIWriter()
        writer.fallback_models = ["backup-model"]
        busy = ai.AIError("The AI service is overloaded right now", retry=True)
        replies = iter([busy, gemini_response("from backup")])

        def fake(url, body):
            fake.urls.append(url)
            r = next(replies)
            if isinstance(r, Exception):
                raise r
            return r
        fake.urls = []
        saved_delay, ai.RETRY_DELAY = ai.RETRY_DELAY, 0
        restore = enable_fake_ai(writer, fake)
        try:
            reply, error = writer.enhance(1, "q", "answer", None)
        finally:
            restore()
            ai.RETRY_DELAY = saved_delay
        self.assertEqual((reply, error), ("from backup", None))
        self.assertEqual(len(fake.urls), 2)                 # busy main model, then the backup
        self.assertIn("backup-model", fake.urls[1])

    def test_ai_gives_up_when_every_model_is_busy(self):
        import ai
        writer = ai.AIWriter()
        writer.fallback_models = ["backup-model"]
        saved_delay, ai.RETRY_DELAY = ai.RETRY_DELAY, 0
        restore = enable_fake_ai(writer, FakeGemini(ai.AIError("The AI service is overloaded right now", retry=True)))
        try:
            reply, error = writer.enhance(1, "q", "answer", None)
        finally:
            restore()
            ai.RETRY_DELAY = saved_delay
        self.assertIsNone(reply)
        self.assertIn("overloaded", error)

    def test_extras_endpoints(self):
        c = self._signed_up("extras@example.com")
        quiz = c.call("GET", "/api/quiz")[1]["questions"]
        self.assertEqual(len(quiz), 5)
        for q in quiz:
            self.assertEqual(len(q["options"]), 4)
            self.assertIn(q["answer"], [o["id"] for o in q["options"]])
        day = c.call("GET", "/api/law-of-the-day")[1]
        self.assertTrue(day["label"] and day["definition"])
        test = c.call("GET", "/api/selftest")[1]
        self.assertEqual(test["passed"], test["total"])

    def test_chat_suggestions_and_urgency(self):
        c = self._signed_up("follow@example.com")
        body = c.call("POST", "/api/chat", {"message": "What is negligence?", "ai": False})[1]
        self.assertTrue(body["suggestions"])
        self.assertFalse(body["urgent"])
        body = c.call("POST", "/api/chat", {"message": "My partner threatened to hurt me", "ai": False})[1]
        self.assertTrue(body["urgent"])

    def test_ai_answer_language(self):
        fake = FakeGemini(gemini_response("नमस्ते"))
        restore = enable_fake_ai(server.AI, fake)
        try:
            c = self._signed_up("hindi@example.com")
            c.call("POST", "/api/chat", {"message": "What is bail?", "lang": "hi"})
            self.assertIn("in Hindi", fake.calls[-1][1]["contents"][0]["parts"][0]["text"])
            c.call("POST", "/api/chat", {"message": "What is bail?"})
            self.assertNotIn("in Hindi", fake.calls[-1][1]["contents"][0]["parts"][0]["text"])
        finally:
            restore()

    def test_ai_daily_limit(self):
        from ai import AIWriter
        writer = AIWriter()
        enable_fake_ai(writer, FakeGemini(gemini_response("ok")))
        writer.daily_limit = 2
        results = [writer.enhance(7, "q", "answer", None) for _ in range(3)]
        self.assertEqual([r[0] for r in results], ["ok", "ok", None])
        self.assertIn("Daily limit", results[2][1])

    def test_api_key_aliases(self):
        from ai import AIWriter
        saved = {k: os.environ.pop(k, None) for k in ("LEXBOT_AI", "GEMINI_API_KEY", "FIREBASE_API_KEY", "GOOGLE_API_KEY")}
        try:
            self.assertEqual(AIWriter().reason, "No GEMINI_API_KEY is configured.")
            os.environ["FIREBASE_API_KEY"] = "AIza-test-not-real"
            self.assertTrue(AIWriter().available)
        finally:
            os.environ.pop("FIREBASE_API_KEY", None)
            for k, v in saved.items():
                if v is not None:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()

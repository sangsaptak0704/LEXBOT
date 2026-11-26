import unittest

from auth import AuthError, AuthStore, LoginLimiter, hash_password, verify_password


class PasswordTests(unittest.TestCase):
    def test_hash_and_verify(self):
        stored = hash_password("correct horse")
        self.assertTrue(stored.startswith("scrypt$"))
        self.assertNotIn("correct horse", stored)
        self.assertTrue(verify_password("correct horse", stored))
        self.assertFalse(verify_password("wrong horse", stored))

    def test_same_password_gets_different_salt(self):
        self.assertNotEqual(hash_password("password123"), hash_password("password123"))

    def test_malformed_hash_is_rejected(self):
        self.assertFalse(verify_password("x", "not-a-hash"))


class AuthStoreTests(unittest.TestCase):
    def setUp(self):
        self.store = AuthStore(":memory:")
        self.user = self.store.signup("Asha", "Asha@Example.com", "password123")

    def test_signup_normalises_email_and_hides_hash(self):
        self.assertEqual(self.user["email"], "asha@example.com")
        self.assertNotIn("password_hash", self.user)

    def test_duplicate_email_is_rejected_case_insensitively(self):
        with self.assertRaises(AuthError) as ctx:
            self.store.signup("Other", "ASHA@example.com", "password456")
        self.assertEqual(ctx.exception.status, 409)

    def test_signup_validation(self):
        for name, email, password in [("", "a@b.co", "password123"),
                                      ("A", "not-an-email", "password123"),
                                      ("A", "a@b.co", "short")]:
            with self.assertRaises(AuthError):
                self.store.signup(name, email, password)

    def test_authenticate(self):
        self.assertEqual(self.store.authenticate("asha@example.com", "password123")["id"], self.user["id"])
        for email, password in [("asha@example.com", "wrong-password"), ("nobody@example.com", "password123")]:
            with self.assertRaises(AuthError) as ctx:
                self.store.authenticate(email, password)
            self.assertEqual(ctx.exception.status, 401)
            self.assertEqual(ctx.exception.message, "Incorrect email or password.")

    def test_session_lifecycle(self):
        token = self.store.create_session(self.user["id"])
        self.assertEqual(self.store.user_for_token(token)["email"], "asha@example.com")
        self.assertIsNone(self.store.user_for_token("made-up-token"))
        self.store.delete_session(token)
        self.assertIsNone(self.store.user_for_token(token))


class LoginLimiterTests(unittest.TestCase):
    def test_blocks_after_limit_and_resets(self):
        limiter = LoginLimiter(limit=3, window=60)
        for _ in range(3):
            self.assertFalse(limiter.blocked("1.2.3.4"))
            limiter.failed("1.2.3.4")
        self.assertTrue(limiter.blocked("1.2.3.4"))
        self.assertFalse(limiter.blocked("5.6.7.8"))
        limiter.reset("1.2.3.4")
        self.assertFalse(limiter.blocked("1.2.3.4"))


if __name__ == "__main__":
    unittest.main()

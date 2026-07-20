import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { auth } from "./firebase.js";
import { claimUsername } from "./api.js";

// Firebase Auth's email/password provider needs an email, so sign-up asks
// for one in addition to a display username (stored via updateProfile).

function friendlyError(err) {
  switch (err.code) {
    case "auth/email-already-in-use":
      return "That email is already registered.";
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/weak-password":
      return "Password should be at least 6 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Invalid email or password.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export default function Auth({ onAuthenticated }) {
  const [mode, setMode] = useState("login"); // 'login' | 'register'
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "register") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: username });
        // The ID token minted at account creation was issued *before* the
        // displayName above existed, so it won't carry a "name" claim
        // until refreshed — force that now so the backend (which reads
        // the token, not the client SDK) sees the right username from
        // the very first request instead of falling back to the email.
        await cred.user.getIdToken(true);

        const claim = await claimUsername(username);
        if (claim.error) {
          // Username was already taken (or invalid) — don't leave an
          // orphaned account with no valid username behind.
          await cred.user.delete().catch(() => {});
          setError(claim.error);
          setLoading(false);
          return;
        }

        onAuthenticated({ uid: cred.user.uid, username });
      } else {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        onAuthenticated({
          uid: cred.user.uid,
          username: cred.user.displayName || cred.user.email,
        });
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <h2>{mode === "login" ? "Log in" : "Create account"}</h2>
      {mode === "register" && (
        <input
          placeholder="Username (letters, numbers, underscores)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={3}
          maxLength={20}
          pattern="[a-zA-Z0-9_]+"
          title="3-20 characters: letters, numbers, and underscores only"
        />
      )}
      <input
        placeholder="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={6}
      />
      {error && <p className="auth-error">{error}</p>}
      <button type="submit" disabled={loading}>
        {loading ? "..." : mode === "login" ? "Log in" : "Sign up"}
      </button>
      <button
        type="button"
        className="auth-switch"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
      >
        {mode === "login" ? "Need an account? Sign up" : "Already have one? Log in"}
      </button>
      <button type="button" className="auth-skip" onClick={() => onAuthenticated(null)}>
        Skip — play as guest
      </button>
    </form>
  );
}

import express from "express";
import bcrypt from "bcryptjs";
import { query } from "../db.js";
import { signToken } from "../middleware/auth.js";

const router = express.Router();

router.post("/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password || password.length < 6) {
    return res.status(400).json({
      error: "Username and a password of at least 6 characters are required.",
    });
  }

  try {
    const existing = await query("SELECT id FROM users WHERE username = $1", [
      username,
    ]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "That username is taken." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username",
      [username, passwordHash]
    );

    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Could not register. Is DATABASE_URL set and migrations.sql applied?" });
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  try {
    const result = await query("SELECT * FROM users WHERE username = $1", [
      username,
    ]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: "Invalid username or password." });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid username or password." });

    const token = signToken(user);
    return res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Could not log in. Is DATABASE_URL set and migrations.sql applied?" });
  }
});

export default router;

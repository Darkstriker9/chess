import express from "express";
import { getBestMove } from "../engine.js";

const router = express.Router();

router.post("/ai-move", async (req, res) => {
  const { fen, depth = 12 } = req.body;

  if (!fen) {
    return res.status(400).json({ error: "Missing 'fen' in request body." });
  }

  try {
    const result = await getBestMove(fen, depth);
    return res.json(result);
  } catch (err) {
    console.error("All AI providers failed:", err.message);
    return res.status(502).json({
      error: "Couldn't reach any chess engine right now. Please try again in a moment.",
    });
  }
});

export default router;

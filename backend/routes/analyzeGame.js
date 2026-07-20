import express from "express";
import { getBestMove } from "../engine.js";

const router = express.Router();

const MAX_POSITIONS = 80; // caps analysis time on long games
const ANALYSIS_DEPTH = 14;

// POST /api/analyze-game { fens: string[] }
// fens[0] should be the starting position, fens[i] the position just
// before ply i was played, and the last entry the final position.
// Evaluated sequentially (not in parallel) to stay polite to the free
// engine APIs — this endpoint is expected to take a while on long games;
// the frontend shows progress via how many results have streamed back.
router.post("/", async (req, res) => {
  const { fens } = req.body;

  if (!Array.isArray(fens) || fens.length === 0) {
    return res.status(400).json({ error: "Missing 'fens' array in request body." });
  }
  if (fens.length > MAX_POSITIONS) {
    return res.status(400).json({ error: `Too many positions to analyze (max ${MAX_POSITIONS}).` });
  }

  const results = [];
  for (const fen of fens) {
    try {
      const { eval: evalScore, mate, move } = await getBestMove(fen, ANALYSIS_DEPTH);
      results.push({ eval: evalScore ?? null, mate: mate ?? null, bestMove: move ?? null });
    } catch (err) {
      console.warn("Analysis position failed:", err.message);
      results.push({ eval: null, mate: null, bestMove: null, error: true });
    }
  }

  return res.json({ results });
});

export default router;

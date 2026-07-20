import express from "express";
import { getBestMove } from "../engine.js";
import { optionalAuth } from "../middleware/auth.js";
import { getCachedAnalysis, saveAnalysis, saveAnalysisSummary } from "../db.js";

const router = express.Router();

const MAX_POSITIONS = 80; // caps analysis time on long games
const ANALYSIS_DEPTH = 14;

// GET /api/analyze-game/:gameId — returns previously-computed analysis for
// this game if we have it cached (Neon/Postgres), so re-opening Game
// Review on a game you've already reviewed is instant instead of
// re-running Stockfish on every position again. 404 means "not cached yet,
// go run POST / instead" — not an error.
router.get("/:gameId", async (req, res) => {
  try {
    const results = await getCachedAnalysis(req.params.gameId);
    if (!results) return res.status(404).json({ cached: false });
    return res.json({ cached: true, results });
  } catch (err) {
    console.error("Fetch cached analysis error:", err.message);
    // Analytics/caching is a nice-to-have, not load-bearing — tell the
    // caller there's nothing cached rather than surfacing a 500, so
    // GameReview just falls through to a fresh analysis.
    return res.status(404).json({ cached: false });
  }
});

// PUT /api/analyze-game/:gameId { results }
// Caches the FULL, assembled results array for a game, once the frontend
// has finished running every chunk through POST / below. Deliberately
// separate from the chunked analysis endpoint — if each chunk cached
// itself under the same gameId, the last chunk to finish would overwrite
// the cache with only ITS slice of the game, silently losing every
// earlier chunk's results.
router.put("/:gameId", async (req, res) => {
  const { results } = req.body || {};
  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "Missing 'results' array in request body." });
  }
  try {
    await saveAnalysis(req.params.gameId, results);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Save analysis error:", err.message);
    // Caching is best-effort — the review itself already succeeded on the
    // client, so don't turn a Postgres hiccup into a visible error there.
    return res.json({ ok: false });
  }
});

// POST /api/analyze-game { fens: string[] }
// fens[0] should be the starting position, fens[i] the position just
// before ply i was played, and the last entry the final position.
// Evaluated sequentially (not in parallel) to stay polite to the free
// engine APIs — this endpoint is expected to take a while on long games;
// the frontend shows progress via how many results have streamed back.
// Chunk-friendly and stateless — caching the assembled result happens
// separately via PUT /:gameId once every chunk has come back.
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

// POST /api/analyze-game/:gameId/summary { color, accuracy, counts }
// Persists the classification GameReview.jsx already computed client-side
// (accuracy % + counts of best/blunder/etc. per move) so it can be
// aggregated into the profile's move-quality analytics. Silently does
// nothing if the caller isn't logged in — a summary with no owner isn't
// useful for personal analytics — or if Postgres isn't configured.
router.post("/:gameId/summary", optionalAuth, async (req, res) => {
  if (!req.user) return res.json({ ok: true, skipped: "not logged in" });

  const { color, accuracy, counts } = req.body || {};
  if (color !== "white" && color !== "black") {
    return res.status(400).json({ error: "color must be 'white' or 'black'." });
  }

  try {
    await saveAnalysisSummary({
      gameId: req.params.gameId,
      color,
      ownerUid: req.user.uid,
      accuracy: typeof accuracy === "number" ? accuracy : null,
      counts: counts || {},
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Save analysis summary error:", err.message);
    return res.status(500).json({ error: "Could not save analysis summary." });
  }
});

export default router;

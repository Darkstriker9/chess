import "dotenv/config";
import pg from "pg";

// Firestore stays the source of truth for accounts, saved-game metadata
// (PGN, result, players), and win/draw/loss stats — nothing about that
// changes here. Postgres (Neon) is used ONLY for the one thing it's
// actually a better fit for: per-move Stockfish analysis. That data is
// naturally tabular (one row per ply), gets queried in bulk for
// analytics (aggregates across many games), and is expensive to
// regenerate — exactly the shape a relational cache is good at, and a
// poor fit for a single Firestore document.
//
// DATABASE_URL is a standard Postgres connection string, e.g. from
// Neon's console: postgres://user:password@host/dbname?sslmode=require
// If it's not set, every function below no-ops (returns null/empty)
// instead of throwing — so the app still runs fine without it, just
// without analysis caching/analytics (Game Review falls back to
// re-analyzing from scratch every time, same as before this existed).

const { Pool } = pg;

let pool = null;
let schemaReady = null;

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Neon (and most managed Postgres hosts) require TLS; rejectUnauthorized:false
      // matches Neon's own connection examples — their cert chain isn't in
      // every environment's default trust store.
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
    pool.on("error", (err) => {
      // A dropped idle connection shouldn't crash the whole backend —
      // just log it, the pool reconnects on the next query.
      console.error("Postgres pool error:", err.message);
    });
  }
  return pool;
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return;
  if (schemaReady) return schemaReady;

  schemaReady = p.query(`
    -- Raw per-position engine output for a finished game, cached by the
    -- Firestore game id so Game Review doesn't re-run Stockfish analysis
    -- (a real cost against the free chess-api.com/stockfish.online rate
    -- limits) every single time the same game is reopened.
    CREATE TABLE IF NOT EXISTS game_analysis (
      game_id TEXT PRIMARY KEY,
      results JSONB NOT NULL,        -- [{ eval, mate, bestMove }, ...] one per FEN, fenHistory-order
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- One row per (game, color) that a logged-in account actually played
    -- — the classification/accuracy numbers GameReview.jsx already
    -- computes client-side, persisted so they can be aggregated into
    -- trends without re-deriving them from game_analysis every time.
    CREATE TABLE IF NOT EXISTS game_analysis_summary (
      game_id TEXT NOT NULL,
      color TEXT NOT NULL CHECK (color IN ('white', 'black')),
      owner_uid TEXT NOT NULL,
      accuracy NUMERIC,
      counts JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { blunder: 1, mistake: 2, ... } per CATEGORIES in GameReview.jsx
      analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (game_id, color)
    );
    CREATE INDEX IF NOT EXISTS game_analysis_summary_owner_idx
      ON game_analysis_summary (owner_uid, analyzed_at DESC);
  `);

  try {
    await schemaReady;
  } catch (err) {
    schemaReady = null; // let the next call retry instead of staying permanently broken
    throw err;
  }
  return schemaReady;
}

export function isConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export async function getCachedAnalysis(gameId) {
  const p = getPool();
  if (!p || !gameId) return null;
  await ensureSchema();
  const { rows } = await p.query("SELECT results FROM game_analysis WHERE game_id = $1", [gameId]);
  return rows[0]?.results ?? null;
}

export async function saveAnalysis(gameId, results) {
  const p = getPool();
  if (!p || !gameId) return;
  await ensureSchema();
  await p.query(
    `INSERT INTO game_analysis (game_id, results) VALUES ($1, $2)
     ON CONFLICT (game_id) DO UPDATE SET results = EXCLUDED.results, created_at = now()`,
    [gameId, JSON.stringify(results)]
  );
}

export async function saveAnalysisSummary({ gameId, color, ownerUid, accuracy, counts }) {
  const p = getPool();
  if (!p || !gameId || !ownerUid) return;
  await ensureSchema();
  await p.query(
    `INSERT INTO game_analysis_summary (game_id, color, owner_uid, accuracy, counts)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (game_id, color) DO UPDATE SET
       owner_uid = EXCLUDED.owner_uid, accuracy = EXCLUDED.accuracy,
       counts = EXCLUDED.counts, analyzed_at = now()`,
    [gameId, color, ownerUid, accuracy, JSON.stringify(counts || {})]
  );
}

// Aggregate stats for one account across every analyzed game: average
// accuracy, total games analyzed, and summed category counts (blunders,
// mistakes, etc.) — this is the actual "analytics" payload the profile
// page reads. recentAccuracies is oldest→newest so the frontend can plot
// a simple trend line without a separate query.
export async function getMoveAnalytics(ownerUid) {
  const p = getPool();
  if (!p || !ownerUid) return null;
  await ensureSchema();

  const { rows } = await p.query(
    `SELECT accuracy, counts, analyzed_at FROM game_analysis_summary
     WHERE owner_uid = $1
     ORDER BY analyzed_at DESC
     LIMIT 50`,
    [ownerUid]
  );

  if (rows.length === 0) {
    return { gamesAnalyzed: 0, averageAccuracy: null, totals: {}, recentAccuracies: [] };
  }

  const withAccuracy = rows.filter((r) => r.accuracy != null);
  const averageAccuracy =
    withAccuracy.length > 0
      ? withAccuracy.reduce((sum, r) => sum + Number(r.accuracy), 0) / withAccuracy.length
      : null;

  const totals = {};
  for (const row of rows) {
    for (const [category, count] of Object.entries(row.counts || {})) {
      totals[category] = (totals[category] || 0) + Number(count);
    }
  }

  const recentAccuracies = rows
    .slice(0, 15)
    .reverse()
    .map((r) => (r.accuracy != null ? Number(r.accuracy) : null))
    .filter((v) => v != null);

  return { gamesAnalyzed: rows.length, averageAccuracy, totals, recentAccuracies };
}

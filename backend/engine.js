import fetch from "node-fetch";

/**
 * Tries chess-api.com first (free, Stockfish 18 NNUE). If it times out,
 * errors, or is unreachable, falls back to stockfish.online (a different
 * free provider) so a single flaky provider doesn't take down AI moves
 * OR post-game analysis. Both are proxied through the backend so the
 * frontend never talks to either provider directly.
 */

const REQUEST_TIMEOUT_MS = 12000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tryChessApiCom(fen, depth) {
  const response = await fetchWithTimeout("https://chess-api.com/v1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fen,
      depth: Math.min(depth, 18), // chess-api.com caps free-tier depth at 18
      maxThinkingTime: 50,
    }),
  });

  if (!response.ok) {
    throw new Error(`chess-api.com returned ${response.status}`);
  }

  const data = await response.json();

  if (!data.move) {
    throw new Error(`chess-api.com returned no move (type: ${data.type})`);
  }

  return {
    move: data.move,
    san: data.san,
    eval: data.eval,
    mate: data.mate,
    provider: "chess-api.com",
  };
}

async function tryStockfishOnline(fen, depth) {
  const url = `https://stockfish.online/api/s/v2.php?fen=${encodeURIComponent(fen)}&depth=${Math.min(depth, 15)}`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`stockfish.online returned ${response.status}`);
  }

  const data = await response.json();

  if (!data.success || !data.bestmove) {
    throw new Error("stockfish.online returned no move");
  }

  // data.bestmove looks like "bestmove e2e4 ponder e7e5"
  const move = data.bestmove.split(" ")[1];
  if (!move) throw new Error("Could not parse stockfish.online move");

  return {
    move,
    san: null,
    eval: data.evaluation,
    mate: data.mate,
    provider: "stockfish.online",
  };
}

/** Returns { move, san, eval, mate, provider } or throws if both providers fail. */
async function getBestMoveUncached(fen, depth) {
  const errors = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    for (const provider of [tryChessApiCom, tryStockfishOnline]) {
      try {
        return await provider(fen, depth);
      } catch (err) {
        errors.push(err.message);
        console.warn("Engine provider failed, trying next:", err.message);
      }
    }
    if (attempt < 2) {
      console.warn("Both engine providers failed, retrying once more after a short delay...");
      await sleep(1500);
    }
  }
  throw new Error(`All engine providers failed: ${errors.join("; ")}`);
}

// Without this, two people independently reviewing the SAME finished game
// (or the same person re-opening a review later) could get different
// accuracy numbers and move classifications for identical positions —
// each analysis request picks whichever provider answers first/succeeds,
// and chess-api.com vs stockfish.online don't always agree exactly on an
// evaluation. Caching by (fen, depth) guarantees the same position always
// returns the same result, regardless of who asks or how many times.
// Bounded + FIFO-evicted so a long-running server doesn't grow unbounded;
// it's a cache, not a persistent store, so it resets on restart.
const MAX_CACHE_ENTRIES = 20000;
const analysisCache = new Map();

export async function getBestMove(fen, depth) {
  const key = `${depth}|${fen}`;
  const cached = analysisCache.get(key);
  if (cached) {
    console.log(`Analysis cache hit (${analysisCache.size} entries cached)`);
    return cached;
  }

  const result = await getBestMoveUncached(fen, depth);

  if (analysisCache.size >= MAX_CACHE_ENTRIES) {
    analysisCache.delete(analysisCache.keys().next().value); // evict oldest
  }
  analysisCache.set(key, result);
  return result;
}

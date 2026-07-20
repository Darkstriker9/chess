import { auth } from "./firebase.js";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

async function authHeaders() {
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function saveGame({ roomId, pgn, result, whiteUsername, blackUsername, playerColor, countsForStats = true }) {
  const res = await fetch(`${BACKEND_URL}/api/games`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ roomId, pgn, result, whiteUsername, blackUsername, playerColor, countsForStats }),
  });
  return res.json();
}

export async function fetchMyGames() {
  const res = await fetch(`${BACKEND_URL}/api/games`, {
    headers: await authHeaders(),
  });
  return res.json();
}

export async function fetchProfile() {
  const res = await fetch(`${BACKEND_URL}/api/profile`, {
    headers: await authHeaders(),
  });
  return res.json();
}

export async function syncProfile() {
  const res = await fetch(`${BACKEND_URL}/api/profile/sync`, {
    method: "POST",
    headers: await authHeaders(),
  });
  return res.json();
}

export async function claimUsername(username) {
  const res = await fetch(`${BACKEND_URL}/api/profile/claim-username`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ username }),
  });
  return res.json();
}

export async function deleteAccount() {
  const res = await fetch(`${BACKEND_URL}/api/profile`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  return res.json();
}

export async function fetchFriends() {
  const res = await fetch(`${BACKEND_URL}/api/friends`, {
    headers: await authHeaders(),
  });
  return res.json();
}

export async function searchUsers(query) {
  const res = await fetch(`${BACKEND_URL}/api/friends/search?q=${encodeURIComponent(query)}`, {
    headers: await authHeaders(),
  });
  return res.json();
}

export async function sendFriendRequest(targetUid) {
  const res = await fetch(`${BACKEND_URL}/api/friends/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ targetUid }),
  });
  return res.json();
}

export async function respondToFriendRequest(requesterUid, accept) {
  const res = await fetch(`${BACKEND_URL}/api/friends/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ requesterUid, accept }),
  });
  return res.json();
}

export async function fetchFriendStats(uid) {
  const res = await fetch(`${BACKEND_URL}/api/friends/${uid}/stats`, {
    headers: await authHeaders(),
  });
  return res.json();
}

export async function removeFriend(targetUid) {
  const res = await fetch(`${BACKEND_URL}/api/friends/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ targetUid }),
  });
  return res.json();
}

export async function getAIMove(fen, depth = 12) {
  let res;
  try {
    res = await fetch(`${BACKEND_URL}/api/ai-move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fen, depth }),
    });
  } catch {
    throw new Error(
      `Couldn't reach the backend at ${BACKEND_URL}. Is it running? (npm start in /backend)`
    );
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.move) {
    throw new Error(data.error || "The chess engine didn't return a move.");
  }

  return data;
}

export async function analyzePositions(fens) {
  const res = await fetch(`${BACKEND_URL}/api/analyze-game`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fens }),
  });
  return res.json();
}

// Checks whether this game's analysis is already cached (Neon/Postgres) —
// lets GameReview skip straight to classification instead of re-running
// Stockfish on every position again. Returns null on a cache miss or if
// analytics storage isn't configured; never throws, since caching is a
// nice-to-have, not required for Game Review to work.
export async function fetchCachedAnalysis(gameId) {
  if (!gameId) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/analyze-game/${gameId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.cached ? data.results : null;
  } catch {
    return null;
  }
}

// Caches the full, assembled results array once every chunk of a fresh
// analysis has come back — a single write, so a partial chunk can never
// clobber the cache with an incomplete game's worth of results. Best-effort
// — GameReview has already shown the (correct) review by the time this
// runs, so a failure here just means next time won't be cached either.
export async function saveFullAnalysis(gameId, results) {
  if (!gameId) return;
  try {
    await fetch(`${BACKEND_URL}/api/analyze-game/${gameId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results }),
    });
  } catch {
    /* best-effort */
  }
}

// Persists the accuracy/category-counts GameReview.jsx just computed
// client-side, so it can feed into the profile's move-quality analytics.
// Best-effort — a failure here shouldn't interrupt looking at the review.
export async function saveAnalysisSummary(gameId, { color, accuracy, counts }) {
  if (!gameId) return;
  try {
    await fetch(`${BACKEND_URL}/api/analyze-game/${gameId}/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ color, accuracy, counts }),
    });
  } catch {
    /* best-effort */
  }
}

export async function fetchMoveAnalytics() {
  const res = await fetch(`${BACKEND_URL}/api/profile/analytics`, {
    headers: await authHeaders(),
  });
  return res.json();
}

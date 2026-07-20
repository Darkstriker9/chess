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

import { firestore, admin } from "./firebaseAdmin.js";

/**
 * outcome: 'win' | 'loss' | 'draw' | 'played' (matchesPlayed only, no W/D/L
 * change — used when we don't know which color the account played, e.g.
 * local same-device games).
 */
export async function bumpUserStats(uid, username, outcome) {
  if (!uid || !firestore) return;

  const increments = { matchesPlayed: admin.firestore.FieldValue.increment(1) };
  if (outcome === "win") increments.wins = admin.firestore.FieldValue.increment(1);
  else if (outcome === "loss") increments.losses = admin.firestore.FieldValue.increment(1);
  else if (outcome === "draw") increments.draws = admin.firestore.FieldValue.increment(1);

  await firestore.collection("users").doc(uid).set(
    {
      username: username || null,
      ...increments,
    },
    { merge: true }
  );
}

/** Turns a result string + the account's own color into a win/loss/draw. */
export function outcomeFor(result, playerColor) {
  if (result === "1/2-1/2") return "draw";
  if (!playerColor || !result) return "played";
  if ((result === "1-0" && playerColor === "white") || (result === "0-1" && playerColor === "black")) {
    return "win";
  }
  return "loss";
}

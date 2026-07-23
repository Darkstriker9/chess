import express from "express";
import { firestore, firebaseAuth, admin } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { getMoveAnalytics } from "../db.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  if (!firestore) {
    return res.status(500).json({
      error: "Firebase Admin is not configured — set FIREBASE_SERVICE_ACCOUNT in backend/.env",
    });
  }

  try {
    const doc = await firestore.collection("users").doc(req.user.uid).get();
    const data = doc.exists ? doc.data() : {};

    return res.json({
      username: data.username || req.user.username,
      photoURL: req.user.photoURL || null, // lives on the Firebase Auth account itself, not Firestore
      wins: data.wins || 0,
      draws: data.draws || 0,
      losses: data.losses || 0,
      matchesPlayed: data.matchesPlayed || 0,
    });
  } catch (err) {
    console.error("Fetch profile error:", err);
    return res.status(500).json({ error: "Could not fetch profile." });
  }
});

// Move-quality analytics (accuracy trend, blunder/mistake/inaccuracy
// totals) aggregated from Postgres/Neon — separate from the win/draw/loss
// stats above, which stay in Firestore. Returns zeroed-out data (not an
// error) if Neon isn't configured or this account hasn't reviewed any
// games yet, since "no analytics" is a normal, expected state.
router.get("/analytics", requireAuth, async (req, res) => {
  try {
    const analytics = await getMoveAnalytics(req.user.uid);
    return res.json(analytics || { gamesAnalyzed: 0, averageAccuracy: null, totals: {}, recentAccuracies: [] });
  } catch (err) {
    console.error("Fetch move analytics error:", err.message);
    return res.json({ gamesAnalyzed: 0, averageAccuracy: null, totals: {}, recentAccuracies: [] });
  }
});

// Called once after login so the account has a Firestore doc to search
// by username, even before it's played its first stats-eligible game
// (win/draw/loss updates also merge into this same doc).
//
// Note: this intentionally does NOT overwrite a username that's already
// been claimed (see /claim-username below) — the ID token's "name" claim
// can lag a step behind a just-set displayName (it's only baked in on
// next token refresh), so blindly trusting it here on every login risks
// clobbering a good, uniqueness-checked username with a stale fallback
// (e.g. the account's email). We only fall back to the token's username
// for accounts that have never claimed one at all (guests / legacy).
router.post("/sync", requireAuth, async (req, res) => {
  if (!firestore) {
    return res.status(500).json({
      error: "Firebase Admin is not configured — set FIREBASE_SERVICE_ACCOUNT in backend/.env",
    });
  }

  try {
    const userRef = firestore.collection("users").doc(req.user.uid);
    const doc = await userRef.get();
    const existingLower = doc.exists ? doc.data().usernameLower : null;

    if (existingLower) {
      // Only trust this as "already claimed" if it's actually reserved in
      // the usernames collection for this uid. Accounts from before the
      // unique-username system (or ones that got stuck with their email
      // as the username due to a stale token) won't have that reservation
      // — fall through and self-heal those using the now-fresh token.
      const reservation = await firestore.collection("usernames").doc(existingLower).get();
      if (reservation.exists && reservation.data().uid === req.user.uid) {
        return res.json({ ok: true });
      }
    }

    const freshUsername = req.user.username;
    const freshLower = freshUsername.toLowerCase();
    const usernameRef = firestore.collection("usernames").doc(freshLower);

    await firestore.runTransaction(async (tx) => {
      const usernameDoc = await tx.get(usernameRef);
      if (usernameDoc.exists && usernameDoc.data().uid !== req.user.uid) {
        // Someone else already legitimately holds this name — leave the
        // account's existing (even if imperfect) username alone rather
        // than risk a collision; they can set a proper one from Profile.
        return;
      }
      if (existingLower && existingLower !== freshLower) {
        tx.delete(firestore.collection("usernames").doc(existingLower));
      }
      tx.set(usernameRef, { uid: req.user.uid }, { merge: true });
      tx.set(userRef, { username: freshUsername, usernameLower: freshLower }, { merge: true });
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("Profile sync error:", err);
    return res.status(500).json({ error: "Could not sync profile." });
  }
});

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// POST /api/profile/claim-username { username }
// Atomically claims a username, enforcing global uniqueness via a
// dedicated "usernames" collection keyed by the lowercased name (so two
// people racing to sign up with the same name can't both win). Safe to
// call again later (e.g. a rename) — it releases the caller's previous
// claim first.
router.post("/claim-username", requireAuth, async (req, res) => {
  if (!firestore) {
    return res.status(500).json({
      error: "Firebase Admin is not configured — set FIREBASE_SERVICE_ACCOUNT in backend/.env",
    });
  }

  const username = (req.body?.username || "").trim();
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({
      error: "Usernames must be 3-20 characters, using only letters, numbers, and underscores.",
    });
  }
  const usernameLower = username.toLowerCase();
  const usernameRef = firestore.collection("usernames").doc(usernameLower);
  const userRef = firestore.collection("users").doc(req.user.uid);

  try {
    await firestore.runTransaction(async (tx) => {
      const [usernameDoc, userDoc] = await Promise.all([tx.get(usernameRef), tx.get(userRef)]);

      if (usernameDoc.exists && usernameDoc.data().uid !== req.user.uid) {
        throw new Error("TAKEN");
      }

      const previousUsername = userDoc.exists ? userDoc.data().usernameLower : null;
      if (previousUsername && previousUsername !== usernameLower) {
        tx.delete(firestore.collection("usernames").doc(previousUsername));
      }

      tx.set(usernameRef, { uid: req.user.uid }, { merge: true });
      tx.set(userRef, { username, usernameLower }, { merge: true });
    });

    return res.json({ ok: true, username });
  } catch (err) {
    if (err.message === "TAKEN") {
      return res.status(409).json({ error: "That username is already taken." });
    }
    console.error("Claim username error:", err);
    return res.status(500).json({ error: "Could not claim username." });
  }
});

// Deletes the account entirely: the Firestore profile doc (stats,
// friends) AND the underlying Firebase Auth account, so nothing is left
// behind to log back into. Before that, it also scrubs this uid out of
// every OTHER user's friends list and pending requests — friend data is
// stored as arrays of {uid, username} snapshots on each user's own doc
// (not a queryable reverse index pointing back at this uid), so the only
// reliable way to find every reference is to scan all accounts. That's
// completely fine at this app's scale (a friends-based hobby project,
// not a service with millions of users) — without it, a deleted account
// would linger forever as a permanently-offline "ghost" friend for
// anyone who'd added them. Saved games in the "games" collection are
// left as-is (they're historical records, not tied to a live account).
router.delete("/", requireAuth, async (req, res) => {
  if (!firestore || !firebaseAuth) {
    return res.status(500).json({
      error: "Firebase Admin is not configured — set FIREBASE_SERVICE_ACCOUNT in backend/.env",
    });
  }

  const uid = req.user.uid;

  try {
    // Scrub references first — if this failed partway through after the
    // account was already gone, we'd have no uid left to search for.
    const allUsersSnap = await firestore.collection("users").get();
    const toUpdate = [];
    for (const otherDoc of allUsersSnap.docs) {
      if (otherDoc.id === uid) continue;
      const data = otherDoc.data();
      const updates = {};
      for (const field of ["friends", "friendRequestsIncoming", "friendRequestsOutgoing"]) {
        // arrayRemove needs the exact stored object, not a reconstructed
        // one — their snapshot of my username may be stale if I've since
        // renamed, so pull the literal entry out of their own array.
        const entry = (data[field] || []).find((f) => f.uid === uid);
        if (entry) updates[field] = admin.firestore.FieldValue.arrayRemove(entry);
      }
      if (Object.keys(updates).length > 0) toUpdate.push({ ref: otherDoc.ref, updates });
    }

    // Batched in chunks of 400 (Firestore's limit is 500 writes/batch) —
    // harmless overhead at this app's scale, cheap insurance if it ever
    // has more than a couple hundred accounts.
    for (let i = 0; i < toUpdate.length; i += 400) {
      const batch = firestore.batch();
      for (const { ref, updates } of toUpdate.slice(i, i + 400)) {
        batch.set(ref, updates, { merge: true });
      }
      await batch.commit();
    }

    const userRef = firestore.collection("users").doc(uid);
    const doc = await userRef.get();
    const usernameLower = doc.exists ? doc.data().usernameLower : null;
    if (usernameLower) {
      await firestore.collection("usernames").doc(usernameLower).delete();
    }
    await userRef.delete();
    await firebaseAuth.deleteUser(uid);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Delete account error:", err);
    return res.status(500).json({ error: "Could not delete account." });
  }
});

export default router;

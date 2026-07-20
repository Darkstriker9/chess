import express from "express";
import { firestore, admin } from "../firebaseAdmin.js";
import { optionalAuth } from "../middleware/auth.js";
import { bumpUserStats, outcomeFor } from "../stats.js";

const router = express.Router();

function requireFirestore(res) {
  if (!firestore) {
    res.status(500).json({
      error: "Firebase Admin is not configured — set FIREBASE_SERVICE_ACCOUNT in backend/.env",
    });
    return false;
  }
  return true;
}

// Saving a game doesn't require login — guests can still save, they just
// won't be able to look the game up under an account later.
router.post("/", optionalAuth, async (req, res) => {
  if (!requireFirestore(res)) return;
  const { roomId, matchId, pgn, result, whiteUsername, blackUsername, playerColor, countsForStats = true } = req.body;

  try {
    const docRef = await firestore.collection("games").add({
      roomId: roomId || null,
      // The two players in an online game each save their own copy as a
      // separate document (so each has its own entry in "my games"), but
      // both copies carry the same matchId — that's what actually links
      // them as "the same real match" for anything that needs to treat
      // them as one (e.g. the Neon analysis cache, keyed on matchId
      // directly by the client rather than looked up through here).
      matchId: matchId || null,
      whiteUsername: whiteUsername || null,
      blackUsername: blackUsername || null,
      pgn: pgn || "",
      result: result || null,
      ownerId: req.user?.uid || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (req.user && countsForStats) {
      // playerColor is which color THIS account played, so wins/losses are
      // credited accurately (e.g. winning as black correctly counts as a
      // win, not a loss). AI games pass countsForStats: false, so they're
      // saved to history but never touch the win/draw/loss counters.
      await bumpUserStats(req.user.uid, req.user.username, outcomeFor(result, playerColor));
    }

    return res.json({ id: docRef.id });
  } catch (err) {
    console.error("Save game error:", err);
    return res.status(500).json({ error: "Could not save game." });
  }
});

router.get("/", optionalAuth, async (req, res) => {
  if (!requireFirestore(res)) return;
  if (!req.user) return res.status(401).json({ error: "Login required to view saved games." });

  try {
    const snapshot = await firestore
      .collection("games")
      .where("ownerId", "==", req.user.uid)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const games = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        room_id: data.roomId,
        white_username: data.whiteUsername,
        black_username: data.blackUsername,
        pgn: data.pgn,
        result: data.result,
        created_at: data.createdAt ? data.createdAt.toDate().toISOString() : null,
      };
    });

    return res.json({ games });
  } catch (err) {
    console.error("Fetch games error:", err);
    return res.status(500).json({ error: "Could not fetch games." });
  }
});

export default router;

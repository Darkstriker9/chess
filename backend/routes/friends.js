import express from "express";
import { firestore, admin, firebaseAuth } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { isOnline, notifyUser, getUserRoom } from "../presence.js";

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

const userRef = (uid) => firestore.collection("users").doc(uid);

async function getUserData(uid) {
  const doc = await userRef(uid).get();
  return doc.exists ? doc.data() : {};
}

// photoURL lives on the Firebase Auth account itself, not Firestore (see
// profile.js), so showing it on anyone but yourself means looking it up
// live via the Admin SDK. Batches the lookup instead of one call per uid.
async function attachPhotoURLs(entries) {
  if (entries.length === 0) return entries;
  if (!firebaseAuth) {
    console.warn("attachPhotoURLs: firebaseAuth not configured, returning entries with no photoURL");
    return entries.map((e) => ({ ...e, photoURL: null }));
  }
  try {
    const { users } = await firebaseAuth.getUsers(entries.map((e) => ({ uid: e.uid })));
    const photoByUid = new Map(users.map((u) => [u.uid, u.photoURL || null]));
    return entries.map((e) => ({ ...e, photoURL: photoByUid.get(e.uid) || null }));
  } catch (err) {
    console.error("Batch photoURL lookup failed:", err);
    return entries.map((e) => ({ ...e, photoURL: null }));
  }
}

// GET /api/friends — your current friends + pending requests
router.get("/", requireAuth, async (req, res) => {
  if (!requireFirestore(res)) return;
  try {
    const data = await getUserData(req.user.uid);
    const withOnline = (list) =>
      (list || []).map((f) => ({ ...f, online: isOnline(f.uid), roomId: getUserRoom(f.uid) }));
    const [friends, incoming, outgoing] = await Promise.all([
      attachPhotoURLs(withOnline(data.friends)),
      attachPhotoURLs(withOnline(data.friendRequestsIncoming)),
      attachPhotoURLs(withOnline(data.friendRequestsOutgoing)),
    ]);
    return res.json({ friends, incoming, outgoing });
  } catch (err) {
    console.error("Fetch friends error:", err);
    return res.status(500).json({ error: "Could not fetch friends." });
  }
});

// GET /api/friends/search?q=alice — find people to add by username prefix
router.get("/search", requireAuth, async (req, res) => {
  if (!requireFirestore(res)) return;
  const q = (req.query.q || "").trim().toLowerCase();
  if (q.length < 2) return res.json({ results: [] });

  try {
    const snapshot = await firestore
      .collection("users")
      .where("usernameLower", ">=", q)
      .where("usernameLower", "<=", q + "\uf8ff")
      .limit(10)
      .get();

    const me = await getUserData(req.user.uid);
    const friendUids = new Set((me.friends || []).map((f) => f.uid));
    const outgoingUids = new Set((me.friendRequestsOutgoing || []).map((f) => f.uid));

    const results = snapshot.docs
      .filter((doc) => doc.id !== req.user.uid)
      .map((doc) => ({
        uid: doc.id,
        username: doc.data().username,
        status: friendUids.has(doc.id) ? "friends" : outgoingUids.has(doc.id) ? "pending" : "none",
      }));

    return res.json({ results: await attachPhotoURLs(results) });
  } catch (err) {
    console.error("Friend search error:", err);
    return res.status(500).json({ error: "Search failed." });
  }
});

// POST /api/friends/request { targetUid }
router.post("/request", requireAuth, async (req, res) => {
  if (!requireFirestore(res)) return;
  const { targetUid } = req.body;
  if (!targetUid || targetUid === req.user.uid) {
    return res.status(400).json({ error: "Invalid target." });
  }

  try {
    const targetDoc = await userRef(targetUid).get();
    if (!targetDoc.exists) return res.status(404).json({ error: "User not found." });

    const me = { uid: req.user.uid, username: req.user.username };
    const target = { uid: targetUid, username: targetDoc.data().username };

    const batch = firestore.batch();
    batch.set(
      userRef(targetUid),
      { friendRequestsIncoming: admin.firestore.FieldValue.arrayUnion(me) },
      { merge: true }
    );
    batch.set(
      userRef(req.user.uid),
      { friendRequestsOutgoing: admin.firestore.FieldValue.arrayUnion(target) },
      { merge: true }
    );
    await batch.commit();

    notifyUser(targetUid, "friend_request_received", {
      fromUid: me.uid,
      fromUsername: me.username,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("Friend request error:", err);
    return res.status(500).json({ error: "Could not send request." });
  }
});

// POST /api/friends/respond { requesterUid, accept: boolean }
router.post("/respond", requireAuth, async (req, res) => {
  if (!requireFirestore(res)) return;
  const { requesterUid, accept } = req.body;
  if (!requesterUid) return res.status(400).json({ error: "Missing requesterUid." });

  try {
    const [meData, requesterData] = await Promise.all([
      getUserData(req.user.uid),
      getUserData(requesterUid),
    ]);

    // arrayRemove needs the EXACT stored object, so pull it from what's
    // actually saved rather than reconstructing it.
    const incomingEntry = (meData.friendRequestsIncoming || []).find((f) => f.uid === requesterUid);
    const outgoingEntry = (requesterData.friendRequestsOutgoing || []).find((f) => f.uid === req.user.uid);

    const batch = firestore.batch();

    if (incomingEntry) {
      batch.set(
        userRef(req.user.uid),
        { friendRequestsIncoming: admin.firestore.FieldValue.arrayRemove(incomingEntry) },
        { merge: true }
      );
    }
    if (outgoingEntry) {
      batch.set(
        userRef(requesterUid),
        { friendRequestsOutgoing: admin.firestore.FieldValue.arrayRemove(outgoingEntry) },
        { merge: true }
      );
    }

    if (accept) {
      batch.set(
        userRef(req.user.uid),
        {
          friends: admin.firestore.FieldValue.arrayUnion({
            uid: requesterUid,
            username: requesterData.username || incomingEntry?.username || "Player",
          }),
        },
        { merge: true }
      );
      batch.set(
        userRef(requesterUid),
        {
          friends: admin.firestore.FieldValue.arrayUnion({
            uid: req.user.uid,
            username: req.user.username,
          }),
        },
        { merge: true }
      );
    }

    await batch.commit();
    if (accept) {
      notifyUser(requesterUid, "friend_request_accepted", {
        byUid: req.user.uid,
        byUsername: req.user.username,
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("Friend respond error:", err);
    return res.status(500).json({ error: "Could not respond to request." });
  }
});

// GET /api/friends/:uid/stats — a friend's public stats (must actually be
// your friend — not a general "look up anyone's stats" endpoint).
router.get("/:uid/stats", requireAuth, async (req, res) => {
  if (!requireFirestore(res)) return;
  const targetUid = req.params.uid;

  try {
    const me = await getUserData(req.user.uid);
    const isFriend = (me.friends || []).some((f) => f.uid === targetUid);
    if (!isFriend) return res.status(403).json({ error: "Not your friend." });

    const target = await getUserData(targetUid);
    const [enriched] = await attachPhotoURLs([{ uid: targetUid }]);
    return res.json({
      username: target.username || "Player",
      photoURL: enriched.photoURL,
      wins: target.wins || 0,
      draws: target.draws || 0,
      losses: target.losses || 0,
      matchesPlayed: target.matchesPlayed || 0,
      online: isOnline(targetUid),
    });
  } catch (err) {
    console.error("Friend stats error:", err);
    return res.status(500).json({ error: "Could not fetch stats." });
  }
});

// POST /api/friends/remove { targetUid } — unfriend (removes both sides)
router.post("/remove", requireAuth, async (req, res) => {
  if (!requireFirestore(res)) return;
  const { targetUid } = req.body;
  if (!targetUid) return res.status(400).json({ error: "Missing targetUid." });

  try {
    const [me, target] = await Promise.all([getUserData(req.user.uid), getUserData(targetUid)]);
    const myEntry = (me.friends || []).find((f) => f.uid === targetUid);
    const theirEntry = (target.friends || []).find((f) => f.uid === req.user.uid);

    const batch = firestore.batch();
    if (myEntry) {
      batch.set(
        userRef(req.user.uid),
        { friends: admin.firestore.FieldValue.arrayRemove(myEntry) },
        { merge: true }
      );
    }
    if (theirEntry) {
      batch.set(
        userRef(targetUid),
        { friends: admin.firestore.FieldValue.arrayRemove(theirEntry) },
        { merge: true }
      );
    }
    await batch.commit();

    return res.json({ ok: true });
  } catch (err) {
    console.error("Unfriend error:", err);
    return res.status(500).json({ error: "Could not remove friend." });
  }
});

export default router;

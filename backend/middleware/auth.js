import { firebaseAuth } from "../firebaseAdmin.js";

/**
 * Attaches req.user if a valid Firebase ID token is present in the
 * Authorization header (Bearer <idToken>, obtained on the client via
 * `getAuth().currentUser.getIdToken()`).
 * Does NOT reject the request if there's no token — routes that require
 * login should check `req.user` themselves (see requireAuth below).
 */
export async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ") && firebaseAuth) {
    try {
      const decoded = await firebaseAuth.verifyIdToken(header.slice(7));
      req.user = {
        uid: decoded.uid,
        username: decoded.name || decoded.email || decoded.uid,
        photoURL: decoded.picture || null,
      };
    } catch {
      // invalid/expired token — treat as logged out rather than erroring
    }
  }
  next();
}

export async function requireAuth(req, res, next) {
  if (!firebaseAuth) {
    return res.status(500).json({
      error: "Firebase Admin is not configured — set FIREBASE_SERVICE_ACCOUNT in backend/.env",
    });
  }
  await optionalAuth(req, res, () => {
    if (!req.user) return res.status(401).json({ error: "Login required." });
    next();
  });
}

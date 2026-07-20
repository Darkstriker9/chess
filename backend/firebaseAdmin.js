import "dotenv/config";
import admin from "firebase-admin";

// Two ways to provide credentials (pick one):
//
// 1) FIREBASE_SERVICE_ACCOUNT — paste the ENTIRE contents of the service
//    account JSON file (Project settings > Service accounts > Generate new
//    private key) as a single-line string into backend/.env.
//
// 2) GOOGLE_APPLICATION_CREDENTIALS — set this to a filesystem path to the
//    downloaded JSON key instead, and leave FIREBASE_SERVICE_ACCOUNT unset.
//    (This is the standard Google Cloud env var and Admin SDK will pick it
//    up automatically via admin.credential.applicationDefault().)

let app = null;

function init() {
  if (app) return app;

  if (admin.apps.length) {
    app = admin.apps[0];
    return app;
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    app = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  } else {
    app = null; // not configured yet
  }

  return app;
}

init();

export const firestore = app ? admin.firestore() : null;
export const firebaseAuth = app ? admin.auth() : null;
export { admin };

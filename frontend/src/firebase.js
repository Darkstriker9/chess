import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

// These VITE_FIREBASE_* values come from Firebase Console > Project
// settings > General > Your apps > SDK setup and configuration.
// They are public/bundled into the browser build — that's expected for
// Firebase web apps; access is controlled by Firebase Auth + security
// rules, not by keeping this config secret.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  // Optional — only needed for avatar file uploads (see README's "Extra
  // setup for avatar uploads" section). Leaving it unset doesn't break
  // anything else; uploads will just fail with a clear error until it's
  // configured, since Storage itself requires the Blaze plan to enable.
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const storage = getStorage(firebaseApp);

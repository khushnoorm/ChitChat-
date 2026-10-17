/**
 * Chit Chat — Firebase Configuration Template
 * ============================================
 * Instructions:
 * 1. Create a Firebase project at https://console.firebase.google.com/
 * 2. Register a Web App in Project Settings -> General -> Your apps.
 * 3. Copy the `firebaseConfig` values from the Firebase Console.
 * 4. Either:
 *    (a) Paste the values directly in the app's "Configure Firebase" dialog
 *        (ideal when working from an Android phone or live GitHub Pages site), OR
 *    (b) Copy values into `DEFAULT_FIREBASE_CONFIG` inside `js/firebase-config.js`.
 *
 * SECURITY NOTICE:
 * - Never place Firebase Admin SDK service-account private keys, OAuth client
 *   secrets, or server tokens into frontend files or commit them to GitHub.
 * - Client-side Firebase web configuration identifies your Firebase project;
 *   actual data privacy is enforced by `firestore.rules` and `storage.rules`.
 */

export const EXAMPLE_FIREBASE_CONFIG = {
  apiKey: "YOUR_FIREBASE_WEB_API_KEY",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_FIREBASE_WEB_APP_ID"
};

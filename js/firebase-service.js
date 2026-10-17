/**
 * Chit Chat — Firebase Service Initialization & SDK Bridge
 * ========================================================
 * Dynamically loads and initializes Firebase Authentication, Cloud Firestore,
 * and Firebase Storage using official modular ES modules from Google CDN.
 */

import { getActiveFirebaseConfig } from "./firebase-config.js";

const FIREBASE_CDN_VERSION = "10.14.1";
const CDN_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_CDN_VERSION}`;

let sdkModules = null;
let firebaseInstances = null;
let initError = null;

export async function loadFirebaseSdk() {
  if (sdkModules) return sdkModules;

  try {
    const [appMod, authMod, firestoreMod, storageMod] = await Promise.all([
      import(`${CDN_BASE}/firebase-app.js`),
      import(`${CDN_BASE}/firebase-auth.js`),
      import(`${CDN_BASE}/firebase-firestore.js`),
      import(`${CDN_BASE}/firebase-storage.js`)
    ]);

    sdkModules = {
      appMod,
      authMod,
      firestoreMod,
      storageMod
    };
    return sdkModules;
  } catch (err) {
    initError = err;
    throw new Error(
      "Unable to load Firebase SDK modules from gstatic CDN. Check your internet connection."
    );
  }
}

export async function initFirebaseServices() {
  const { config, source, isValid } = getActiveFirebaseConfig();

  if (!isValid) {
    return {
      ready: false,
      source,
      config,
      error: null
    };
  }

  if (firebaseInstances && firebaseInstances.projectId === config.projectId) {
    return {
      ready: true,
      source,
      config,
      ...firebaseInstances
    };
  }

  try {
    const sdk = await loadFirebaseSdk();
    const { initializeApp, getApps, getApp } = sdk.appMod;
    const { getAuth } = sdk.authMod;
    const { getFirestore } = sdk.firestoreMod;
    const { getStorage } = sdk.storageMod;

    const app = getApps().length ? getApp() : initializeApp(config);
    const auth = getAuth(app);
    const db = getFirestore(app);
    let storage = null;
    try {
      if (config.storageBucket) {
        storage = getStorage(app);
      }
    } catch (storageErr) {
      console.warn("Firebase Storage initialization skipped:", storageErr);
    }

    firebaseInstances = {
      projectId: config.projectId,
      app,
      auth,
      db,
      storage,
      sdk
    };

    return {
      ready: true,
      source,
      config,
      ...firebaseInstances
    };
  } catch (err) {
    initError = err;
    return {
      ready: false,
      source,
      config,
      error: err.message || "Failed to initialize Firebase project."
    };
  }
}

export function getLastInitError() {
  return initError;
}

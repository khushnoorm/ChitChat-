/**
 * Chit Chat — Authentication, Profile & Presence Module
 * ======================================================
 * Handles Firebase Authentication (Email/Password registration, login, logout,
 * password reset, email verification), user profile creation/updates in Cloud
 * Firestore, online presence heartbeats, and WebCrypto E2EE public key sync.
 */

import { initFirebaseServices } from "./firebase-service.js";
import { ensureUserKeyPair, rotateUserKeyPair } from "./crypto.js";

const AVATAR_PALETTE = [
  "#4f46e5",
  "#0ea5e9",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#14b8a6",
  "#ef4444"
];

let presenceInterval = null;
let visibilityHandlerAttached = false;

export function pickAvatarColor(seed = "") {
  let hash = 0;
  const str = String(seed || "chitchat");
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export function mapAuthError(error) {
  if (!error) return "An unexpected error occurred. Please try again.";
  const code = String(error.code || "");
  const message = String(error.message || "");

  const map = {
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/user-disabled": "This account has been disabled by an administrator.",
    "auth/user-not-found": "No account found with this email address.",
    "auth/wrong-password": "Incorrect password. Please try again or reset your password.",
    "auth/invalid-credential": "Invalid email or password. Please double-check your credentials.",
    "auth/email-already-in-use": "An account with this email already exists. Try logging in instead.",
    "auth/weak-password": "Password is too weak. Use at least 8 characters with letters and numbers.",
    "auth/operation-not-allowed":
      "Email/Password sign-in is not enabled in your Firebase Console. Enable it under Authentication -> Sign-in method.",
    "auth/too-many-requests":
      "Too many failed attempts. Please wait a few minutes or reset your password.",
    "auth/network-request-failed":
      "Network connection failed. Check your internet connection and try again.",
    "auth/requires-recent-login":
      "For security, please log out and log back in before making this change.",
    "auth/unauthorized-domain":
      "This domain is not authorized in Firebase Authentication. Add your GitHub Pages domain under Firebase Console -> Authentication -> Settings -> Authorized domains.",
    "permission-denied":
      "Access denied by Firestore Security Rules. Verify you are signed in and rules are deployed."
  };

  if (map[code]) return map[code];
  if (message.includes("USERNAME_TAKEN")) {
    return "That @username is already taken. Please choose another handle.";
  }
  return message.replace(/^Firebase:\s*/i, "") || "Authentication failed. Please try again.";
}

export function validateRegistrationInput({ displayName, username, email, password, confirmPassword }) {
  const cleanName = String(displayName || "").trim();
  const cleanUser = String(username || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  const cleanEmail = String(email || "").trim();

  if (cleanName.length < 2 || cleanName.length > 60) {
    throw new Error("Display name must be between 2 and 60 characters.");
  }
  if (!/^[a-z0-9_.]{3,30}$/.test(cleanUser)) {
    throw new Error(
      "Username must be 3–30 characters and contain only lowercase letters, numbers, underscores (_), or dots (.)."
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error("Please enter a valid email address.");
  }
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    throw new Error("Passwords do not match.");
  }

  return {
    displayName: cleanName,
    username: cleanUser,
    email: cleanEmail
  };
}

export async function isUsernameAvailable(username, excludeUid = null) {
  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");
  const { db, sdk } = services;
  const { collection, query, where, getDocs, limit } = sdk.firestoreMod;

  const clean = String(username || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

  const q = query(
    collection(db, "users"),
    where("usernameLower", "==", clean),
    limit(3)
  );
  const snap = await getDocs(q);
  for (const docSnap of snap.docs) {
    if (docSnap.id !== excludeUid) {
      return false;
    }
  }
  return true;
}

export async function ensureUserProfileDocument(firebaseUser, overrides = {}) {
  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");
  const { db, sdk } = services;
  const { doc, getDoc, setDoc, serverTimestamp } = sdk.firestoreMod;

  const userRef = doc(db, "users", firebaseUser.uid);
  const existingSnap = await getDoc(userRef);

  const keyInfo = await ensureUserKeyPair(firebaseUser.uid);

  if (existingSnap.exists()) {
    const existingData = existingSnap.data();
    const updates = {
      isOnline: true,
      lastSeen: serverTimestamp(),
      emailVerified: Boolean(firebaseUser.emailVerified)
    };
    if (keyInfo && (!existingData.publicKeyJwk || overrides.forceKeySync)) {
      updates.publicKeyJwk = keyInfo.publicKeyJwk;
      updates.keyFingerprint = keyInfo.fingerprint;
    }
    await setDoc(userRef, updates, { merge: true });
    return {
      ...existingData,
      ...updates,
      uid: firebaseUser.uid,
      email: firebaseUser.email || existingData.email || "",
      emailVerified: Boolean(firebaseUser.emailVerified),
      keyFingerprint: keyInfo ? keyInfo.fingerprint : existingData.keyFingerprint
    };
  }

  const fallbackName =
    overrides.displayName ||
    firebaseUser.displayName ||
    (firebaseUser.email ? firebaseUser.email.split("@")[0] : "Chit Chat User");

  const rawUsername =
    overrides.username ||
    (firebaseUser.email
      ? firebaseUser.email.split("@")[0].replace(/[^a-zA-Z0-9_.]/g, "").toLowerCase()
      : `user_${firebaseUser.uid.slice(0, 6).toLowerCase()}`);

  const cleanUsername =
    rawUsername.length >= 3
      ? rawUsername.slice(0, 24)
      : `user_${firebaseUser.uid.slice(0, 6).toLowerCase()}`;

  const profileData = {
    uid: firebaseUser.uid,
    displayName: fallbackName.slice(0, 60),
    displayNameLower: fallbackName.slice(0, 60).toLowerCase(),
    username: cleanUsername,
    usernameLower: cleanUsername.toLowerCase(),
    email: firebaseUser.email || "",
    emailVerified: Boolean(firebaseUser.emailVerified),
    bio: overrides.bio || "Hey there! I am using Chit Chat for private messaging.",
    photoURL: overrides.photoURL || firebaseUser.photoURL || "",
    avatarColor: overrides.avatarColor || pickAvatarColor(firebaseUser.uid),
    publicKeyJwk: keyInfo ? keyInfo.publicKeyJwk : null,
    keyFingerprint: keyInfo ? keyInfo.fingerprint : "",
    isOnline: true,
    showOnlineStatus: true,
    readReceipts: true,
    blockedUsers: [],
    notificationPrefs: {
      browserNotifications: false,
      soundEffects: true,
      showMessagePreview: true
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastSeen: serverTimestamp()
  };

  await setDoc(userRef, profileData, { merge: true });
  return profileData;
}

export async function registerWithEmail({
  displayName,
  username,
  email,
  password,
  confirmPassword,
  bio = ""
}) {
  const validated = validateRegistrationInput({
    displayName,
    username,
    email,
    password,
    confirmPassword
  });

  const services = await initFirebaseServices();
  if (!services.ready) {
    throw new Error("Firebase backend is not configured yet. Please configure Firebase first.");
  }

  const { auth, sdk } = services;
  const {
    createUserWithEmailAndPassword,
    updateProfile,
    sendEmailVerification
  } = sdk.authMod;

  const userCredential = await createUserWithEmailAndPassword(
    auth,
    validated.email,
    password
  );
  const user = userCredential.user;

  let finalUsername = validated.username;
  try {
    const available = await isUsernameAvailable(finalUsername, user.uid);
    if (!available) {
      finalUsername = `${finalUsername}_${user.uid.slice(0, 4).toLowerCase()}`;
    }
  } catch (_) {}

  await updateProfile(user, {
    displayName: validated.displayName
  });

  let verificationSent = false;
  try {
    await sendEmailVerification(user);
    verificationSent = true;
  } catch (verifyErr) {
    console.warn("Could not send verification email immediately:", verifyErr);
  }

  const profile = await ensureUserProfileDocument(user, {
    displayName: validated.displayName,
    username: finalUsername,
    bio: String(bio || "").trim() || "Hey there! I am using Chit Chat for private messaging."
  });

  return {
    user,
    profile,
    verificationSent
  };
}

export async function loginWithEmail(email, password) {
  const cleanEmail = String(email || "").trim();
  if (!cleanEmail || !password) {
    throw new Error("Please enter both your email address and password.");
  }

  const services = await initFirebaseServices();
  if (!services.ready) {
    throw new Error("Firebase backend is not configured yet. Please configure Firebase first.");
  }

  const { auth, sdk } = services;
  const { signInWithEmailAndPassword } = sdk.authMod;

  const credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
  const profile = await ensureUserProfileDocument(credential.user);
  return {
    user: credential.user,
    profile
  };
}

export async function sendPasswordReset(email) {
  const cleanEmail = String(email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error("Please enter the valid email address associated with your account.");
  }

  const services = await initFirebaseServices();
  if (!services.ready) {
    throw new Error("Firebase backend is not configured yet.");
  }

  const { auth, sdk } = services;
  const { sendPasswordResetEmail } = sdk.authMod;
  await sendPasswordResetEmail(auth, cleanEmail);
}

export async function resendVerificationEmail() {
  const services = await initFirebaseServices();
  if (!services.ready || !services.auth.currentUser) {
    throw new Error("You must be signed in to request a verification email.");
  }
  const { sendEmailVerification } = services.sdk.authMod;
  await sendEmailVerification(services.auth.currentUser);
}

export async function reloadCurrentAuthUser() {
  const services = await initFirebaseServices();
  if (!services.ready || !services.auth.currentUser) return null;
  await services.auth.currentUser.reload();
  const user = services.auth.currentUser;
  const profile = await ensureUserProfileDocument(user);
  return { user, profile };
}

export async function updateUserProfileData(uid, updates) {
  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");
  const { auth, db, sdk } = services;
  const { doc, setDoc, getDoc, serverTimestamp } = sdk.firestoreMod;
  const { updateProfile } = sdk.authMod;

  const cleanUpdates = {
    updatedAt: serverTimestamp()
  };

  if (updates.displayName !== undefined) {
    const name = String(updates.displayName || "").trim();
    if (name.length < 2 || name.length > 60) {
      throw new Error("Display name must be between 2 and 60 characters.");
    }
    cleanUpdates.displayName = name;
    cleanUpdates.displayNameLower = name.toLowerCase();
  }

  if (updates.username !== undefined) {
    const uname = String(updates.username || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (!/^[a-z0-9_.]{3,30}$/.test(uname)) {
      throw new Error(
        "Username must be 3–30 characters (lowercase letters, numbers, underscores, or dots)."
      );
    }
    const available = await isUsernameAvailable(uname, uid);
    if (!available) {
      throw new Error("USERNAME_TAKEN");
    }
    cleanUpdates.username = uname;
    cleanUpdates.usernameLower = uname;
  }

  if (updates.bio !== undefined) {
    const bio = String(updates.bio || "").trim();
    if (bio.length > 250) {
      throw new Error("Bio must be 250 characters or fewer.");
    }
    cleanUpdates.bio = bio;
  }

  if (updates.photoURL !== undefined) {
    cleanUpdates.photoURL = String(updates.photoURL || "").trim();
  }

  if (updates.avatarColor !== undefined) {
    cleanUpdates.avatarColor = String(updates.avatarColor || "").trim();
  }

  if (updates.showOnlineStatus !== undefined) {
    cleanUpdates.showOnlineStatus = Boolean(updates.showOnlineStatus);
  }

  if (updates.readReceipts !== undefined) {
    cleanUpdates.readReceipts = Boolean(updates.readReceipts);
  }

  if (updates.notificationPrefs !== undefined) {
    cleanUpdates.notificationPrefs = {
      browserNotifications: Boolean(updates.notificationPrefs.browserNotifications),
      soundEffects: Boolean(updates.notificationPrefs.soundEffects),
      showMessagePreview: Boolean(updates.notificationPrefs.showMessagePreview)
    };
  }

  const userRef = doc(db, "users", uid);
  await setDoc(userRef, cleanUpdates, { merge: true });

  if (auth.currentUser && (cleanUpdates.displayName || cleanUpdates.photoURL !== undefined)) {
    try {
      await updateProfile(auth.currentUser, {
        displayName: cleanUpdates.displayName || auth.currentUser.displayName,
        photoURL:
          cleanUpdates.photoURL !== undefined
            ? cleanUpdates.photoURL
            : auth.currentUser.photoURL
      });
    } catch (err) {
      console.warn("Auth profile sync warning:", err);
    }
  }

  const updatedSnap = await getDoc(userRef);
  return updatedSnap.exists() ? updatedSnap.data() : cleanUpdates;
}

export async function rotateAndPublishUserKeys(uid) {
  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");
  const { db, sdk } = services;
  const { doc, setDoc, serverTimestamp } = sdk.firestoreMod;

  const keyInfo = await rotateUserKeyPair(uid);
  if (!keyInfo) {
    throw new Error("Web Crypto API is not available in this browser.");
  }

  const userRef = doc(db, "users", uid);
  await setDoc(
    userRef,
    {
      publicKeyJwk: keyInfo.publicKeyJwk,
      keyFingerprint: keyInfo.fingerprint,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  return keyInfo;
}

export async function setOnlinePresence(uid, isOnline) {
  if (!uid) return;
  try {
    const services = await initFirebaseServices();
    if (!services.ready) return;
    const { db, sdk } = services;
    const { doc, setDoc, serverTimestamp } = sdk.firestoreMod;

    await setDoc(
      doc(db, "users", uid),
      {
        isOnline: Boolean(isOnline),
        lastSeen: serverTimestamp()
      },
      { merge: true }
    );
  } catch (_) {}
}

export function startPresenceTracking(uid) {
  stopPresenceTracking();
  if (!uid) return;

  setOnlinePresence(uid, true);

  presenceInterval = window.setInterval(() => {
    if (document.visibilityState === "visible") {
      setOnlinePresence(uid, true);
    }
  }, 60000);

  if (!visibilityHandlerAttached) {
    document.addEventListener("visibilitychange", () => {
      initFirebaseServices().then((s) => {
        if (s.ready && s.auth?.currentUser) {
          setOnlinePresence(
            s.auth.currentUser.uid,
            document.visibilityState === "visible"
          );
        }
      });
    });

    window.addEventListener("beforeunload", () => {
      initFirebaseServices().then((s) => {
        if (s.ready && s.auth?.currentUser) {
          setOnlinePresence(s.auth.currentUser.uid, false);
        }
      });
    });

    visibilityHandlerAttached = true;
  }
}

export function stopPresenceTracking() {
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }
}

export async function logoutUser() {
  const services = await initFirebaseServices();
  if (!services.ready) return;
  const { auth, sdk } = services;
  const { signOut } = sdk.authMod;

  if (auth.currentUser) {
    await setOnlinePresence(auth.currentUser.uid, false);
  }
  stopPresenceTracking();
  await signOut(auth);
}

export async function subscribeToAuthChanges(callback) {
  const services = await initFirebaseServices();
  if (!services.ready) {
    callback({ ready: false, user: null, profile: null });
    return () => {};
  }

  const { auth, sdk } = services;
  const { onAuthStateChanged } = sdk.authMod;

  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      stopPresenceTracking();
      callback({ ready: true, user: null, profile: null });
      return;
    }

    try {
      const profile = await ensureUserProfileDocument(user);
      startPresenceTracking(user.uid);
      callback({ ready: true, user, profile });
    } catch (err) {
      console.error("Error syncing user profile:", err);
      callback({
        ready: true,
        user,
        profile: {
          uid: user.uid,
          displayName: user.displayName || user.email?.split("@")[0] || "User",
          username: user.email?.split("@")[0] || "user",
          email: user.email || "",
          emailVerified: Boolean(user.emailVerified),
          avatarColor: pickAvatarColor(user.uid),
          blockedUsers: []
        }
      });
    }
  });
}

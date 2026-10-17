/**
 * Chit Chat — Runtime Firebase Configuration Loader
 * ==================================================
 * Resolves Firebase Web App configuration from:
 * 1. `window.__CHITCHAT_FIREBASE_CONFIG__` (if injected at runtime)
 * 2. Browser `localStorage` (`chitchat_firebase_config_v1` saved via the in-app Setup Modal)
 * 3. `DEFAULT_FIREBASE_CONFIG` below (if populated before deployment)
 *
 * No secrets or invented API keys are embedded in this file.
 */

const STORAGE_KEY = "chitchat_firebase_config_v1";

export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

const REQUIRED_KEYS = ["apiKey", "authDomain", "projectId", "appId"];

export function isFirebaseConfigValid(cfg) {
  if (!cfg || typeof cfg !== "object") return false;
  for (const key of REQUIRED_KEYS) {
    const val = String(cfg[key] || "").trim();
    if (!val) return false;
    if (
      val.startsWith("YOUR_") ||
      val === "your-project-id" ||
      val === "your-project-id.firebaseapp.com" ||
      val.includes("REPLACE_ME")
    ) {
      return false;
    }
  }
  return true;
}

export function parseFirebaseConfigInput(rawInput) {
  const trimmed = String(rawInput || "").trim();
  if (!trimmed) {
    throw new Error("Please paste your Firebase configuration JSON or code snippet.");
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      return normalizeConfig(parsed);
    }
  } catch (_) {
    // Fall through to object literal extractor
  }

  const braceMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!braceMatch) {
    throw new Error("Could not find a valid `{ ... }` configuration object in the input.");
  }

  const block = braceMatch[0];
  const extracted = {};
  const allowedKeys = [
    "apiKey",
    "authDomain",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
    "measurementId"
  ];

  for (const key of allowedKeys) {
    const regex = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`);
    const match = block.match(regex);
    if (match && match[1]) {
      extracted[key] = match[1].trim();
    }
  }

  return normalizeConfig(extracted);
}

export function normalizeConfig(raw) {
  const projectId = String(raw.projectId || "").trim();
  const normalized = {
    apiKey: String(raw.apiKey || "").trim(),
    authDomain: String(raw.authDomain || (projectId ? `${projectId}.firebaseapp.com` : "")).trim(),
    projectId,
    storageBucket: String(raw.storageBucket || (projectId ? `${projectId}.firebasestorage.app` : "")).trim(),
    messagingSenderId: String(raw.messagingSenderId || "").trim(),
    appId: String(raw.appId || "").trim()
  };
  if (raw.measurementId) {
    normalized.measurementId = String(raw.measurementId).trim();
  }
  return normalized;
}

export function getActiveFirebaseConfig() {
  if (typeof window !== "undefined" && window.__CHITCHAT_FIREBASE_CONFIG__) {
    const cfg = normalizeConfig(window.__CHITCHAT_FIREBASE_CONFIG__);
    if (isFirebaseConfigValid(cfg)) {
      return { config: cfg, source: "window", isValid: true };
    }
  }

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = normalizeConfig(JSON.parse(saved));
        if (isFirebaseConfigValid(parsed)) {
          return { config: parsed, source: "localStorage", isValid: true };
        }
      }
    } catch (err) {
      console.warn("Unable to read saved Firebase config from localStorage:", err);
    }
  }

  const def = normalizeConfig(DEFAULT_FIREBASE_CONFIG);
  if (isFirebaseConfigValid(def)) {
    return { config: def, source: "default", isValid: true };
  }

  return { config: def, source: "unconfigured", isValid: false };
}

export function saveFirebaseConfigToStorage(input) {
  const cfg = typeof input === "string" ? parseFirebaseConfigInput(input) : normalizeConfig(input);
  if (!isFirebaseConfigValid(cfg)) {
    throw new Error(
      "Missing required Firebase fields. Ensure apiKey, authDomain, projectId, and appId are present."
    );
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  return cfg;
}

export function clearSavedFirebaseConfig() {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

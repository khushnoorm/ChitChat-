/**
 * Chit Chat — Main Application Controller & UI Router
 * ====================================================
 * Coordinates:
 * - View routing (Landing Page, Auth View, Chat Dashboard, Private Chat Window)
 * - Dark / Light / System Theme management
 * - Firebase Backend Configuration Wizard
 * - Authentication workflows (Sign Up, Log In, Password Reset, Email Verification)
 * - Real-time Conversation List, User Directory Search, and Unread Badges
 * - Real-time Private Messaging, E2EE Toggle, Replies, Editing, Deleting, Reactions,
 *   Validated Attachments, Typing Indicators, Block/Report Controls, and Settings
 */

import {
  getActiveFirebaseConfig,
  saveFirebaseConfigToStorage,
  clearSavedFirebaseConfig
} from "./firebase-config.js";
import {
  registerWithEmail,
  loginWithEmail,
  sendPasswordReset,
  resendVerificationEmail,
  reloadCurrentAuthUser,
  updateUserProfileData,
  rotateAndPublishUserKeys,
  logoutUser,
  subscribeToAuthChanges,
  mapAuthError,
  pickAvatarColor
} from "./auth.js";
import {
  searchUsersDirectory,
  getOrCreateDirectConversation,
  subscribeToConversations,
  subscribeToMessages,
  subscribeToUserProfile,
  sendChatMessage,
  markConversationMessagesRead,
  setTypingStatus,
  editOwnMessage,
  deleteOwnMessage,
  toggleMessageReaction,
  toggleConversationE2EE,
  toggleArchiveConversation,
  deleteConversationThread,
  toggleBlockUser,
  submitUserReport,
  validateAttachmentFile,
  compressImageFileToDataUrl,
  formatConversationTime,
  formatMessageClockTime,
  formatDateDivider,
  toDateObject
} from "./chat.js";
import { computePublicKeyFingerprint } from "./crypto.js";

const THEME_STORAGE_KEY = "chitchat_theme_pref_v1";

const EMOJI_LIST = [
  "😀", "😂", "🥹", "😊", "😍", "🤩", "😎",
  "🥳", "🤔", "🙌", "👍", "👏", "🙏", "🔥",
  "❤️", "💜", "✨", "🎉", "💯", "🚀", "✅",
  "👋", "🤝", "🫶", "🌟", "💬", "🔒", "📎"
];

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "🙏"];

const SWATCH_COLORS = [
  "#4f46e5",
  "#0ea5e9",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#14b8a6",
  "#ef4444"
];

const state = {
  page: document.body.dataset.page || "index",
  firebaseReady: false,
  currentUser: null,
  currentProfile: null,
  conversations: [],
  directoryUsers: [],
  activeFilter: "all",
  searchQuery: "",
  activeConversationId: null,
  activeConversation: null,
  activePeerProfile: null,
  messages: [],
  replyingToMessage: null,
  editingMessage: null,
  stagedAttachmentFile: null,
  selectedAvatarColor: "#4f46e5",
  selectedAvatarDataUrl: null,
  unsubAuth: null,
  unsubConversations: null,
  unsubMessages: null,
  unsubPeerProfile: null,
  typingTimeout: null,
  lastTypingSentAt: 0
};

function $(id) {
  return document.getElementById(id);
}

export function showToast(message, durationMs = 3800) {
  const container = $("toast-container");
  if (!container) return;

  const item = document.createElement("div");
  item.className = "toast-item";
  const textSpan = document.createElement("span");
  textSpan.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "✕";
  closeBtn.className = "icon-btn";
  closeBtn.style.width = "26px";
  closeBtn.style.height = "26px";
  closeBtn.addEventListener("click", () => item.remove());

  item.append(textSpan, closeBtn);
  container.appendChild(item);

  window.setTimeout(() => {
    if (item.parentNode) item.remove();
  }, durationMs);
}

function getInitials(nameOrUsername = "U") {
  const clean = String(nameOrUsername || "U").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase() || "U";
}

function renderAvatarElement(containerEl, profile, showPresence = false, isOnline = false) {
  if (!containerEl) return;
  containerEl.innerHTML = "";
  const bg = profile?.avatarColor || pickAvatarColor(profile?.uid || profile?.username || "u");
  containerEl.style.backgroundColor = bg;

  if (profile?.photoURL) {
    const img = document.createElement("img");
    img.src = profile.photoURL;
    img.alt = profile.displayName || "User avatar";
    img.addEventListener("error", () => {
      img.remove();
      const span = document.createElement("span");
      span.textContent = getInitials(profile?.displayName || profile?.username);
      containerEl.prepend(span);
    });
    containerEl.appendChild(img);
  } else {
    const span = document.createElement("span");
    span.textContent = getInitials(profile?.displayName || profile?.username);
    containerEl.appendChild(span);
  }

  if (showPresence) {
    const dot = document.createElement("span");
    dot.className = `avatar-presence${isOnline ? " online" : ""}`;
    containerEl.appendChild(dot);
  }
}

function getStoredThemePref() {
  return window.localStorage.getItem(THEME_STORAGE_KEY) || "dark";
}

function applyThemePreference(pref) {
  window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  let effective = pref;
  if (pref === "system") {
    const prefersLight =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    effective = prefersLight ? "light" : "dark";
  }
  document.documentElement.setAttribute("data-theme", effective);

  const iconChar = effective === "dark" ? "☀️" : "🌙";
  const navIcon = $("theme-icon-nav");
  const appIcon = $("theme-icon-app");
  if (navIcon) navIcon.textContent = iconChar;
  if (appIcon) appIcon.textContent = iconChar;

  const selectEl = $("settings-theme-select");
  if (selectEl && selectEl.value !== pref) {
    selectEl.value = pref;
  }
}

function toggleDarkLightTheme() {
  const currentAttr = document.documentElement.getAttribute("data-theme") || "dark";
  const next = currentAttr === "dark" ? "light" : "dark";
  applyThemePreference(next);
}

function switchMainView(viewName) {
  if (state.page === "login") return;

  const navbar = $("public-navbar");
  const landing = $("view-landing");
  const auth = $("view-auth");
  const workspace = $("view-workspace");

  if (viewName === "workspace") {
    navbar?.classList.add("hidden");
    landing?.classList.add("hidden");
    auth?.classList.add("hidden");
    workspace?.classList.remove("hidden");
    return;
  }

  workspace?.classList.add("hidden");
  navbar?.classList.remove("hidden");

  if (viewName === "auth") {
    landing?.classList.add("hidden");
    auth?.classList.remove("hidden");
  } else {
    auth?.classList.add("hidden");
    landing?.classList.remove("hidden");
  }
}

function switchAuthTab(mode) {
  const tabLogin = $("tab-login");
  const tabSignup = $("tab-signup");
  const tabReset = $("tab-reset");

  const formLogin = $("form-login");
  const formSignup = $("form-signup");
  const formReset = $("form-reset");

  const heading = $("auth-heading");
  const subheading = $("auth-subheading");
  hideAuthAlert();

  [tabLogin, tabSignup, tabReset].forEach((btn) => {
    if (!btn) return;
    btn.classList.remove("active");
    btn.setAttribute("aria-selected", "false");
  });
  [formLogin, formSignup, formReset].forEach((f) => f?.classList.add("hidden"));

  if (mode === "signup") {
    tabSignup?.classList.add("active");
    tabSignup?.setAttribute("aria-selected", "true");
    formSignup?.classList.remove("hidden");
    if (heading) heading.textContent = "Create Your Private Account";
    if (subheading) {
      subheading.textContent =
        "Set up your profile and ECDH encryption keys in seconds";
    }
  } else if (mode === "reset") {
    tabReset?.classList.add("active");
    tabReset?.setAttribute("aria-selected", "true");
    formReset?.classList.remove("hidden");
    if (heading) heading.textContent = "Reset Your Password";
    if (subheading) {
      subheading.textContent = "Receive a password reset link via email";
    }
  } else {
    tabLogin?.classList.add("active");
    tabLogin?.setAttribute("aria-selected", "true");
    formLogin?.classList.remove("hidden");
    if (heading) heading.textContent = "Welcome Back to Chit Chat";
    if (subheading) {
      subheading.textContent = "Sign in to access your private conversations";
    }
  }
}

function showAuthAlert(message, type = "error") {
  const box = $("auth-alert");
  if (!box) return;
  box.textContent = message;
  box.className = `alert-box alert-${type}`;
  box.classList.remove("hidden");
}

function hideAuthAlert() {
  const box = $("auth-alert");
  if (box) box.classList.add("hidden");
}

function updateFirebaseStatusBadge() {
  const { config, isValid } = getActiveFirebaseConfig();
  state.firebaseReady = isValid;

  const btn = $("btn-firebase-status");
  const dot = $("firebase-status-dot");
  const label = $("firebase-status-label");

  if (!btn || !dot || !label) return;

  if (isValid) {
    btn.className = "badge badge-connected";
    dot.className = "status-dot online";
    label.textContent = `Firebase: ${config.projectId}`;
  } else {
    btn.className = "badge badge-unconfigured";
    dot.className = "status-dot warning";
    label.textContent = "Setup Firebase";
  }
}

function openFirebaseConfigModal() {
  const modal = $("modal-firebase-config");
  const textarea = $("firebase-config-textarea");
  const alertEl = $("firebase-config-alert");
  if (!modal) return;

  alertEl?.classList.add("hidden");
  const { config, isValid } = getActiveFirebaseConfig();
  if (textarea && isValid) {
    textarea.value = JSON.stringify(config, null, 2);
  }
  modal.classList.remove("hidden");
}

function closeFirebaseConfigModal() {
  $("modal-firebase-config")?.classList.add("hidden");
}

async function handleSaveFirebaseConfig() {
  const textarea = $("firebase-config-textarea");
  const alertEl = $("firebase-config-alert");
  if (!textarea) return;

  try {
    const saved = saveFirebaseConfigToStorage(textarea.value);
    updateFirebaseStatusBadge();
    closeFirebaseConfigModal();
    showToast(`Connected to Firebase project: ${saved.projectId}`);
    await bootstrapFirebaseSession();
  } catch (err) {
    if (alertEl) {
      alertEl.textContent = err.message || "Invalid Firebase configuration.";
      alertEl.className = "alert-box alert-error";
      alertEl.classList.remove("hidden");
    }
  }
}

function handleClearFirebaseConfig() {
  clearSavedFirebaseConfig();
  const textarea = $("firebase-config-textarea");
  if (textarea) textarea.value = "";
  updateFirebaseStatusBadge();
  showToast("Cleared saved Firebase configuration from browser storage.");
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  hideAuthAlert();

  if (!state.firebaseReady) {
    showAuthAlert(
      "Firebase backend is not configured yet. Click '⚙️ Firebase Config' below to paste your Firebase project settings.",
      "info"
    );
    openFirebaseConfigModal();
    return;
  }

  const email = $("login-email")?.value || "";
  const password = $("login-password")?.value || "";
  const submitBtn = $("btn-submit-login");

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Signing in...";
    }
    await loginWithEmail(email, password);
    showToast("Signed in successfully.");
    if (state.page === "login") {
      window.location.href = "./index.html#workspace";
    }
  } catch (err) {
    showAuthAlert(mapAuthError(err), "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Log In";
    }
  }
}

async function handleSignupSubmit(event) {
  event.preventDefault();
  hideAuthAlert();

  if (!state.firebaseReady) {
    showAuthAlert(
      "Firebase backend is not configured yet. Click '⚙️ Firebase Config' below to connect your Firebase project first.",
      "info"
    );
    openFirebaseConfigModal();
    return;
  }

  const displayName = $("signup-name")?.value || "";
  const username = $("signup-username")?.value || "";
  const email = $("signup-email")?.value || "";
  const password = $("signup-password")?.value || "";
  const confirmPassword = $("signup-confirm")?.value || "";
  const bio = $("signup-bio")?.value || "";
  const submitBtn = $("btn-submit-signup");

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating account...";
    }
    const { verificationSent } = await registerWithEmail({
      displayName,
      username,
      email,
      password,
      confirmPassword,
      bio
    });

    showToast(
      verificationSent
        ? "Account created! Check your inbox for the verification email."
        : "Account created and signed in!"
    );

    if (state.page === "login") {
      window.location.href = "./index.html#workspace";
    }
  } catch (err) {
    showAuthAlert(mapAuthError(err), "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create Account & Verify Email";
    }
  }
}

async function handleResetSubmit(event) {
  event.preventDefault();
  hideAuthAlert();

  if (!state.firebaseReady) {
    showAuthAlert(
      "Firebase backend is not configured yet. Configure Firebase first.",
      "info"
    );
    openFirebaseConfigModal();
    return;
  }

  const email = $("reset-email")?.value || "";
  const submitBtn = $("btn-submit-reset");

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending reset link...";
    }
    await sendPasswordReset(email);
    showAuthAlert(
      "Password reset link sent! Check your email inbox and spam folder.",
      "success"
    );
  } catch (err) {
    showAuthAlert(mapAuthError(err), "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send Password Reset Email";
    }
  }
}

function syncCurrentUserHeader() {
  const profile = state.currentProfile;
  if (!profile) return;

  renderAvatarElement($("current-user-avatar"), profile, true, true);
  const nameEl = $("current-user-name");
  const handleEl = $("current-user-handle");
  if (nameEl) nameEl.textContent = profile.displayName || "User";
  if (handleEl) handleEl.textContent = `@${profile.username || "user"}`;

  const verifyBanner = $("email-verification-banner");
  if (verifyBanner) {
    if (state.currentUser && !state.currentUser.emailVerified) {
      verifyBanner.classList.remove("hidden");
    } else {
      verifyBanner.classList.add("hidden");
    }
  }
}

function updateUnreadIndicators() {
  const totalUnread = state.conversations.reduce(
    (sum, c) => sum + (c.isArchived ? 0 : c.unreadCount || 0),
    0
  );
  const unreadFilterBadge = $("filter-unread-count");
  if (unreadFilterBadge) {
    unreadFilterBadge.textContent = totalUnread > 0 ? `(${totalUnread})` : "";
  }
  document.title =
    totalUnread > 0
      ? `(${totalUnread}) Chit Chat — Private Messaging`
      : "Chit Chat — Private Messaging";
}

function renderSidebarList() {
  const listEl = $("conversation-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  const q = state.searchQuery.trim().toLowerCase().replace(/^@/, "");

  if (state.activeFilter === "directory") {
    if (state.directoryUsers.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-list-state";
      empty.textContent = q
        ? `No users found matching "${state.searchQuery}".`
        : "No other registered users found in the directory yet.";
      listEl.appendChild(empty);
      return;
    }

    state.directoryUsers.forEach((u) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "conv-item";

      const av = document.createElement("div");
      av.className = "avatar";
      const showOnline = u.showOnlineStatus !== false && Boolean(u.isOnline);
      renderAvatarElement(av, u, true, showOnline);

      const body = document.createElement("div");
      body.className = "conv-item-body";

      const top = document.createElement("div");
      top.className = "conv-item-top";
      const title = document.createElement("span");
      title.className = "conv-item-title";
      title.textContent = u.displayName || "User";
      const handle = document.createElement("span");
      handle.className = "conv-item-time";
      handle.textContent = `@${u.username || "user"}`;
      top.append(title, handle);

      const bottom = document.createElement("div");
      bottom.className = "conv-item-bottom";
      const bio = document.createElement("span");
      bio.className = "conv-item-preview";
      bio.textContent = u.bio || "Tap to start a private conversation";
      bottom.appendChild(bio);

      body.append(top, bottom);
      btn.append(av, body);

      btn.addEventListener("click", () => startConversationWithUser(u));
      listEl.appendChild(btn);
    });
    return;
  }

  const filtered = state.conversations.filter((conv) => {
    if (state.activeFilter === "archived") {
      if (!conv.isArchived) return false;
    } else {
      if (conv.isArchived) return false;
    }

    if (state.activeFilter === "unread" && (!conv.unreadCount || conv.unreadCount <= 0)) {
      return false;
    }

    if (q) {
      const name = String(conv.peerProfile?.displayName || "").toLowerCase();
      const uname = String(conv.peerProfile?.username || "").toLowerCase();
      const preview = String(conv.lastMessage?.text || "").toLowerCase();
      return name.includes(q) || uname.includes(q) || preview.includes(q);
    }
    return true;
  });

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-list-state";
    if (state.activeFilter === "unread") {
      empty.textContent = "You're all caught up! No unread messages.";
    } else if (state.activeFilter === "archived") {
      empty.textContent = "No archived conversations.";
    } else {
      empty.innerHTML =
        'No private chats yet. Tap <strong>Find Users</strong> or <strong>➕</strong> to start messaging.';
    }
    listEl.appendChild(empty);
    return;
  }

  filtered.forEach((conv) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `conv-item${conv.id === state.activeConversationId ? " active" : ""}${
      conv.unreadCount > 0 ? " unread" : ""
    }`;

    const av = document.createElement("div");
    av.className = "avatar";
    renderAvatarElement(av, conv.peerProfile, false, false);

    const body = document.createElement("div");
    body.className = "conv-item-body";

    const top = document.createElement("div");
    top.className = "conv-item-top";

    const title = document.createElement("span");
    title.className = "conv-item-title";
    title.textContent = conv.peerProfile?.displayName || "Private Contact";

    const time = document.createElement("span");
    time.className = "conv-item-time";
    time.textContent = formatConversationTime(
      conv.lastMessage?.createdAt || conv.updatedAt
    );
    top.append(title, time);

    const bottom = document.createElement("div");
    bottom.className = "conv-item-bottom";

    const preview = document.createElement("span");
    preview.className = "conv-item-preview";
    const peerTypingTs = conv.typing ? conv.typing[conv.peerUid] || 0 : 0;
    const isPeerTyping = Date.now() - peerTypingTs < 6000;

    if (isPeerTyping) {
      preview.textContent = "✍️ typing...";
      preview.style.color = "var(--accent-secondary)";
    } else if (conv.lastMessage) {
      const prefix =
        conv.lastMessage.senderId === state.currentUser?.uid ? "You: " : "";
      preview.textContent = `${prefix}${conv.lastMessage.text || "Sent a message"}`;
    } else {
      preview.textContent = "No messages yet — say hello!";
    }
    bottom.appendChild(preview);

    if (conv.unreadCount > 0) {
      const badge = document.createElement("span");
      badge.className = "unread-badge";
      badge.textContent = conv.unreadCount > 99 ? "99+" : String(conv.unreadCount);
      bottom.appendChild(badge);
    }

    body.append(top, bottom);
    btn.append(av, body);

    btn.addEventListener("click", () => selectConversation(conv.id));
    listEl.appendChild(btn);
  });
}

async function refreshUserDirectory() {
  if (!state.currentUser) return;
  try {
    state.directoryUsers = await searchUsersDirectory(
      state.searchQuery,
      state.currentUser.uid
    );
    renderSidebarList();
  } catch (err) {
    console.warn("Directory search error:", err);
  }
}

async function startConversationWithUser(peerUser) {
  if (!state.currentProfile) return;
  try {
    const conv = await getOrCreateDirectConversation(state.currentProfile, peerUser);
    setActiveFilter("all");
    await selectConversation(conv.id, conv);
  } catch (err) {
    showToast(err.message || "Could not start conversation.");
  }
}

function setActiveFilter(filterName) {
  state.activeFilter = filterName;
  document.querySelectorAll(".filter-pill").forEach((pill) => {
    const isMatch = pill.dataset.filter === filterName;
    pill.classList.toggle("active", isMatch);
    pill.setAttribute("aria-selected", String(isMatch));
  });

  if (filterName === "directory") {
    refreshUserDirectory();
  } else {
    renderSidebarList();
  }
}

async function selectConversation(conversationId, fallbackConv = null) {
  state.activeConversationId = conversationId;
  state.replyingToMessage = null;
  state.editingMessage = null;
  clearStagedAttachment();
  renderComposerContextBar();

  const conv =
    state.conversations.find((c) => c.id === conversationId) || fallbackConv;
  state.activeConversation = conv || null;

  renderSidebarList();

  const mainGrid = $("workspace-main-grid");
  const emptyState = $("chat-empty-state");
  const activeContainer = $("active-chat-container");

  if (!conv) {
    mainGrid?.classList.remove("mobile-chat-open");
    emptyState?.classList.remove("hidden");
    activeContainer?.classList.add("hidden");
    return;
  }

  mainGrid?.classList.add("mobile-chat-open");
  emptyState?.classList.add("hidden");
  activeContainer?.classList.remove("hidden");

  if (state.unsubMessages) {
    state.unsubMessages();
    state.unsubMessages = null;
  }
  if (state.unsubPeerProfile) {
    state.unsubPeerProfile();
    state.unsubPeerProfile = null;
  }

  const peerUid =
    conv.peerUid ||
    (conv.participants || []).find((id) => id !== state.currentUser?.uid);
  state.activePeerProfile = conv.peerProfile || { uid: peerUid, displayName: "Contact" };

  updateChatHeaderUI();

  state.unsubPeerProfile = await subscribeToUserProfile(peerUid, (livePeer) => {
    state.activePeerProfile = livePeer;
    updateChatHeaderUI();
  });

  state.unsubMessages = await subscribeToMessages(
    conversationId,
    state.currentUser.uid,
    state.activePeerProfile?.publicKeyJwk,
    (messages) => {
      state.messages = messages;
      renderMessagesList();
      markConversationMessagesRead(
        conversationId,
        state.currentUser.uid,
        messages,
        state.currentProfile?.readReceipts !== false
      );
    },
    (err) => {
      showToast(mapAuthError(err));
    }
  );
}

function updateChatHeaderUI() {
  const conv = state.activeConversation;
  const peer = state.activePeerProfile;
  if (!conv || !peer) return;

  const isOnline = peer.showOnlineStatus !== false && Boolean(peer.isOnline);
  renderAvatarElement($("chat-peer-avatar"), peer, true, isOnline);

  const nameEl = $("chat-peer-name");
  if (nameEl) {
    nameEl.textContent = `${peer.displayName || "Contact"} (@${peer.username || "user"})`;
  }

  const statusEl = $("chat-peer-status");
  const peerTypingTs = conv.typing ? conv.typing[peer.uid] || 0 : 0;
  const isPeerTyping = Date.now() - peerTypingTs < 6000;

  if (statusEl) {
    if (isPeerTyping) {
      statusEl.textContent = "✍️ typing a message...";
      statusEl.className = "chat-peer-status typing";
    } else if (isOnline) {
      statusEl.textContent = "● Online now";
      statusEl.className = "chat-peer-status";
    } else if (peer.showOnlineStatus !== false && peer.lastSeen) {
      const lastSeenDate = toDateObject(peer.lastSeen);
      statusEl.textContent = lastSeenDate
        ? `Last seen ${formatConversationTime(lastSeenDate)} at ${formatMessageClockTime(lastSeenDate)}`
        : "Offline";
      statusEl.className = "chat-peer-status";
    } else {
      statusEl.textContent = "Private Contact";
      statusEl.className = "chat-peer-status";
    }
  }

  const e2eeBtn = $("btn-toggle-e2ee");
  const secDesc = $("chat-security-description");
  const canUseE2EE = Boolean(
    peer.publicKeyJwk && state.currentProfile?.publicKeyJwk
  );

  if (conv.e2eeEnabled && canUseE2EE) {
    if (e2eeBtn) e2eeBtn.textContent = "🔒 E2EE Active";
    if (secDesc) {
      secDesc.textContent =
        "🔒 WebCrypto End-to-End Encrypted (ECDH P-256 + AES-256-GCM).";
    }
  } else {
    if (e2eeBtn) e2eeBtn.textContent = "🛡️ Standard";
    if (secDesc) {
      secDesc.textContent =
        "🛡️ Protected by Cloud Firestore Participant Security Rules & TLS.";
    }
  }

  const blockedBanner = $("blocked-conversation-banner");
  const unblockBtn = $("btn-unblock-banner");
  const composerForm = $("chat-composer-form");

  if (conv.isBlocked) {
    blockedBanner?.classList.remove("hidden");
    composerForm?.classList.add("hidden");
    if (unblockBtn) {
      unblockBtn.classList.toggle("hidden", !conv.isBlockedByMe);
    }
  } else {
    blockedBanner?.classList.add("hidden");
    composerForm?.classList.remove("hidden");
  }
}

function renderMessagesList() {
  const stream = $("messages-stream");
  if (!stream) return;
  stream.innerHTML = "";

  if (state.messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-list-state";
    empty.textContent =
      "No messages in this conversation yet. Send a message below to start chatting privately.";
    stream.appendChild(empty);
    return;
  }

  let lastDateLabel = "";

  state.messages.forEach((msg) => {
    const dateLabel = formatDateDivider(msg.createdAt);
    if (dateLabel !== lastDateLabel) {
      lastDateLabel = dateLabel;
      const divider = document.createElement("div");
      divider.className = "date-divider";
      divider.textContent = dateLabel;
      stream.appendChild(divider);
    }

    const isOutgoing = msg.senderId === state.currentUser?.uid;
    const row = document.createElement("div");
    row.className = `message-row ${isOutgoing ? "outgoing" : "incoming"}`;

    const bubble = document.createElement("div");
    bubble.className = `message-bubble${msg.deleted ? " deleted" : ""}`;

    if (msg.replyTo && !msg.deleted) {
      const quote = document.createElement("div");
      quote.className = "message-reply-quote";
      const qSender = document.createElement("div");
      qSender.className = "message-reply-sender";
      qSender.textContent = msg.replyTo.senderName || "Message";
      const qText = document.createElement("div");
      qText.textContent = msg.replyTo.textPreview || "";
      quote.append(qSender, qText);
      bubble.appendChild(quote);
    }

    if (msg.attachment && !msg.deleted) {
      const attWrap = document.createElement("div");
      attWrap.className = "message-attachment";

      if (String(msg.attachment.type || "").startsWith("image/")) {
        const img = document.createElement("img");
        img.src = msg.attachment.url;
        img.alt = msg.attachment.name || "Attached image";
        img.loading = "lazy";
        img.addEventListener("click", () =>
          window.open(msg.attachment.url, "_blank", "noopener,noreferrer")
        );
        attWrap.appendChild(img);
      } else {
        const link = document.createElement("a");
        link.href = msg.attachment.url;
        link.download = msg.attachment.name || "attachment";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "file-attachment-chip";
        const sizeKb = Math.max(1, Math.round((msg.attachment.size || 0) / 1024));
        link.textContent = `📄 ${msg.attachment.name} (${sizeKb} KB)`;
        attWrap.appendChild(link);
      }
      bubble.appendChild(attWrap);
    }

    if (msg.displayText) {
      const textDiv = document.createElement("div");
      textDiv.textContent = msg.displayText;
      bubble.appendChild(textDiv);
    }

    const footer = document.createElement("div");
    footer.className = "message-footer";

    if (msg.encrypted && !msg.deleted) {
      const lockSpan = document.createElement("span");
      lockSpan.textContent = "🔒 E2EE";
      lockSpan.title = "Encrypted client-side with ECDH P-256 + AES-256-GCM";
      footer.appendChild(lockSpan);
    }

    if (msg.edited && !msg.deleted) {
      const editSpan = document.createElement("span");
      editSpan.textContent = "(edited)";
      footer.appendChild(editSpan);
    }

    const timeSpan = document.createElement("span");
    timeSpan.textContent = formatMessageClockTime(msg.createdAt);
    footer.appendChild(timeSpan);

    if (isOutgoing && !msg.deleted) {
      const receipt = document.createElement("span");
      receipt.className = `receipt-icon ${msg.status === "read" ? "read" : ""}`;
      if (msg.status === "read") {
        receipt.textContent = "✓✓ Read";
      } else if (msg.status === "delivered") {
        receipt.textContent = "✓✓";
      } else {
        receipt.textContent = "✓";
      }
      footer.appendChild(receipt);
    }

    bubble.appendChild(footer);
    row.appendChild(bubble);

    const reactionsObj = msg.reactions || {};
    const reactionEntries = Object.entries(reactionsObj);
    if (reactionEntries.length > 0 && !msg.deleted) {
      const reactBar = document.createElement("div");
      reactBar.className = "message-reactions";
      const counts = {};
      reactionEntries.forEach(([, emoji]) => {
        counts[emoji] = (counts[emoji] || 0) + 1;
      });
      Object.entries(counts).forEach(([emoji, count]) => {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = "reaction-pill";
        pill.textContent = `${emoji} ${count}`;
        pill.addEventListener("click", () =>
          toggleMessageReaction(
            state.activeConversationId,
            msg,
            state.currentUser.uid,
            emoji
          )
        );
        reactBar.appendChild(pill);
      });
      row.appendChild(reactBar);
    }

    if (!msg.deleted) {
      const actions = document.createElement("div");
      actions.className = "message-actions-bar";

      const replyBtn = document.createElement("button");
      replyBtn.type = "button";
      replyBtn.className = "msg-action-btn";
      replyBtn.textContent = "↩ Reply";
      replyBtn.addEventListener("click", () => startReplyToMessage(msg));
      actions.appendChild(replyBtn);

      QUICK_REACTIONS.slice(0, 3).forEach((emoji) => {
        const rBtn = document.createElement("button");
        rBtn.type = "button";
        rBtn.className = "msg-action-btn";
        rBtn.textContent = emoji;
        rBtn.addEventListener("click", () =>
          toggleMessageReaction(
            state.activeConversationId,
            msg,
            state.currentUser.uid,
            emoji
          )
        );
        actions.appendChild(rBtn);
      });

      if (isOutgoing) {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "msg-action-btn";
        editBtn.textContent = "✎ Edit";
        editBtn.addEventListener("click", () => startEditingMessage(msg));

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "msg-action-btn";
        delBtn.textContent = "🗑 Delete";
        delBtn.addEventListener("click", () => handleDeleteMessage(msg));

        actions.append(editBtn, delBtn);
      }

      row.appendChild(actions);
    }

    stream.appendChild(row);
  });

  stream.scrollTop = stream.scrollHeight;
}

function startReplyToMessage(msg) {
  state.editingMessage = null;
  state.replyingToMessage = {
    messageId: msg.id,
    senderId: msg.senderId,
    senderName: msg.senderName || "User",
    textPreview: (msg.displayText || "Attachment").slice(0, 200)
  };
  renderComposerContextBar();
  $("chat-message-input")?.focus();
}

function startEditingMessage(msg) {
  state.replyingToMessage = null;
  state.editingMessage = msg;
  renderComposerContextBar();
  const input = $("chat-message-input");
  if (input) {
    input.value = msg.displayText || "";
    updateComposerCharCount();
    input.focus();
  }
}

function cancelComposerContext() {
  state.replyingToMessage = null;
  state.editingMessage = null;
  renderComposerContextBar();
}

function renderComposerContextBar() {
  const bar = $("composer-context-bar");
  const title = $("composer-context-title");
  const text = $("composer-context-text");
  if (!bar || !title || !text) return;

  if (state.editingMessage) {
    bar.classList.remove("hidden");
    title.textContent = "✎ Editing your message";
    text.textContent = state.editingMessage.displayText || "";
  } else if (state.replyingToMessage) {
    bar.classList.remove("hidden");
    title.textContent = `↩ Replying to ${state.replyingToMessage.senderName}`;
    text.textContent = state.replyingToMessage.textPreview;
  } else {
    bar.classList.add("hidden");
  }
}

function handleAttachmentSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    validateAttachmentFile(file);
    state.stagedAttachmentFile = file;
    const bar = $("attachment-preview-bar");
    const nameEl = $("attachment-preview-name");
    const sizeKb = Math.max(1, Math.round(file.size / 1024));
    if (nameEl) nameEl.textContent = `${file.name} (${sizeKb} KB)`;
    bar?.classList.remove("hidden");
  } catch (err) {
    showToast(err.message || "Invalid attachment.");
    event.target.value = "";
  }
}

function clearStagedAttachment() {
  state.stagedAttachmentFile = null;
  const input = $("chat-attachment-input");
  if (input) input.value = "";
  $("attachment-preview-bar")?.classList.add("hidden");
}

function updateComposerCharCount() {
  const input = $("chat-message-input");
  const countEl = $("composer-char-count");
  if (!input || !countEl) return;
  const len = input.value.length;
  countEl.textContent = `${len} / 4000`;
}

async function handleSendMessageSubmit(event) {
  event.preventDefault();
  if (!state.activeConversation || !state.currentProfile) return;

  const input = $("chat-message-input");
  const sendBtn = $("btn-send-message");
  const rawText = input ? input.value : "";

  try {
    if (sendBtn) sendBtn.disabled = true;

    if (state.editingMessage) {
      await editOwnMessage({
        conversation: state.activeConversation,
        message: state.editingMessage,
        newText: rawText,
        currentUid: state.currentUser.uid,
        peerPublicKeyJwk: state.activePeerProfile?.publicKeyJwk
      });
      state.editingMessage = null;
      renderComposerContextBar();
      if (input) input.value = "";
      updateComposerCharCount();
      showToast("Message updated.");
      return;
    }

    await sendChatMessage({
      conversation: state.activeConversation,
      currentUser: state.currentProfile,
      peerProfile: state.activePeerProfile,
      text: rawText,
      attachmentFile: state.stagedAttachmentFile,
      replyTo: state.replyingToMessage
    });

    if (input) input.value = "";
    updateComposerCharCount();
    state.replyingToMessage = null;
    renderComposerContextBar();
    clearStagedAttachment();
  } catch (err) {
    showToast(err.message || "Failed to send message.");
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

async function handleDeleteMessage(msg) {
  if (!state.activeConversationId || !state.currentUser) return;
  try {
    await deleteOwnMessage(state.activeConversationId, msg, state.currentUser.uid);
    showToast("Message deleted.");
  } catch (err) {
    showToast(err.message || "Failed to delete message.");
  }
}

async function handleToggleE2EE() {
  if (!state.activeConversation) return;
  const nextState = !state.activeConversation.e2eeEnabled;
  if (
    nextState &&
    (!state.activePeerProfile?.publicKeyJwk || !state.currentProfile?.publicKeyJwk)
  ) {
    showToast(
      "Peer's WebCrypto ECDH public key is not available yet. Ask them to sign in once to publish their key."
    );
    return;
  }

  try {
    await toggleConversationE2EE(state.activeConversation.id, nextState);
    state.activeConversation.e2eeEnabled = nextState;
    updateChatHeaderUI();
    showToast(
      nextState
        ? "🔒 Enabled WebCrypto ECDH P-256 + AES-256-GCM encryption for this conversation."
        : "Switched conversation to Standard Firestore Rules + TLS mode."
    );
  } catch (err) {
    showToast(err.message || "Could not toggle encryption mode.");
  }
}

async function openSecurityVerificationModal() {
  const modal = $("modal-security-info");
  if (!modal) return;

  const badge = $("security-modal-mode-badge");
  const myFp = $("security-modal-my-fp");
  const peerFp = $("security-modal-peer-fp");

  const isE2EE = Boolean(
    state.activeConversation?.e2eeEnabled &&
      state.activePeerProfile?.publicKeyJwk &&
      state.currentProfile?.publicKeyJwk
  );

  if (badge) {
    badge.textContent = isE2EE
      ? "🔒 WebCrypto E2EE Active (ECDH P-256 + AES-256-GCM)"
      : "🛡️ Standard Mode (Firestore Participant Rules + TLS)";
  }

  if (myFp) {
    myFp.textContent = state.currentProfile?.publicKeyJwk
      ? await computePublicKeyFingerprint(state.currentProfile.publicKeyJwk)
      : "No local keypair generated";
  }

  if (peerFp) {
    peerFp.textContent = state.activePeerProfile?.publicKeyJwk
      ? await computePublicKeyFingerprint(state.activePeerProfile.publicKeyJwk)
      : "Contact has not published an ECDH public key yet";
  }

  modal.classList.remove("hidden");
}

async function handleArchiveConversation() {
  if (!state.activeConversation || !state.currentUser) return;
  try {
    const nowArchived = await toggleArchiveConversation(
      state.activeConversation,
      state.currentUser.uid
    );
    showToast(
      nowArchived ? "Conversation archived." : "Conversation unarchived."
    );
  } catch (err) {
    showToast(err.message || "Could not update archive status.");
  }
}

async function handleToggleBlockPeer() {
  if (!state.activeConversation || !state.currentUser || !state.activePeerProfile) {
    return;
  }
  try {
    const nowBlocked = await toggleBlockUser(
      state.activeConversation,
      state.currentUser.uid,
      state.activePeerProfile.uid
    );
    showToast(
      nowBlocked
        ? `Blocked @${state.activePeerProfile.username || "user"}.`
        : `Unblocked @${state.activePeerProfile.username || "user"}.`
    );
  } catch (err) {
    showToast(err.message || "Failed to update block status.");
  }
}

async function handleDeleteConversation() {
  if (!state.activeConversation) return;
  try {
    await deleteConversationThread(state.activeConversation.id);
    state.activeConversationId = null;
    state.activeConversation = null;
    $("workspace-main-grid")?.classList.remove("mobile-chat-open");
    $("chat-empty-state")?.classList.remove("hidden");
    $("active-chat-container")?.classList.add("hidden");
    showToast("Conversation deleted.");
  } catch (err) {
    showToast(err.message || "Could not delete conversation.");
  }
}

async function handleReportSubmit(event) {
  event.preventDefault();
  if (!state.currentUser || !state.activePeerProfile) return;

  const reason = $("report-reason")?.value || "";
  const details = $("report-details")?.value || "";
  const alsoBlock = Boolean($("report-also-block")?.checked);

  try {
    await submitUserReport({
      reporterUid: state.currentUser.uid,
      reportedUserId: state.activePeerProfile.uid,
      conversationId: state.activeConversationId,
      reason,
      details
    });

    if (alsoBlock && !state.activeConversation?.isBlockedByMe) {
      await toggleBlockUser(
        state.activeConversation,
        state.currentUser.uid,
        state.activePeerProfile.uid
      );
    }

    $("modal-report")?.classList.add("hidden");
    if ($("report-details")) $("report-details").value = "";
    showToast("Safety report submitted. Thank you for keeping Chit Chat safe.");
  } catch (err) {
    showToast(err.message || "Could not submit report.");
  }
}

function renderColorSwatches() {
  const row = $("settings-color-swatches");
  if (!row) return;
  row.innerHTML = "";

  SWATCH_COLORS.forEach((hex) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `color-swatch${state.selectedAvatarColor === hex ? " active" : ""}`;
    btn.style.backgroundColor = hex;
    btn.setAttribute("aria-label", `Select avatar color ${hex}`);
    btn.addEventListener("click", () => {
      state.selectedAvatarColor = hex;
      renderColorSwatches();
      renderAvatarElement(
        $("settings-avatar-preview"),
        {
          ...state.currentProfile,
          photoURL:
            state.selectedAvatarDataUrl !== null
              ? state.selectedAvatarDataUrl
              : state.currentProfile?.photoURL,
          avatarColor: hex
        },
        false,
        false
      );
    });
    row.appendChild(btn);
  });
}

function openSettingsModal() {
  const profile = state.currentProfile;
  const modal = $("modal-settings");
  if (!modal || !profile) return;

  $("settings-alert")?.classList.add("hidden");
  state.selectedAvatarColor =
    profile.avatarColor || pickAvatarColor(profile.uid);
  state.selectedAvatarDataUrl = null;

  renderAvatarElement($("settings-avatar-preview"), profile, false, false);
  renderColorSwatches();

  if ($("settings-display-name")) {
    $("settings-display-name").value = profile.displayName || "";
  }
  if ($("settings-username")) {
    $("settings-username").value = profile.username || "";
  }
  if ($("settings-bio")) {
    $("settings-bio").value = profile.bio || "";
  }
  if ($("settings-email-display")) {
    $("settings-email-display").textContent =
      state.currentUser?.email || profile.email || "";
  }

  const emailBadge = $("settings-email-badge");
  if (emailBadge) {
    const verified = Boolean(state.currentUser?.emailVerified);
    emailBadge.textContent = verified ? "✓ Verified" : "Unverified";
    emailBadge.className = verified
      ? "badge badge-connected"
      : "badge badge-unconfigured";
  }

  if ($("toggle-online-status")) {
    $("toggle-online-status").checked = profile.showOnlineStatus !== false;
  }
  if ($("toggle-read-receipts")) {
    $("toggle-read-receipts").checked = profile.readReceipts !== false;
  }

  const prefs = profile.notificationPrefs || {};
  if ($("toggle-browser-notifications")) {
    $("toggle-browser-notifications").checked = Boolean(prefs.browserNotifications);
  }
  if ($("toggle-sound-effects")) {
    $("toggle-sound-effects").checked = prefs.soundEffects !== false;
  }
  if ($("toggle-message-preview")) {
    $("toggle-message-preview").checked = prefs.showMessagePreview !== false;
  }

  if ($("settings-key-fingerprint")) {
    $("settings-key-fingerprint").textContent =
      profile.keyFingerprint || "Available once signed in";
  }

  modal.classList.remove("hidden");
}

async function handleSaveSettingsProfile() {
  if (!state.currentUser) return;
  const alertEl = $("settings-alert");
  const saveBtn = $("btn-save-profile");

  try {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
    }

    const updated = await updateUserProfileData(state.currentUser.uid, {
      displayName: $("settings-display-name")?.value,
      username: $("settings-username")?.value,
      bio: $("settings-bio")?.value,
      avatarColor: state.selectedAvatarColor,
      photoURL:
        state.selectedAvatarDataUrl !== null
          ? state.selectedAvatarDataUrl
          : state.currentProfile?.photoURL || "",
      showOnlineStatus: Boolean($("toggle-online-status")?.checked),
      readReceipts: Boolean($("toggle-read-receipts")?.checked),
      notificationPrefs: {
        browserNotifications: Boolean($("toggle-browser-notifications")?.checked),
        soundEffects: Boolean($("toggle-sound-effects")?.checked),
        showMessagePreview: Boolean($("toggle-message-preview")?.checked)
      }
    });

    state.currentProfile = {
      ...state.currentProfile,
      ...updated
    };
    syncCurrentUserHeader();
    showToast("Profile and privacy settings saved.");
    $("modal-settings")?.classList.add("hidden");
  } catch (err) {
    if (alertEl) {
      alertEl.textContent = mapAuthError(err);
      alertEl.className = "alert-box alert-error";
      alertEl.classList.remove("hidden");
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Profile Changes";
    }
  }
}

async function bootstrapFirebaseSession() {
  updateFirebaseStatusBadge();

  if (state.unsubAuth) {
    state.unsubAuth();
    state.unsubAuth = null;
  }

  state.unsubAuth = await subscribeToAuthChanges(async ({ ready, user, profile }) => {
    state.firebaseReady = ready;
    state.currentUser = user;
    state.currentProfile = profile;
    updateFirebaseStatusBadge();

    if (state.unsubConversations) {
      state.unsubConversations();
      state.unsubConversations = null;
    }

    if (user && profile) {
      if (state.page === "login") {
        window.location.href = "./index.html#workspace";
        return;
      }

      switchMainView("workspace");
      syncCurrentUserHeader();

      state.unsubConversations = await subscribeToConversations(
        user.uid,
        (convList) => {
          state.conversations = convList;
          updateUnreadIndicators();
          if (state.activeConversationId) {
            const refreshed = convList.find(
              (c) => c.id === state.activeConversationId
            );
            if (refreshed) {
              state.activeConversation = refreshed;
              updateChatHeaderUI();
            }
          }
          renderSidebarList();
        },
        (err) => {
          showToast(mapAuthError(err));
        }
      );
    } else {
      if (state.page === "index") {
        const hash = window.location.hash;
        if (hash === "#auth" || hash === "#login" || hash === "#signup") {
          switchMainView("auth");
          if (hash === "#signup") switchAuthTab("signup");
        } else {
          switchMainView("landing");
        }
      }
    }
  });
}

function initEmojiPicker() {
  const grid = $("emoji-grid");
  const popover = $("emoji-popover");
  const trigger = $("btn-emoji-picker");
  const input = $("chat-message-input");
  if (!grid || !popover || !trigger) return;

  grid.innerHTML = "";
  EMOJI_LIST.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emoji-item-btn";
    btn.textContent = emoji;
    btn.addEventListener("click", () => {
      if (input) {
        input.value += emoji;
        updateComposerCharCount();
        input.focus();
      }
      popover.classList.add("hidden");
    });
    grid.appendChild(btn);
  });

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    popover.classList.toggle("hidden");
  });

  document.addEventListener("click", (e) => {
    if (!popover.contains(e.target) && e.target !== trigger) {
      popover.classList.add("hidden");
    }
  });
}

function bindDOMEvents() {
  applyThemePreference(getStoredThemePref());
  $("btn-theme-toggle-nav")?.addEventListener("click", toggleDarkLightTheme);
  $("btn-theme-toggle-app")?.addEventListener("click", toggleDarkLightTheme);
  $("settings-theme-select")?.addEventListener("change", (e) =>
    applyThemePreference(e.target.value)
  );

  $("nav-brand-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (state.currentUser) {
      switchMainView("workspace");
    } else {
      switchMainView("landing");
    }
  });

  $("nav-btn-login")?.addEventListener("click", () => {
    switchMainView("auth");
    switchAuthTab("login");
  });
  $("nav-btn-signup")?.addEventListener("click", () => {
    switchMainView("auth");
    switchAuthTab("signup");
  });
  $("hero-btn-login")?.addEventListener("click", () => {
    switchMainView("auth");
    switchAuthTab("login");
  });
  $("hero-btn-signup")?.addEventListener("click", () => {
    switchMainView("auth");
    switchAuthTab("signup");
  });
  $("footer-link-auth")?.addEventListener("click", (e) => {
    e.preventDefault();
    switchMainView("auth");
    switchAuthTab("login");
  });
  $("auth-back-landing")?.addEventListener("click", () =>
    switchMainView("landing")
  );

  $("tab-login")?.addEventListener("click", () => switchAuthTab("login"));
  $("tab-signup")?.addEventListener("click", () => switchAuthTab("signup"));
  $("tab-reset")?.addEventListener("click", () => switchAuthTab("reset"));

  document.querySelectorAll("[data-toggle-password]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-toggle-password");
      const input = $(targetId);
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
    });
  });

  $("form-login")?.addEventListener("submit", handleLoginSubmit);
  $("form-signup")?.addEventListener("submit", handleSignupSubmit);
  $("form-reset")?.addEventListener("submit", handleResetSubmit);

  $("btn-firebase-status")?.addEventListener("click", openFirebaseConfigModal);
  $("hero-btn-config")?.addEventListener("click", openFirebaseConfigModal);
  $("footer-btn-config")?.addEventListener("click", openFirebaseConfigModal);
  $("auth-open-config")?.addEventListener("click", openFirebaseConfigModal);
  $("btn-settings-firebase")?.addEventListener("click", () => {
    $("modal-settings")?.classList.add("hidden");
    openFirebaseConfigModal();
  });
  $("btn-close-firebase-modal")?.addEventListener(
    "click",
    closeFirebaseConfigModal
  );
  $("btn-save-firebase-config")?.addEventListener(
    "click",
    handleSaveFirebaseConfig
  );
  $("btn-clear-firebase-config")?.addEventListener(
    "click",
    handleClearFirebaseConfig
  );

  $("btn-resend-verification")?.addEventListener("click", async () => {
    try {
      await resendVerificationEmail();
      showToast("Verification email sent! Check your inbox.");
    } catch (err) {
      showToast(mapAuthError(err));
    }
  });

  $("btn-refresh-verification")?.addEventListener("click", async () => {
    try {
      const res = await reloadCurrentAuthUser();
      if (res?.user?.emailVerified) {
        state.currentUser = res.user;
        state.currentProfile = res.profile;
        syncCurrentUserHeader();
        showToast("Email verified! Thank you.");
      } else {
        showToast("Email not marked verified yet. Click the link in your email first.");
      }
    } catch (err) {
      showToast(mapAuthError(err));
    }
  });

  document.querySelectorAll(".filter-pill").forEach((pill) => {
    pill.addEventListener("click", () => setActiveFilter(pill.dataset.filter));
  });

  $("btn-new-chat")?.addEventListener("click", () => {
    setActiveFilter("directory");
    $("dashboard-search-input")?.focus();
  });

  $("btn-empty-find-users")?.addEventListener("click", () => {
    setActiveFilter("directory");
    $("dashboard-search-input")?.focus();
  });

  const searchInput = $("dashboard-search-input");
  const clearSearchBtn = $("btn-clear-search");
  searchInput?.addEventListener("input", () => {
    state.searchQuery = searchInput.value;
    clearSearchBtn?.classList.toggle("hidden", !state.searchQuery);
    if (state.activeFilter === "directory") {
      refreshUserDirectory();
    } else {
      renderSidebarList();
    }
  });

  clearSearchBtn?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    state.searchQuery = "";
    clearSearchBtn.classList.add("hidden");
    if (state.activeFilter === "directory") {
      refreshUserDirectory();
    } else {
      renderSidebarList();
    }
  });

  $("btn-mobile-back")?.addEventListener("click", () => {
    $("workspace-main-grid")?.classList.remove("mobile-chat-open");
  });

  $("btn-toggle-e2ee")?.addEventListener("click", handleToggleE2EE);
  $("btn-verify-keys")?.addEventListener("click", openSecurityVerificationModal);
  $("btn-security-learn-more")?.addEventListener(
    "click",
    openSecurityVerificationModal
  );
  $("btn-close-security-modal")?.addEventListener("click", () =>
    $("modal-security-info")?.classList.add("hidden")
  );
  $("btn-close-security-footer")?.addEventListener("click", () =>
    $("modal-security-info")?.classList.add("hidden")
  );

  $("btn-archive-chat")?.addEventListener("click", handleArchiveConversation);
  $("btn-block-user")?.addEventListener("click", handleToggleBlockPeer);
  $("btn-unblock-banner")?.addEventListener("click", handleToggleBlockPeer);
  $("btn-delete-chat")?.addEventListener("click", handleDeleteConversation);

  $("btn-report-user")?.addEventListener("click", () =>
    $("modal-report")?.classList.remove("hidden")
  );
  $("btn-close-report-modal")?.addEventListener("click", () =>
    $("modal-report")?.classList.add("hidden")
  );
  $("btn-cancel-report")?.addEventListener("click", () =>
    $("modal-report")?.classList.add("hidden")
  );
  $("form-report-user")?.addEventListener("submit", handleReportSubmit);

  const msgInput = $("chat-message-input");
  msgInput?.addEventListener("input", () => {
    updateComposerCharCount();
    if (!state.activeConversationId || !state.currentUser) return;

    const now = Date.now();
    if (now - state.lastTypingSentAt > 2500) {
      state.lastTypingSentAt = now;
      setTypingStatus(state.activeConversationId, state.currentUser.uid, true);
    }

    if (state.typingTimeout) clearTimeout(state.typingTimeout);
    state.typingTimeout = window.setTimeout(() => {
      if (state.activeConversationId && state.currentUser) {
        setTypingStatus(
          state.activeConversationId,
          state.currentUser.uid,
          false
        );
      }
    }, 3500);
  });

  msgInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("chat-composer-form")?.requestSubmit();
    }
  });

  $("chat-composer-form")?.addEventListener("submit", handleSendMessageSubmit);
  $("btn-cancel-context")?.addEventListener("click", cancelComposerContext);
  $("chat-attachment-input")?.addEventListener(
    "change",
    handleAttachmentSelected
  );
  $("btn-remove-attachment")?.addEventListener("click", clearStagedAttachment);

  initEmojiPicker();

  $("btn-open-settings")?.addEventListener("click", openSettingsModal);
  $("sidebar-user-profile-trigger")?.addEventListener("click", openSettingsModal);
  $("btn-close-settings")?.addEventListener("click", () =>
    $("modal-settings")?.classList.add("hidden")
  );
  $("btn-save-profile")?.addEventListener("click", handleSaveSettingsProfile);

  $("settings-avatar-file")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file, 256, 0.82);
      state.selectedAvatarDataUrl = dataUrl;
      renderAvatarElement(
        $("settings-avatar-preview"),
        {
          ...state.currentProfile,
          photoURL: dataUrl,
          avatarColor: state.selectedAvatarColor
        },
        false,
        false
      );
    } catch (err) {
      showToast(err.message || "Could not process avatar image.");
    }
  });

  $("btn-clear-avatar")?.addEventListener("click", () => {
    state.selectedAvatarDataUrl = "";
    renderAvatarElement(
      $("settings-avatar-preview"),
      {
        ...state.currentProfile,
        photoURL: "",
        avatarColor: state.selectedAvatarColor
      },
      false,
      false
    );
  });

  $("btn-rotate-keys")?.addEventListener("click", async () => {
    if (!state.currentUser) return;
    try {
      const keyInfo = await rotateAndPublishUserKeys(state.currentUser.uid);
      if (state.currentProfile) {
        state.currentProfile.publicKeyJwk = keyInfo.publicKeyJwk;
        state.currentProfile.keyFingerprint = keyInfo.fingerprint;
      }
      if ($("settings-key-fingerprint")) {
        $("settings-key-fingerprint").textContent = keyInfo.fingerprint;
      }
      showToast("Rotated WebCrypto ECDH P-256 keypair and updated Firestore profile.");
    } catch (err) {
      showToast(err.message || "Could not rotate keys.");
    }
  });

  $("toggle-browser-notifications")?.addEventListener("change", async (e) => {
    if (e.target.checked && "Notification" in window) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        e.target.checked = false;
        showToast("Browser notification permission was not granted.");
      }
    }
  });

  $("btn-logout")?.addEventListener("click", async () => {
    $("modal-settings")?.classList.add("hidden");
    await logoutUser();
    showToast("Logged out safely.");
    switchMainView("landing");
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  bindDOMEvents();
  await bootstrapFirebaseSession();
});

/**
 * Chit Chat — Real-Time Private Messaging & Conversations Module
 * ==============================================================
 */

import { initFirebaseServices } from "./firebase-service.js";
import { encryptMessageText, decryptMessageText } from "./crypto.js";
import { pickAvatarColor } from "./auth.js";

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain"
];

export function getDirectConversationId(uidA, uidB) {
  return [String(uidA).trim(), String(uidB).trim()].sort().join("_");
}

export function toDateObject(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000);
  if (ts instanceof Date) return ts;
  if (typeof ts === "number") return new Date(ts);
  return null;
}

export function formatConversationTime(ts) {
  const date = toDateObject(ts);
  if (!date || Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isYesterday) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatMessageClockTime(ts) {
  const date = toDateObject(ts);
  if (!date || Number.isNaN(date.getTime())) return "Sending...";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDateDivider(ts) {
  const date = toDateObject(ts);
  if (!date || Number.isNaN(date.getTime())) return "Today";
  const now = new Date();
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return "Today";
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }
  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

export async function searchUsersDirectory(searchTerm, currentUid) {
  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");
  const { db, sdk } = services;
  const { collection, getDocs, query, limit } = sdk.firestoreMod;

  const cleanQuery = String(searchTerm || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

  const q = query(collection(db, "users"), limit(60));
  const snapshot = await getDocs(q);
  const results = [];

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const uid = data.uid || docSnap.id;
    if (uid === currentUid) return;

    if (!cleanQuery) {
      results.push({ ...data, uid });
      return;
    }

    const nameMatch = String(data.displayName || "")
      .toLowerCase()
      .includes(cleanQuery);
    const userMatch = String(data.username || "")
      .toLowerCase()
      .includes(cleanQuery);
    const emailMatch = String(data.email || "")
      .toLowerCase()
      .includes(cleanQuery);

    if (nameMatch || userMatch || emailMatch) {
      results.push({ ...data, uid });
    }
  });

  results.sort((a, b) =>
    String(a.displayName || "").localeCompare(String(b.displayName || ""))
  );
  return results.slice(0, 25);
}

export async function getUserProfileById(uid) {
  if (!uid) return null;
  const services = await initFirebaseServices();
  if (!services.ready) return null;
  const { db, sdk } = services;
  const { doc, getDoc } = sdk.firestoreMod;

  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { ...snap.data(), uid: snap.id } : null;
}

export async function subscribeToUserProfile(uid, callback) {
  if (!uid) return () => {};
  const services = await initFirebaseServices();
  if (!services.ready) return () => {};
  const { db, sdk } = services;
  const { doc, onSnapshot } = sdk.firestoreMod;

  return onSnapshot(
    doc(db, "users", uid),
    (snap) => {
      if (snap.exists()) {
        callback({ ...snap.data(), uid: snap.id });
      }
    },
    (err) => {
      console.warn("User profile listener error:", err);
    }
  );
}

export async function getOrCreateDirectConversation(currentUser, peerUser) {
  if (!currentUser?.uid || !peerUser?.uid) {
    throw new Error("Both participants must have valid user IDs.");
  }
  if (currentUser.uid === peerUser.uid) {
    throw new Error("You cannot start a private conversation with yourself.");
  }

  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");
  const { db, sdk } = services;
  const { doc, getDoc, setDoc, serverTimestamp } = sdk.firestoreMod;

  const conversationId = getDirectConversationId(currentUser.uid, peerUser.uid);
  const convRef = doc(db, "conversations", conversationId);

  const participantProfiles = {
    [currentUser.uid]: {
      uid: currentUser.uid,
      displayName: currentUser.displayName || "User",
      username: currentUser.username || "user",
      photoURL: currentUser.photoURL || "",
      avatarColor: currentUser.avatarColor || pickAvatarColor(currentUser.uid),
      publicKeyJwk: currentUser.publicKeyJwk || null
    },
    [peerUser.uid]: {
      uid: peerUser.uid,
      displayName: peerUser.displayName || "User",
      username: peerUser.username || "user",
      photoURL: peerUser.photoURL || "",
      avatarColor: peerUser.avatarColor || pickAvatarColor(peerUser.uid),
      publicKeyJwk: peerUser.publicKeyJwk || null
    }
  };

  try {
    const existing = await getDoc(convRef);
    if (existing.exists()) {
      const data = existing.data();
      const archivedBy = Array.isArray(data.archivedBy)
        ? data.archivedBy.filter((id) => id !== currentUser.uid)
        : [];
      await setDoc(
        convRef,
        {
          participantProfiles: {
            ...(data.participantProfiles || {}),
            ...participantProfiles
          },
          archivedBy
        },
        { merge: true }
      );
      return { id: conversationId, ...data, participantProfiles, archivedBy };
    }
  } catch (_) {}

  const newConversation = {
    participants: [currentUser.uid, peerUser.uid].sort(),
    createdBy: currentUser.uid,
    participantProfiles,
    lastMessage: null,
    unreadCounts: {
      [currentUser.uid]: 0,
      [peerUser.uid]: 0
    },
    typing: {
      [currentUser.uid]: 0,
      [peerUser.uid]: 0
    },
    archivedBy: [],
    blockedBy: [],
    e2eeEnabled: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(convRef, newConversation);
  return { id: conversationId, ...newConversation };
}

export async function subscribeToConversations(uid, onUpdate, onError) {
  const services = await initFirebaseServices();
  if (!services.ready) return () => {};
  const { db, sdk } = services;
  const { collection, query, where, onSnapshot } = sdk.firestoreMod;

  const q = query(
    collection(db, "conversations"),
    where("participants", "array-contains", uid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const list = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const peerUid =
          (data.participants || []).find((p) => p !== uid) || uid;
        const peerProfile =
          (data.participantProfiles && data.participantProfiles[peerUid]) || {
            uid: peerUid,
            displayName: "Private Contact",
            username: "contact",
            avatarColor: pickAvatarColor(peerUid)
          };

        list.push({
          id: docSnap.id,
          ...data,
          peerUid,
          peerProfile,
          unreadCount:
            data.unreadCounts && typeof data.unreadCounts[uid] === "number"
              ? data.unreadCounts[uid]
              : 0,
          isArchived:
            Array.isArray(data.archivedBy) && data.archivedBy.includes(uid),
          isBlockedByMe:
            Array.isArray(data.blockedBy) && data.blockedBy.includes(uid),
          isBlocked:
            Array.isArray(data.blockedBy) && data.blockedBy.length > 0
        });
      });

      list.sort((a, b) => {
        const dateA =
          toDateObject(a.updatedAt) || toDateObject(a.createdAt) || new Date(0);
        const dateB =
          toDateObject(b.updatedAt) || toDateObject(b.createdAt) || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });

      onUpdate(list);
    },
    (err) => {
      console.error("Conversations subscription error:", err);
      if (onError) onError(err);
    }
  );
}

export async function subscribeToMessages(
  conversationId,
  currentUid,
  peerPublicKeyJwk,
  onUpdate,
  onError
) {
  const services = await initFirebaseServices();
  if (!services.ready) return () => {};
  const { db, sdk } = services;
  const { collection, query, orderBy, onSnapshot, limit } = sdk.firestoreMod;

  const messagesRef = collection(
    db,
    "conversations",
    conversationId,
    "messages"
  );
  const q = query(messagesRef, orderBy("createdAt", "asc"), limit(250));

  return onSnapshot(
    q,
    async (snapshot) => {
      const items = [];
      for (const docSnap of snapshot.docs) {
        const raw = docSnap.data();
        let displayText = raw.text || "";
        let decryptionFailed = false;

        if (raw.encrypted && raw.encryptedPayload && !raw.deleted) {
          if (peerPublicKeyJwk) {
            try {
              displayText = await decryptMessageText(
                raw.encryptedPayload,
                currentUid,
                peerPublicKeyJwk
              );
            } catch (_) {
              decryptionFailed = true;
              displayText = "🔒 Encrypted message (unable to decrypt with current device key)";
            }
          } else {
            decryptionFailed = true;
            displayText = "🔒 Encrypted message (awaiting peer public key)";
          }
        }

        items.push({
          id: docSnap.id,
          ...raw,
          displayText,
          decryptionFailed
        });
      }

      onUpdate(items);
    },
    (err) => {
      console.error("Messages subscription error:", err);
      if (onError) onError(err);
    }
  );
}

export function validateAttachmentFile(file) {
  if (!file) return null;
  if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
    throw new Error(
      "Unsupported file type. Allowed formats: JPEG, PNG, WebP, GIF, PDF, or TXT."
    );
  }
  if (file.size <= 0) {
    throw new Error("Selected file is empty.");
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachment exceeds the 5 MB security limit.");
  }
  return true;
}

export function compressImageFileToDataUrl(file, maxDimension = 960, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image file."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const outType = file.type === "image/png" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(outType, quality);
        resolve(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export async function prepareAttachmentPayload(conversationId, senderUid, file) {
  validateAttachmentFile(file);

  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);

  if (services.storage) {
    try {
      const { ref, uploadBytes, getDownloadURL } = services.sdk.storageMod;
      const storagePath = `attachments/${conversationId}/${senderUid}/${Date.now()}_${safeName}`;
      const fileRef = ref(services.storage, storagePath);
      const uploadTask = await uploadBytes(fileRef, file, {
        contentType: file.type
      });
      const downloadUrl = await getDownloadURL(uploadTask.ref);
      return {
        name: file.name.slice(0, 200),
        type: file.type,
        size: file.size,
        url: downloadUrl,
        storagePath
      };
    } catch (storageErr) {
      console.warn(
        "Firebase Storage upload unavailable; using compressed inline fallback:",
        storageErr
      );
    }
  }

  if (file.type.startsWith("image/")) {
    const dataUrl = await compressImageFileToDataUrl(file, 880, 0.78);
    return {
      name: file.name.slice(0, 200),
      type: file.type,
      size: file.size,
      url: dataUrl
    };
  }

  if (file.size > 350 * 1024) {
    throw new Error(
      "Non-image attachments over 350 KB require Firebase Storage to be enabled on your Firebase project."
    );
  }

  const dataUrl = await readFileAsDataUrl(file);
  return {
    name: file.name.slice(0, 200),
    type: file.type,
    size: file.size,
    url: dataUrl
  };
}

export async function sendChatMessage({
  conversation,
  currentUser,
  peerProfile,
  text,
  attachmentFile = null,
  replyTo = null
}) {
  if (!conversation?.id) throw new Error("No active conversation selected.");
  if (!currentUser?.uid) throw new Error("You must be logged in to send messages.");

  if (Array.isArray(conversation.blockedBy) && conversation.blockedBy.length > 0) {
    throw new Error("Messaging is disabled because one of the participants blocked this conversation.");
  }

  const cleanText = String(text || "").trim();
  if (cleanText.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message exceeds the maximum length of ${MAX_MESSAGE_LENGTH} characters.`);
  }
  if (!cleanText && !attachmentFile) {
    throw new Error("Cannot send an empty message.");
  }

  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");
  const { db, sdk } = services;
  const {
    collection,
    doc,
    addDoc,
    setDoc,
    increment,
    serverTimestamp
  } = sdk.firestoreMod;

  let attachment = null;
  if (attachmentFile) {
    attachment = await prepareAttachmentPayload(
      conversation.id,
      currentUser.uid,
      attachmentFile
    );
  }

  const peerUid =
    conversation.peerUid ||
    (conversation.participants || []).find((id) => id !== currentUser.uid);

  const useE2EE = Boolean(
    conversation.e2eeEnabled &&
      peerProfile?.publicKeyJwk &&
      currentUser?.publicKeyJwk &&
      cleanText
  );

  let storedText = cleanText;
  let encryptedPayload = null;

  if (useE2EE) {
    encryptedPayload = await encryptMessageText(
      cleanText,
      currentUser.uid,
      peerProfile.publicKeyJwk
    );
    storedText = "🔒 Encrypted message";
  }

  const sanitizedReply = replyTo
    ? {
        messageId: String(replyTo.messageId || "").slice(0, 128),
        senderId: String(replyTo.senderId || "").slice(0, 128),
        senderName: String(replyTo.senderName || "User").slice(0, 100),
        textPreview: String(replyTo.textPreview || "").slice(0, 280)
      }
    : null;

  const messageData = {
    senderId: currentUser.uid,
    senderName: (currentUser.displayName || "User").slice(0, 80),
    text: storedText,
    encrypted: useE2EE,
    encryptedPayload,
    attachment,
    replyTo: sanitizedReply,
    reactions: {},
    status: "sent",
    deleted: false,
    edited: false,
    createdAt: serverTimestamp()
  };

  const messagesRef = collection(
    db,
    "conversations",
    conversation.id,
    "messages"
  );
  const createdDoc = await addDoc(messagesRef, messageData);

  const previewText = useE2EE
    ? "🔒 End-to-end encrypted message"
    : cleanText
      ? cleanText.slice(0, 120)
      : `📎 ${attachment ? attachment.name : "Attachment"}`;

  const convUpdate = {
    lastMessage: {
      id: createdDoc.id,
      text: previewText,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || "User",
      encrypted: useE2EE,
      hasAttachment: Boolean(attachment),
      createdAt: Date.now()
    },
    updatedAt: serverTimestamp(),
    [`typing.${currentUser.uid}`]: 0
  };

  if (peerUid) {
    convUpdate[`unreadCounts.${peerUid}`] = increment(1);
  }

  await setDoc(doc(db, "conversations", conversation.id), convUpdate, {
    merge: true
  });

  return createdDoc.id;
}

export async function markConversationMessagesRead(
  conversationId,
  currentUid,
  messages = [],
  sendReadReceipt = true
) {
  if (!conversationId || !currentUid) return;
  const services = await initFirebaseServices();
  if (!services.ready) return;
  const { db, sdk } = services;
  const { doc, setDoc, updateDoc } = sdk.firestoreMod;

  try {
    await setDoc(
      doc(db, "conversations", conversationId),
      {
        unreadCounts: {
          [currentUid]: 0
        }
      },
      { merge: true }
    );

    const targetStatus = sendReadReceipt ? "read" : "delivered";
    const unreadIncoming = messages.filter(
      (m) =>
        m.senderId !== currentUid &&
        m.status !== "read" &&
        m.status !== targetStatus
    );

    await Promise.all(
      unreadIncoming.slice(0, 25).map((m) =>
        updateDoc(
          doc(db, "conversations", conversationId, "messages", m.id),
          { status: targetStatus }
        ).catch(() => {})
      )
    );
  } catch (err) {
    console.warn("Could not update read status:", err);
  }
}

export async function setTypingStatus(conversationId, currentUid, isTyping) {
  if (!conversationId || !currentUid) return;
  try {
    const services = await initFirebaseServices();
    if (!services.ready) return;
    const { db, sdk } = services;
    const { doc, updateDoc } = sdk.firestoreMod;

    await updateDoc(doc(db, "conversations", conversationId), {
      [`typing.${currentUid}`]: isTyping ? Date.now() : 0
    });
  } catch (_) {}
}

export async function editOwnMessage({
  conversation,
  message,
  newText,
  currentUid,
  peerPublicKeyJwk
}) {
  if (!conversation?.id || !message?.id) {
    throw new Error("Invalid message reference.");
  }
  if (message.senderId !== currentUid) {
    throw new Error("You can only edit your own messages.");
  }
  if (message.deleted) {
    throw new Error("Deleted messages cannot be edited.");
  }

  const clean = String(newText || "").trim();
  if (!clean) throw new Error("Edited message cannot be empty.");
  if (clean.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message exceeds ${MAX_MESSAGE_LENGTH} characters.`);
  }

  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");
  const { db, sdk } = services;
  const { doc, updateDoc, serverTimestamp } = sdk.firestoreMod;

  let storedText = clean;
  let encryptedPayload = message.encryptedPayload || null;

  if (message.encrypted && peerPublicKeyJwk) {
    encryptedPayload = await encryptMessageText(
      clean,
      currentUid,
      peerPublicKeyJwk
    );
    storedText = "🔒 Encrypted message";
  }

  await updateDoc(
    doc(db, "conversations", conversation.id, "messages", message.id),
    {
      text: storedText,
      encryptedPayload,
      edited: true,
      editedAt: serverTimestamp()
    }
  );
}

export async function deleteOwnMessage(conversationId, message, currentUid) {
  if (!conversationId || !message?.id) {
    throw new Error("Invalid message reference.");
  }
  if (message.senderId !== currentUid) {
    throw new Error("You can only delete your own messages.");
  }

  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");
  const { db, sdk } = services;
  const { doc, updateDoc, serverTimestamp } = sdk.firestoreMod;

  await updateDoc(doc(db, "conversations", conversationId, "messages", message.id), {
    text: "This message was deleted",
    encrypted: false,
    encryptedPayload: null,
    attachment: null,
    deleted: true,
    deletedAt: serverTimestamp()
  });
}

export async function toggleMessageReaction(conversationId, message, currentUid, emoji) {
  if (!conversationId || !message?.id || !currentUid || !emoji) return;
  const services = await initFirebaseServices();
  if (!services.ready) return;
  const { db, sdk } = services;
  const { doc, updateDoc } = sdk.firestoreMod;

  const existingReactions = { ...(message.reactions || {}) };
  if (existingReactions[currentUid] === emoji) {
    delete existingReactions[currentUid];
  } else {
    existingReactions[currentUid] = emoji;
  }

  await updateDoc(doc(db, "conversations", conversationId, "messages", message.id), {
    reactions: existingReactions
  });
}

export async function toggleConversationE2EE(conversationId, enabled) {
  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");
  const { db, sdk } = services;
  const { doc, updateDoc, serverTimestamp } = sdk.firestoreMod;

  await updateDoc(doc(db, "conversations", conversationId), {
    e2eeEnabled: Boolean(enabled),
    updatedAt: serverTimestamp()
  });
}

export async function toggleArchiveConversation(conversation, currentUid) {
  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");
  const { db, sdk } = services;
  const { doc, updateDoc } = sdk.firestoreMod;

  const currentArchived = Array.isArray(conversation.archivedBy)
    ? [...conversation.archivedBy]
    : [];
  const isArchived = currentArchived.includes(currentUid);
  const nextArchived = isArchived
    ? currentArchived.filter((id) => id !== currentUid)
    : [...currentArchived, currentUid];

  await updateDoc(doc(db, "conversations", conversation.id), {
    archivedBy: nextArchived
  });
  return !isArchived;
}

export async function deleteConversationThread(conversationId) {
  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");
  const { db, sdk } = services;
  const { doc, deleteDoc } = sdk.firestoreMod;

  await deleteDoc(doc(db, "conversations", conversationId));
}

export async function toggleBlockUser(conversation, currentUid, peerUid) {
  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");
  const { db, sdk } = services;
  const { doc, getDoc, updateDoc, setDoc } = sdk.firestoreMod;

  const userRef = doc(db, "users", currentUid);
  const userSnap = await getDoc(userRef);
  const userData = userSnap.exists() ? userSnap.data() : {};
  const blockedUsers = Array.isArray(userData.blockedUsers)
    ? [...userData.blockedUsers]
    : [];

  const isCurrentlyBlocked = blockedUsers.includes(peerUid);
  const nextBlockedUsers = isCurrentlyBlocked
    ? blockedUsers.filter((id) => id !== peerUid)
    : [...blockedUsers, peerUid];

  await setDoc(userRef, { blockedUsers: nextBlockedUsers }, { merge: true });

  if (conversation?.id) {
    const convBlocked = Array.isArray(conversation.blockedBy)
      ? [...conversation.blockedBy]
      : [];
    const nextConvBlocked = isCurrentlyBlocked
      ? convBlocked.filter((id) => id !== currentUid)
      : Array.from(new Set([...convBlocked, currentUid]));

    await updateDoc(doc(db, "conversations", conversation.id), {
      blockedBy: nextConvBlocked
    });
  }

  return !isCurrentlyBlocked;
}

export async function submitUserReport({
  reporterUid,
  reportedUserId,
  conversationId,
  reason,
  details
}) {
  const cleanReason = String(reason || "").trim();
  const cleanDetails = String(details || "").trim();

  if (cleanReason.length < 3) {
    throw new Error("Please select a report reason.");
  }
  if (cleanDetails.length > 1500) {
    throw new Error("Report details must be 1,500 characters or fewer.");
  }

  const services = await initFirebaseServices();
  if (!services.ready) throw new Error("Firebase is not configured.");
  const { db, sdk } = services;
  const { collection, addDoc, serverTimestamp } = sdk.firestoreMod;

  await addDoc(collection(db, "reports"), {
    reporterId: reporterUid,
    reportedUserId,
    conversationId: conversationId || "",
    reason: cleanReason,
    details: cleanDetails,
    createdAt: serverTimestamp()
  });
}

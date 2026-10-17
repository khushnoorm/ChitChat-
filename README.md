# Chit Chat — Private Messaging Web Application

**Chit Chat** is a modern, mobile-first, real-time private messaging web application designed to run as a static frontend on **GitHub Pages** backed by **Firebase Authentication**, **Cloud Firestore**, **Firebase Storage**, and optional **WebCrypto End-to-End Encryption (ECDH P-256 + AES-256-GCM)**.

---

## 1. Key Features

### Pages & Application Views
1. **Landing Page (`index.html`)**
   - Product introduction, interactive live preview, feature highlights, and transparent security architecture documentation.
   - Quick navigation to **Sign Up**, **Log In**, and the **Firebase Connection Wizard**.
2. **Authentication (`login.html` & in-app `#auth` view)**
   - Email/Password account registration (`createUserWithEmailAndPassword`) with `@username` uniqueness verification.
   - Sign in (`signInWithEmailAndPassword`), sign out (`signOut`), password reset (`sendPasswordResetEmail`), and email verification (`sendEmailVerification`) with one-tap status refresh.
   - Automatic generation of each user's device **ECDH P-256 keypair** and Firestore profile creation.
3. **Chat Dashboard**
   - Real-time conversation list ordered by recent activity (`onSnapshot`).
   - Filter views for **All Chats**, **Unread**, **Archived**, and **Find Users (Directory)**.
   - Unread message counter badges, last message previews, and live typing/online indicators.
4. **Private Chat Window**
   - Strictly 1-to-1 private messaging between authenticated participants.
   - Message timestamps, date dividers, and sent (`✓`), delivered (`✓✓`), and read (`✓✓ Read`) status indicators.
   - Live typing indicator (`✍️ typing...`).
   - Built-in touch-friendly Emoji Picker and quick message reactions (`👍`, `❤️`, `😂`, `🔥`, `🙏`).
   - Validated image and file attachments (`JPEG`, `PNG`, `WebP`, `GIF`, `PDF`, `TXT` up to `5 MB`) with client-side image compression.
   - Message quoting/replies, inline editing of your own sent messages, and message deletion.
   - Conversation archiving, deletion, user blocking, and structured abuse reporting.
5. **User Profile & Settings**
   - Edit Display Name, `@username`, status bio, custom avatar photo, or avatar color swatches.
   - Instant **Dark**, **Light**, and **System Auto** theme switcher.
   - Privacy controls for **Online/Last Seen visibility** and **Read Receipts**.
   - **WebCrypto E2EE Key Fingerprint** viewer and one-tap **Keypair Rotation**.
   - Browser notification and sound preferences.

---

## 2. Project File Structure

```text
.
├── index.html                    # Main application (Landing, Auth, Dashboard, Chat, Settings)
├── login.html                    # Standalone authentication entry page
├── manifest.json                 # PWA Web App Manifest for Android & desktop installation
├── firestore.rules               # Cloud Firestore backend security rules
├── firestore.indexes.json        # Cloud Firestore composite index definitions
├── storage.rules                 # Firebase Storage security rules for attachments & avatars
├── .gitignore                    # Excludes local secrets, .env files, and build caches
├── .nojekyll                     # Disables Jekyll processing on GitHub Pages
├── README.md                     # Setup, security, and deployment documentation
├── assets/
│   └── icon.svg                  # Vector application logo and PWA icon
├── css/
│   └── styles.css                # Mobile-first responsive stylesheet (Dark & Light themes)
└── js/
    ├── app.js                    # Main controller, router, UI bindings, and modals
    ├── auth.js                   # Firebase Auth, profile sync, validation, and presence
    ├── chat.js                   # Real-time conversations, messages, attachments, moderation
    ├── crypto.js                 # Optional WebCrypto ECDH P-256 + AES-256-GCM E2EE module
    ├── firebase-service.js       # Modular Firebase SDK loader (v10.14.1 CDN)
    ├── firebase-config.js        # Safe runtime configuration resolver (zero embedded secrets)
    └── firebase-config.example.js# Documented Firebase configuration template
```

---

## 3. Privacy & Security Architecture

### Backend-Enforced Access Control (`firestore.rules` & `storage.rules`)
- **Authenticated Access Only:** Unauthenticated requests are rejected across all collections.
- **Participant Isolation:** A conversation document (`/conversations/{conversationId}`) and its `/messages/{messageId}` subcollection can only be read or written when `request.auth.uid in resource.data.participants`. Changing URLs or document IDs in the browser cannot expose another user's conversation.
- **Anti-Impersonation:** Creating a message requires `request.resource.data.senderId == request.auth.uid` and `request.resource.data.createdAt == request.time`.
- **Schema & Size Validation:** Message text is capped at `4,000` characters; attachments are restricted to `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `application/pdf`, and `text/plain` under `5 MB`.
- **Block Enforcement:** When either user blocks a conversation (`blockedBy.size() > 0`), Firestore security rules reject new message creation at the database layer.

### Honest End-to-End Encryption Design (`js/crypto.js`)
- **Standard Mode:** Messages are protected in transit via HTTPS/TLS and restricted to conversation participants by Cloud Firestore Security Rules. Standard messages are **never** falsely labeled as end-to-end encrypted.
- **Optional WebCrypto E2EE Mode:** When both participants have signed in (publishing their `ECDH P-256` public JWK to `/users/{uid}`) and **E2EE Mode** is toggled on in the chat header, messages are encrypted on the sender's device using a derived `AES-256-GCM` key and a fresh 96-bit random IV before being stored in Firestore. Participants can compare SHA-256 public key fingerprints via the **Verify Keys (`🔐`)** dialog.

---

## 4. Step-by-Step Firebase Setup (Works Directly from an Android Phone)

1. **Create or Open Your Firebase Project**
   - Open the [Firebase Console](https://console.firebase.google.com/) and select your project (or create a new project).
2. **Enable Email/Password Authentication**
   - Go to **Build → Authentication → Get started**.
   - Open the **Sign-in method** tab, select **Email/Password**, enable it, and tap **Save**.
3. **Authorize Your GitHub Pages Domain**
   - Still in **Authentication**, open the **Settings** tab → **Authorized domains**.
   - Click **Add domain** and enter `khushnoorm.github.io` (plus `localhost` for local testing).
4. **Create Cloud Firestore Database**
   - Go to **Build → Firestore Database → Create database**.
   - Choose your preferred location and start in **Production mode**.
   - Open the **Rules** tab, paste the contents of [`firestore.rules`](./firestore.rules), and click **Publish**.
5. **Configure Firebase Storage (Optional, for >350 KB file attachments)**
   - If you use Firebase Storage, go to **Build → Storage**, open the **Rules** tab, paste the contents of [`storage.rules`](./storage.rules), and click **Publish**.
   - *(Note: Even if Firebase Storage is not enabled on your free plan, Chit Chat automatically compresses and sends image attachments inline up to safe Firestore document limits.)*
6. **Connect Your Web App Config**
   - In **Project Overview → Project settings (⚙️) → General → Your apps**, register a Web App (`</>`) and copy the `firebaseConfig` object.
   - **Option A (No code edit needed — ideal on Android):** Open your live GitHub Pages site, tap **Setup Firebase** (`⚙️ Configure Firebase`), paste your `firebaseConfig` snippet, and tap **Save & Connect Firebase**.
   - **Option B (Repository default):** Copy your public web app keys into `DEFAULT_FIREBASE_CONFIG` inside `js/firebase-config.js` and commit. *(Never commit service-account JSON files or private admin keys.)*

---

## 5. Deploying on GitHub Pages

1. Open your repository on GitHub: `https://github.com/khushnoorm/ChitChat-`
2. Navigate to **Settings → Pages**.
3. Under **Build and deployment**:
   - **Source:** Select `Deploy from a branch`.
   - **Branch:** Select `main` and folder `/ (root)`, then click **Save**.
4. Wait 1–2 minutes for the deployment workflow to finish. Your live application will be available at:
   - `https://khushnoorm.github.io/ChitChat-/`

---

## 6. Making User-to-User Private Messaging Operational

1. Open `https://khushnoorm.github.io/ChitChat-/` on Device 1 (e.g., your Android phone) and connect your Firebase project if not hardcoded in `js/firebase-config.js`.
2. Tap **Sign Up** and register Account 1 (e.g., `@khushnoor`).
3. Open the site in a second browser/device (or Incognito window) and register Account 2 (e.g., `@friend`).
4. In Account 1's dashboard, tap **Find Users** (or the `➕` icon), search for `@friend`, and tap their profile to open a private 1-to-1 conversation.
5. Send a message, test live typing indicators, emoji reactions, replies, and optionally toggle **🔒 E2EE Active** in the chat header to exchange client-side encrypted messages.

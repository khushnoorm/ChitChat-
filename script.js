import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";

import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB0Mvo7GBMnKBlq-n5TyB_wGlNKuKW6q_0",
  authDomain: "chitchat-48dae.firebaseapp.com",
  projectId: "chitchat-48dae",
  storageBucket: "chitchat-48dae.firebasestorage.app",
  messagingSenderId: "236630154303",
  appId: "1:236630154303:web:ed5ef9e7bb689c321fec8a",
  measurementId: "G-8YV8BM0S1W"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const input = document.querySelector(".input-area input");
const button = document.querySelector(".input-area button");
const messages = document.querySelector(".messages");

// Same room for you and your friend
const roomId = "khushnoor-room";

const messagesRef = collection(
  db,
  "rooms",
  roomId,
  "messages"
);

// Send message
async function sendMessage() {
  const text = input.value.trim();

  if (text === "") return;

  try {
    await addDoc(messagesRef, {
      text: text,
      sender: "user",
      createdAt: serverTimestamp()
    });

    input.value = "";
  } catch (error) {
    console.error("Message send error:", error);
    alert("Message send nahi hua.");
  }
}

// Receive messages in real time
const q = query(
  messagesRef,
  orderBy("createdAt", "asc")
);

onSnapshot(q, (snapshot) => {
  messages.innerHTML = "";

  snapshot.forEach((doc) => {
    const data = doc.data();

    const message = document.createElement("div");

    message.className = "message sent";
    message.textContent = data.text;

    messages.appendChild(message);
  });

  messages.scrollTop = messages.scrollHeight;
});

// Send button
button.addEventListener("click", sendMessage);

// Enter key
input.addEventListener("keydown", function(event) {
  if (event.key === "Enter") {
    sendMessage();
  }
});

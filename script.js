const input = document.querySelector(".input-area input");
const button = document.querySelector(".input-area button");
const messages = document.querySelector(".messages");

function sendMessage() {
    const text = input.value.trim();

    if (text === "") {
        return;
    }

    // User message
    const message = document.createElement("div");
    message.className = "message sent";
    message.textContent = text;

    messages.appendChild(message);

    input.value = "";
    messages.scrollTop = messages.scrollHeight;

    // Automatic reply
    setTimeout(() => {
        const reply = document.createElement("div");
        reply.className = "message received";

        if (text.toLowerCase().includes("hello") ||
            text.toLowerCase().includes("hi")) {
            reply.textContent = "Hello! 👋 Kaise ho?";
        } 
        else if (text.toLowerCase().includes("name")) {
            reply.textContent = "Mera naam ChitChat hai 🤖";
        } 
        else {
            reply.textContent = "Nice message! 😊";
        }

        messages.appendChild(reply);
        messages.scrollTop = messages.scrollHeight;
    }, 800);
}

// Send button
button.addEventListener("click", sendMessage);

// Enter key
input.addEventListener("keydown", function(event) {
    if (event.key === "Enter") {
        sendMessage();
    }
});

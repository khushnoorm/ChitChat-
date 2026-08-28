const input = document.querySelector(".input-area input");
const button = document.querySelector(".input-area button");
const messages = document.querySelector(".messages");

function sendMessage() {
    const text = input.value.trim();

    if (text === "") {
        return;
    }

    const message = document.createElement("div");
    message.className = "message sent";
    message.textContent = text;

    messages.appendChild(message);

    input.value = "";
    messages.scrollTop = messages.scrollHeight;
}

button.addEventListener("click", sendMessage);

input.addEventListener("keydown", function(event) {
    if (event.key === "Enter") {
        sendMessage();
    }
});

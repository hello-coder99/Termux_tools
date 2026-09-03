import { randomRoomCode, isValidRoomCode, toast } from "./common.js";

const hostCard = document.getElementById("hostCard");
const viewerCard = document.getElementById("viewerCard");
const joinPanel = document.getElementById("joinPanel");
const roomInput = document.getElementById("room");
const joinButton = document.getElementById("joinButton");
const cancelJoin = document.getElementById("cancelJoin");

hostCard.addEventListener("click", () => {
    const code = randomRoomCode();
    window.location.href = `/host.html?room=${encodeURIComponent(code)}`;
});

viewerCard.addEventListener("click", () => {
    joinPanel.hidden = false;
    joinPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    roomInput.focus();
});

cancelJoin.addEventListener("click", () => {
    joinPanel.hidden = true;
});

function extractRoomCode(raw) {
    const value = raw.trim();
    // Allow pasting a full share link (…/viewer.html?room=CODE).
    try {
        const url = new URL(value);
        const fromQuery = url.searchParams.get("room");
        if (fromQuery) return fromQuery;
    } catch {
        // not a URL — treat as a plain code
    }
    return value;
}

function goToViewer() {
    const code = extractRoomCode(roomInput.value);

    if (!isValidRoomCode(code)) {
        toast("Enter a valid room code (4+ letters/numbers).", "error");
        roomInput.focus();
        return;
    }

    window.location.href = `/viewer.html?room=${encodeURIComponent(code)}`;
}

joinButton.addEventListener("click", goToViewer);
roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") goToViewer();
});

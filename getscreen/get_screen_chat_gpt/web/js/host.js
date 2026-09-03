import {
    toast,
    setStatus,
    copyToClipboard,
    fetchIceServers,
    SignalingSocket,
    CandidateQueue,
    initials
} from "./common.js";

const params = new URLSearchParams(window.location.search);
const room = params.get("room");

const roomCodeEl = document.getElementById("roomCode");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const preview = document.getElementById("preview");
const previewEmpty = document.getElementById("previewEmpty");
const shareButton = document.getElementById("shareButton");
const stopButton = document.getElementById("stopButton");
const copyCodeBtn = document.getElementById("copyCode");
const copyLinkBtn = document.getElementById("copyLink");
const viewerListEl = document.getElementById("viewerList");
const viewerCountEl = document.getElementById("viewerCount");
const statPillsEl = document.getElementById("statPills");

if (!room) {
    window.location.href = "/";
    throw new Error("Room ID missing");
}

roomCodeEl.textContent = room;

copyCodeBtn.addEventListener("click", async () => {
    const ok = await copyToClipboard(room);
    toast(ok ? "Room code copied." : "Couldn't copy — copy it manually.", ok ? "success" : "error");
});

copyLinkBtn.addEventListener("click", async () => {
    const link = `${location.origin}/viewer.html?room=${encodeURIComponent(room)}`;
    const ok = await copyToClipboard(link);
    toast(ok ? "Viewer link copied." : "Couldn't copy — copy it manually.", ok ? "success" : "error");
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
let screenStream = null;
const knownViewers = new Map(); // id -> { name }
const peerConnections = new Map(); // id -> { pc, queue }

// Resolve ICE servers before opening the signaling socket so the first
// offer we ever send already has the right configuration.
iceServers = await fetchIceServers();

const socket = new SignalingSocket({ room, role: "host" });

socket.on("open", () => setStatus(statusDot, statusText, "connecting", "Connected to server. Setting up room…"));

socket.on("joined", () => {
    setStatus(statusDot, statusText, "connected", "Room ready. Click \u201cShare screen\u201d to begin.");
});

socket.on("error", (message) => {
    // "error" also fires for generic WS transport errors with no payload.
    if (message && message.message) {
        toast(message.message, "error");
        setStatus(statusDot, statusText, "error", message.message);
    }
});

socket.on("reconnecting", ({ attempt }) => {
    setStatus(statusDot, statusText, "connecting", `Reconnecting to server (attempt ${attempt})…`);
});

socket.on("close", () => {
    setStatus(statusDot, statusText, "error", "Disconnected from server.");
});

socket.on("peer-joined", (message) => {
    if (message.role !== "viewer") return;

    knownViewers.set(message.id, { name: `Guest ${knownViewers.size + 1}` });
    renderViewerList();
    toast("A viewer joined the room.", "success");

    if (screenStream) {
        connectToViewer(message.id);
    }
});

socket.on("peer-left", (message) => {
    if (message.role !== "viewer") return;

    knownViewers.delete(message.id);
    teardownConnection(message.id);
    renderViewerList();
});

socket.on("answer", async (message) => {
    const entry = peerConnections.get(message.from);
    if (!entry) return;
    await entry.pc.setRemoteDescription(message.sdp);
    await entry.queue.flush(entry.pc);
});

socket.on("candidate", async (message) => {
    const entry = peerConnections.get(message.from);
    if (!entry) return;
    await entry.queue.add(entry.pc, message.candidate);
});

// ---------------------------------------------------------------------------
// Viewer list UI
// ---------------------------------------------------------------------------
function renderViewerList() {
    viewerCountEl.textContent = String(knownViewers.size);
    viewerListEl.innerHTML = "";

    for (const [id, info] of knownViewers) {
        const li = document.createElement("li");
        const connState = peerConnections.get(id)?.pc?.connectionState || "waiting";
        li.innerHTML = `
            <span class="avatar">${initials(id)}</span>
            <span>${info.name}</span>
            <span style="margin-left:auto; color:var(--text-muted); font-size:12px;">${connState}</span>
        `;
        viewerListEl.appendChild(li);
    }
}

// ---------------------------------------------------------------------------
// Per-viewer WebRTC connection
// ---------------------------------------------------------------------------
async function connectToViewer(viewerId) {
    const pc = new RTCPeerConnection({ iceServers });
    const queue = new CandidateQueue();
    peerConnections.set(viewerId, { pc, queue });

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send({ type: "candidate", to: viewerId, candidate: event.candidate });
        }
    };

    pc.onconnectionstatechange = () => {
        renderViewerList();
        if (["failed", "closed"].includes(pc.connectionState)) {
            teardownConnection(viewerId);
        }
    };

    if (screenStream) {
        for (const track of screenStream.getTracks()) {
            pc.addTrack(track, screenStream);
        }
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.send({ type: "offer", to: viewerId, sdp: offer });
}

function teardownConnection(viewerId) {
    const entry = peerConnections.get(viewerId);
    if (entry) {
        entry.pc.close();
        peerConnections.delete(viewerId);
    }
}

// ---------------------------------------------------------------------------
// Screen capture
// ---------------------------------------------------------------------------
shareButton.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
        toast("Your browser doesn't support screen sharing.", "error");
        return;
    }

    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 30 },
            audio: false
        });
    } catch (error) {
        if (error.name !== "NotAllowedError") {
            toast("Couldn't start screen sharing: " + error.message, "error");
        }
        return;
    }

    preview.srcObject = screenStream;
    previewEmpty.style.display = "none";
    shareButton.disabled = true;
    stopButton.disabled = false;
    setStatus(statusDot, statusText, "connected", "Sharing your screen.");

    for (const track of screenStream.getTracks()) {
        track.onended = () => stopSharing();
    }

    updateStatPills();

    // Connect to every viewer already in the room.
    for (const id of knownViewers.keys()) {
        connectToViewer(id);
    }
});

stopButton.addEventListener("click", stopSharing);

function stopSharing() {
    if (!screenStream) return;

    for (const track of screenStream.getTracks()) {
        track.stop();
    }
    screenStream = null;
    preview.srcObject = null;
    previewEmpty.style.display = "flex";

    for (const id of peerConnections.keys()) {
        socket.send({ type: "share-stopped", to: id });
    }
    for (const id of [...peerConnections.keys()]) {
        teardownConnection(id);
    }

    shareButton.disabled = false;
    stopButton.disabled = true;
    statPillsEl.innerHTML = "";
    setStatus(statusDot, statusText, "connected", "Sharing stopped. Click \u201cShare screen\u201d to resume.");
    renderViewerList();
}

function updateStatPills() {
    if (!screenStream) {
        statPillsEl.innerHTML = "";
        return;
    }
    const track = screenStream.getVideoTracks()[0];
    if (!track) return;
    const settings = track.getSettings();
    statPillsEl.innerHTML = `
        <span class="pill">${settings.width || "?"}\u00d7${settings.height || "?"}</span>
        <span class="pill">${settings.frameRate ? Math.round(settings.frameRate) + " fps" : "—"}</span>
    `;
}

window.addEventListener("beforeunload", () => {
    stopSharing();
    socket.close();
});

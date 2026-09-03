import {
    toast,
    setStatus,
    fetchIceServers,
    SignalingSocket,
    CandidateQueue,
    formatBitrate,
    isValidRoomCode
} from "./common.js";

const params = new URLSearchParams(window.location.search);
const room = params.get("room");

const roomCodeEl = document.getElementById("roomCode");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const remoteVideo = document.getElementById("remoteVideo");
const videoEmpty = document.getElementById("videoEmpty");
const emptyTitle = document.getElementById("emptyTitle");
const emptySub = document.getElementById("emptySub");
const statPillsEl = document.getElementById("statPills");
const fullscreenButton = document.getElementById("fullscreenButton");
const videoWrap = document.getElementById("videoWrap");

if (!room || !isValidRoomCode(room)) {
    window.location.href = "/";
    throw new Error("Room ID missing or invalid");
}

roomCodeEl.textContent = room;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let pc = null;
let hostId = null;
const queue = new CandidateQueue();
let statsTimer = null;
let lastStats = null;

// Resolve ICE servers before opening the signaling socket so the first
// answer we ever send already has the right configuration.
const iceServers = await fetchIceServers();

const socket = new SignalingSocket({ room, role: "viewer" });

socket.on("open", () => setStatus(statusDot, statusText, "connecting", "Connected to server. Joining room…"));

socket.on("joined", (message) => {
    if (message.hostOnline) {
        setStatus(statusDot, statusText, "connecting", "Host is online. Waiting for them to share…");
    } else {
        setStatus(statusDot, statusText, "connecting", "Waiting for a host to join this room…");
        showEmptyState("Waiting for the host", "No host has joined this room yet.");
    }
});

socket.on("error", (message) => {
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
    if (message.role === "host") {
        setStatus(statusDot, statusText, "connecting", "Host connected. Waiting for them to share…");
        showEmptyState("Waiting for the host", "You'll see their screen here as soon as they start sharing.");
    }
});

socket.on("peer-left", (message) => {
    if (message.role === "host") {
        setStatus(statusDot, statusText, "error", "Host disconnected.");
        showEmptyState("Host disconnected", "The host left the session. This view will resume automatically if they return.");
        teardownConnection();
    }
});

socket.on("share-stopped", () => {
    setStatus(statusDot, statusText, "connected", "Host stopped sharing.");
    showEmptyState("Sharing paused", "The host stopped sharing their screen.");
    teardownConnection();
});

socket.on("offer", async (message) => {
    hostId = message.from;
    await handleOffer(message.sdp);
});

socket.on("candidate", async (message) => {
    if (!pc) return;
    await queue.add(pc, message.candidate);
});

// ---------------------------------------------------------------------------
// WebRTC
// ---------------------------------------------------------------------------
async function handleOffer(sdp) {
    teardownConnection(); // in case a previous connection lingered

    pc = new RTCPeerConnection({ iceServers });
    queue.reset();

    pc.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        hideEmptyState();
        startStatsLoop();
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send({ type: "candidate", to: hostId, candidate: event.candidate });
        }
    };

    pc.onconnectionstatechange = () => {
        if (!pc) return;
        const state = pc.connectionState;
        if (state === "connected") {
            setStatus(statusDot, statusText, "connected", "Receiving the shared screen.");
        } else if (state === "connecting") {
            setStatus(statusDot, statusText, "connecting", "Establishing connection…");
        } else if (state === "failed" || state === "disconnected") {
            setStatus(statusDot, statusText, "error", "Connection lost. Waiting to reconnect…");
        }
    };

    await pc.setRemoteDescription(sdp);
    await queue.flush(pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.send({ type: "answer", to: hostId, sdp: answer });
}

function teardownConnection() {
    if (statsTimer) {
        clearInterval(statsTimer);
        statsTimer = null;
    }
    lastStats = null;
    statPillsEl.innerHTML = "";
    remoteVideo.srcObject = null;
    fullscreenButton.disabled = true;
    if (pc) {
        pc.close();
        pc = null;
    }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function showEmptyState(title, sub) {
    emptyTitle.textContent = title;
    emptySub.textContent = sub;
    videoEmpty.style.display = "flex";
    fullscreenButton.disabled = true;
}

function hideEmptyState() {
    videoEmpty.style.display = "none";
    fullscreenButton.disabled = false;
}

fullscreenButton.addEventListener("click", () => {
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        videoWrap.requestFullscreen?.();
    }
});

// ---------------------------------------------------------------------------
// Live stats (resolution + bitrate) via getStats()
// ---------------------------------------------------------------------------
function startStatsLoop() {
    if (statsTimer) clearInterval(statsTimer);
    statsTimer = setInterval(async () => {
        if (!pc) return;
        const stats = await pc.getStats(null);
        let inboundVideo = null;

        stats.forEach((report) => {
            if (report.type === "inbound-rtp" && report.kind === "video") {
                inboundVideo = report;
            }
        });

        if (!inboundVideo) return;

        const now = performance.now();
        let bitrateText = "—";

        if (lastStats) {
            const bytesDelta = inboundVideo.bytesReceived - lastStats.bytesReceived;
            const timeDelta = (now - lastStats.timestamp) / 1000;
            if (timeDelta > 0) {
                bitrateText = formatBitrate((bytesDelta * 8) / timeDelta);
            }
        }

        lastStats = { bytesReceived: inboundVideo.bytesReceived, timestamp: now };

        const w = remoteVideo.videoWidth;
        const h = remoteVideo.videoHeight;
        statPillsEl.innerHTML = `
            <span class="pill">${w && h ? `${w}\u00d7${h}` : "—"}</span>
            <span class="pill">${bitrateText}</span>
            <span class="pill">${inboundVideo.framesPerSecond ? Math.round(inboundVideo.framesPerSecond) + " fps" : "—"}</span>
        `;
    }, 2000);
}

window.addEventListener("beforeunload", () => {
    teardownConnection();
    socket.close();
});

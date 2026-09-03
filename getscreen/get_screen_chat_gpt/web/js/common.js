// Shared helpers used by index.js, host.js and viewer.js.

const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — avoids ambiguity

export function randomRoomCode(length = 6) {
    let code = "";
    for (let i = 0; i < length; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }
    return code;
}

export function isValidRoomCode(code) {
    return /^[A-Za-z0-9-]{4,32}$/.test(code || "");
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
let toastStack = null;

function getToastStack() {
    if (!toastStack) {
        toastStack = document.createElement("div");
        toastStack.className = "toast-stack";
        document.body.appendChild(toastStack);
    }
    return toastStack;
}

export function toast(message, type = "info", duration = 4000) {
    const stack = getToastStack();
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
        el.style.transition = "opacity 0.2s ease";
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 200);
    }, duration);
}

// ---------------------------------------------------------------------------
// Status indicator (dot + text)
// ---------------------------------------------------------------------------
export function setStatus(dotEl, textEl, state, text) {
    if (dotEl) {
        dotEl.className = `status-dot ${state}`;
    }
    if (textEl) {
        textEl.textContent = text;
    }
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------
export async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Fallback for browsers/contexts without Clipboard API access.
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        let ok = false;
        try {
            ok = document.execCommand("copy");
        } catch {
            ok = false;
        }
        textarea.remove();
        return ok;
    }
}

// ---------------------------------------------------------------------------
// ICE servers (fetched from the server so TURN creds never live in the client)
// ---------------------------------------------------------------------------
export async function fetchIceServers() {
    try {
        const res = await fetch("/ice-config");
        const data = await res.json();
        if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
            return data.iceServers;
        }
    } catch {
        // fall through to default
    }
    return [{ urls: "stun:stun.l.google.com:19302" }];
}

// ---------------------------------------------------------------------------
// Resilient signaling socket
// ---------------------------------------------------------------------------
// Small event-emitter wrapper around WebSocket that auto-reconnects with
// backoff and re-joins the room automatically after a drop.
export class SignalingSocket {
    constructor({ room, role }) {
        this.room = room;
        this.role = role;
        this.ws = null;
        this.listeners = new Map();
        this.reconnectAttempts = 0;
        this.manuallyClosed = false;
        this.connect();
    }

    on(type, callback) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type).add(callback);
        return () => this.listeners.get(type)?.delete(callback);
    }

    emit(type, payload) {
        for (const cb of this.listeners.get(type) || []) {
            cb(payload);
        }
    }

    connect() {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        this.ws = new WebSocket(`${protocol}//${location.host}/ws`);

        this.ws.onopen = () => {
            this.reconnectAttempts = 0;
            this.emit("open");
            this.send({ type: "join", room: this.room, role: this.role });
        };

        this.ws.onmessage = (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }
            this.emit("message", message);
            this.emit(message.type, message);
        };

        this.ws.onclose = () => {
            this.emit("close");
            if (!this.manuallyClosed) {
                this.scheduleReconnect();
            }
        };

        this.ws.onerror = () => {
            this.emit("error");
        };
    }

    scheduleReconnect() {
        this.reconnectAttempts += 1;
        const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 10_000);
        this.emit("reconnecting", { attempt: this.reconnectAttempts, delay });
        setTimeout(() => {
            if (!this.manuallyClosed) {
                this.connect();
            }
        }, delay);
    }

    send(obj) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
            return true;
        }
        return false;
    }

    close() {
        this.manuallyClosed = true;
        this.ws?.close();
    }
}

// ---------------------------------------------------------------------------
// ICE candidate queue — buffers candidates that arrive before the remote
// description is set (a common WebRTC race), then flushes them once ready.
// ---------------------------------------------------------------------------
export class CandidateQueue {
    constructor() {
        this.pending = [];
        this.ready = false;
    }

    markReady() {
        this.ready = true;
    }

    reset() {
        this.pending = [];
        this.ready = false;
    }

    async add(pc, candidate) {
        if (this.ready) {
            await pc.addIceCandidate(candidate).catch((err) => console.warn("ICE candidate error:", err));
        } else {
            this.pending.push(candidate);
        }
    }

    async flush(pc) {
        this.ready = true;
        const queued = this.pending.splice(0);
        for (const candidate of queued) {
            await pc.addIceCandidate(candidate).catch((err) => console.warn("ICE candidate error:", err));
        }
    }
}

// ---------------------------------------------------------------------------
// Stats formatting
// ---------------------------------------------------------------------------
export function formatBitrate(bitsPerSecond) {
    if (!bitsPerSecond || bitsPerSecond <= 0) return "0 kbps";
    if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`;
    return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

export function initials(id) {
    return (id || "??").slice(0, 2).toUpperCase();
}

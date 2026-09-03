# Mini Remote Desktop - FastAPI Backend

Self-hosted, peer-to-peer screen sharing with a Python FastAPI signaling server.
The browser clients use WebRTC for the actual screen stream; the server only
serves the static pages, provides ICE server configuration, and relays signaling
messages between a host and one or more viewers.

## Quick Start

```bash
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 3000
```

Open http://localhost:3000, click **Start sharing** to host a room, or click
**Join a session** and enter a room code to view.

## Project Layout

```text
server/
  main.py            FastAPI static file server + WebSocket signaling
  requirements.txt
web/
  index.html/js      Landing page
  host.html/js       Screen capture and multi-viewer WebRTC host
  viewer.html/js     WebRTC receiver
  js/common.js       Shared browser helpers
  style.css          Shared styles
original/
  get_scr/           Extracted source project for reference
```

## Optional TURN Configuration

Set `ICE_SERVERS` to a JSON array of `RTCIceServer` objects before starting the
server:

```bash
$env:ICE_SERVERS='[{"urls":"turn:turn.example.com:3478","username":"user","credential":"pass"}]'
uvicorn main:app --host 0.0.0.0 --port 3000
```

If `ICE_SERVERS` is unset or invalid, the app uses Google's public STUN server.

## Smoke Test

With the server running on port 3000:

```bash
python ..\scripts\smoke_test.py
```

The script opens one host socket and one viewer socket, then verifies the room
join and peer notification flow.

## Notes

- The frontend is intentionally kept vanilla: no bundler, no framework, no build
  step.
- `/ice-config` returns the same shape as the original Node backend.
- `/ws` accepts the same signaling messages: `join`, addressed `offer`,
  `answer`, `candidate`, and `share-stopped`.
- For internet deployment, use HTTPS/WSS. Browser screen capture APIs require a
  secure context outside localhost.

import json
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.websockets import WebSocketState


ROOM_ID_PATTERN = __import__("re").compile(r"^[A-Za-z0-9-]{4,32}$")
DEFAULT_ICE_SERVERS = [{"urls": "stun:stun.l.google.com:19302"}]

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR.parent / "web"


def resolve_ice_servers() -> list[dict[str, Any]]:
    raw = os.getenv("ICE_SERVERS")
    if not raw:
        return DEFAULT_ICE_SERVERS

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        print(f"Ignoring invalid ICE_SERVERS env var: {error}")
        return DEFAULT_ICE_SERVERS

    if isinstance(parsed, list) and parsed:
        return parsed

    return DEFAULT_ICE_SERVERS


ICE_SERVERS = resolve_ice_servers()


@dataclass
class Peer:
    websocket: WebSocket
    id: str


@dataclass
class Room:
    host: Peer | None = None
    viewers: dict[str, WebSocket] = field(default_factory=dict)


rooms: dict[str, Room] = {}


app = FastAPI(title="Mini Remote Desktop")
app.mount("/js", StaticFiles(directory=WEB_DIR / "js"), name="js")
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/index.html")
async def index_html() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/host.html")
async def host_html() -> FileResponse:
    return FileResponse(WEB_DIR / "host.html")


@app.get("/viewer.html")
async def viewer_html() -> FileResponse:
    return FileResponse(WEB_DIR / "viewer.html")


@app.get("/style.css")
async def stylesheet() -> FileResponse:
    return FileResponse(WEB_DIR / "style.css")


@app.get("/ice-config")
async def ice_config() -> dict[str, list[dict[str, Any]]]:
    return {"iceServers": ICE_SERVERS}


def get_or_create_room(room_id: str) -> Room:
    if room_id not in rooms:
        rooms[room_id] = Room()
    return rooms[room_id]


def remove_room_if_empty(room_id: str, room: Room) -> None:
    if room.host is None and not room.viewers:
        rooms.pop(room_id, None)


async def send(websocket: WebSocket | None, message: dict[str, Any]) -> None:
    if websocket and websocket.application_state == WebSocketState.CONNECTED:
        await websocket.send_json(message)


def find_peer_socket(room: Room, peer_id: str) -> WebSocket | None:
    if room.host and room.host.id == peer_id:
        return room.host.websocket
    return room.viewers.get(peer_id)


async def handle_join(
    websocket: WebSocket,
    peer_id: str,
    state: dict[str, str | None],
    message: dict[str, Any],
) -> None:
    room_id = str(message.get("room", "")).strip()
    role = message.get("role") if message.get("role") in {"host", "viewer"} else None

    if not ROOM_ID_PATTERN.match(room_id):
        await send(websocket, {"type": "error", "message": "Invalid room ID."})
        await websocket.close()
        return

    if role is None:
        await send(websocket, {"type": "error", "message": "Role must be 'host' or 'viewer'."})
        await websocket.close()
        return

    if state["room"] is not None:
        await send(websocket, {"type": "error", "message": "Already joined a room."})
        return

    room = get_or_create_room(room_id)

    if role == "host":
        if room.host and room.host.websocket.application_state == WebSocketState.CONNECTED:
            await send(websocket, {"type": "error", "message": "A host is already active in this room."})
            await websocket.close()
            return
        room.host = Peer(websocket=websocket, id=peer_id)
    else:
        room.viewers[peer_id] = websocket

    state["room"] = room_id
    state["role"] = role

    await send(
        websocket,
        {
            "type": "joined",
            "room": room_id,
            "role": role,
            "id": peer_id,
            "hostOnline": room.host is not None,
            "viewerIds": list(room.viewers.keys()) if role == "host" else None,
        },
    )

    if role == "host":
        for viewer_ws in room.viewers.values():
            await send(viewer_ws, {"type": "peer-joined", "id": peer_id, "role": "host"})
    elif room.host:
        await send(room.host.websocket, {"type": "peer-joined", "id": peer_id, "role": "viewer"})


async def handle_signal(
    websocket: WebSocket,
    peer_id: str,
    state: dict[str, str | None],
    message: dict[str, Any],
) -> None:
    room_id = state["room"]
    if room_id is None or room_id not in rooms:
        return

    target_id = message.get("to")
    if not isinstance(target_id, str):
        return

    target_ws = find_peer_socket(rooms[room_id], target_id)
    if not target_ws or target_ws is websocket:
        return

    forwarded = {key: value for key, value in message.items() if key not in {"to", "room"}}
    forwarded["from"] = peer_id
    await send(target_ws, forwarded)


async def handle_leave(peer_id: str, state: dict[str, str | None]) -> None:
    room_id = state["room"]
    role = state["role"]
    if room_id is None or room_id not in rooms:
        return

    room = rooms[room_id]

    if role == "host" and room.host and room.host.id == peer_id:
        room.host = None
        for viewer_ws in room.viewers.values():
            await send(viewer_ws, {"type": "peer-left", "id": peer_id, "role": "host"})
    elif role == "viewer":
        room.viewers.pop(peer_id, None)
        if room.host:
            await send(room.host.websocket, {"type": "peer-left", "id": peer_id, "role": "viewer"})

    state["room"] = None
    state["role"] = None
    remove_room_if_empty(room_id, room)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()

    peer_id = str(uuid.uuid4())
    state: dict[str, str | None] = {"room": None, "role": None}

    try:
        while True:
            try:
                message = await websocket.receive_json()
            except json.JSONDecodeError:
                continue

            if not isinstance(message, dict):
                continue

            if message.get("type") == "join":
                await handle_join(websocket, peer_id, state, message)
            elif "to" in message:
                await handle_signal(websocket, peer_id, state, message)
    except WebSocketDisconnect:
        pass
    finally:
        await handle_leave(peer_id, state)

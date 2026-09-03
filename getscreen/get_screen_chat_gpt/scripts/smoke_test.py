import asyncio
import json

import websockets


async def main() -> None:
    host = await websockets.connect("ws://127.0.0.1:3000/ws")
    await host.send(json.dumps({"type": "join", "room": "TEST1", "role": "host"}))
    host_joined = json.loads(await host.recv())

    viewer = await websockets.connect("ws://127.0.0.1:3000/ws")
    await viewer.send(json.dumps({"type": "join", "room": "TEST1", "role": "viewer"}))
    viewer_joined = json.loads(await viewer.recv())
    host_notified = json.loads(await host.recv())

    assert host_joined["type"] == "joined"
    assert host_joined["role"] == "host"
    assert viewer_joined["type"] == "joined"
    assert viewer_joined["role"] == "viewer"
    assert viewer_joined["hostOnline"] is True
    assert host_notified["type"] == "peer-joined"
    assert host_notified["role"] == "viewer"

    await viewer.close()
    await host.close()
    print("WebSocket signaling smoke test passed.")


asyncio.run(main())

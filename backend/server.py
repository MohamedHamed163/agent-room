"""FastAPI server: serves the 3D room and a WebSocket for live agent activity."""
import asyncio
import json

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .agents import AGENTS, roster, run_task
from .events import bus
from .llm import available_providers

app = FastAPI(title="Agent Room")
FRONTEND = config.ROOT / "frontend"
current: dict[str, asyncio.Task | None] = {"task": None}


@app.get("/")
async def index():
    return FileResponse(FRONTEND / "index.html")


@app.get("/api/info")
async def info():
    return {
        "agents": roster(),
        "providers": available_providers(),
        "github": bool(config.GITHUB_TOKEN),
        "approval": config.REQUIRE_APPROVAL,
        "workspace": str(config.WORKSPACE),
        "busy": bool(current["task"] and not current["task"].done()),
    }


async def start_task(text: str, target: str | None):
    if current["task"] and not current["task"].done():
        await bus.emit("notice", text="The team is busy. Stop the current task first.")
        return
    if not available_providers():
        await bus.emit("notice", text="No API keys found. Add OPENAI_API_KEY / GLM_API_KEY to .env and restart.")
        return
    await bus.say("human", text, to=target or "orchestrator")
    current["task"] = asyncio.create_task(run_task(text, target if target in AGENTS else None))


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await bus.connect(ws)
    await ws.send_text(json.dumps({"type": "hello", "info": await info()}))
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            kind = msg.get("type")
            if kind == "task" and msg.get("text", "").strip():
                await start_task(msg["text"].strip(), msg.get("target"))
            elif kind == "approval":
                bus.resolve_approval(msg["id"], bool(msg.get("approved")))
            elif kind == "stop":
                if current["task"] and not current["task"].done():
                    current["task"].cancel()
                    for fut in list(bus.pending.values()):
                        if not fut.done():
                            fut.set_result(False)
                    for k in AGENTS:
                        await bus.status(k, "idle", "")
                    await bus.emit("task_error", error="Stopped by you.")
    except WebSocketDisconnect:
        bus.disconnect(ws)


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")

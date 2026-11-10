"""Event bus: pushes live agent activity to every connected 3D room (WebSocket),
and handles human approval requests for risky computer actions."""
import asyncio
import json
import time
import uuid
from typing import Any

from fastapi import WebSocket


class EventBus:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.pending: dict[str, asyncio.Future] = {}
        self.history: list[dict] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def emit(self, type_: str, **data: Any) -> None:
        evt = {"type": type_, "ts": time.time(), **data}
        self.history = (self.history + [evt])[-300:]
        msg = json.dumps(evt, default=str)
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def status(self, agent: str, state: str, detail: str = "") -> None:
        """state: idle | thinking | working | tool | waiting | done | error"""
        await self.emit("agent_status", agent=agent, state=state, detail=detail[:300])

    async def say(self, agent: str, text: str, to: str | None = None) -> None:
        await self.emit("message", agent=agent, to=to, text=text)

    async def request_approval(self, agent: str, action: str, detail: str, timeout: float = 300) -> bool:
        rid = uuid.uuid4().hex[:8]
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self.pending[rid] = fut
        await self.status(agent, "waiting", f"Needs approval: {action}")
        await self.emit("approval_request", id=rid, agent=agent, action=action, detail=detail)
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            return False
        finally:
            self.pending.pop(rid, None)
            await self.emit("approval_closed", id=rid)
            await self.status(agent, "working", action)

    def resolve_approval(self, rid: str, approved: bool) -> None:
        fut = self.pending.get(rid)
        if fut and not fut.done():
            fut.set_result(approved)


bus = EventBus()

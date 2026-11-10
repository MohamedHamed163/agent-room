"""Computer-control tools. Risky actions (shell commands, opening apps, writing files)
pause and ask you for approval in the 3D room unless REQUIRE_APPROVAL=false."""
import asyncio
import contextvars
import platform
import subprocess
import time
import webbrowser
from pathlib import Path

from langchain_core.tools import tool

from .. import config
from ..events import bus

# Which agent is currently calling a tool (set by the graph before running a worker).
current_agent: contextvars.ContextVar[str] = contextvars.ContextVar("current_agent", default="operator")


async def _approve(action: str, detail: str) -> bool:
    if not config.REQUIRE_APPROVAL:
        return True
    return await bus.request_approval(current_agent.get(), action, detail)


def _resolve(path: str) -> Path:
    p = Path(path).expanduser()
    if not p.is_absolute():
        p = config.WORKSPACE / p
    return p.resolve()


def _in_workspace(p: Path) -> bool:
    return p == config.WORKSPACE or config.WORKSPACE in p.parents


@tool
async def run_shell(command: str, cwd: str = "") -> str:
    """Run a shell command on this computer (default working dir = the agents workspace).
    Use for git, tests, builds, installing packages, inspecting files etc."""
    workdir = _resolve(cwd) if cwd else config.WORKSPACE
    if not await _approve("Run shell command", f"$ {command}\n(in {workdir})"):
        return "DENIED by the human. Do not retry the same command; explain or choose another approach."
    try:
        proc = await asyncio.create_subprocess_shell(
            command, cwd=str(workdir), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=180)
        text = out.decode("utf-8", "replace")
        if len(text) > 8000:
            text = text[:3000] + "\n...[truncated]...\n" + text[-4000:]
        return f"exit code {proc.returncode}\n{text}"
    except asyncio.TimeoutError:
        proc.kill()
        return "Command timed out after 180s"


@tool
async def read_file(path: str) -> str:
    """Read a text file (relative paths are inside the workspace)."""
    p = _resolve(path)
    if not _in_workspace(p) and not await _approve("Read file outside workspace", str(p)):
        return "DENIED by the human."
    try:
        text = p.read_text("utf-8", "replace")
        return text if len(text) < 15000 else text[:15000] + "\n...[truncated]"
    except Exception as e:
        return f"Error: {e}"


@tool
async def write_file(path: str, content: str) -> str:
    """Create or overwrite a text file (relative paths are inside the workspace)."""
    p = _resolve(path)
    if not _in_workspace(p) and not await _approve("Write file outside workspace", f"{p}\n\n{content[:1500]}"):
        return "DENIED by the human."
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, "utf-8")
    return f"Wrote {len(content)} chars to {p}"


@tool
async def list_dir(path: str = "") -> str:
    """List a directory (default: the workspace)."""
    p = _resolve(path) if path else config.WORKSPACE
    try:
        items = sorted(p.iterdir())[:200]
        return "\n".join(("[dir] " if i.is_dir() else "") + i.name for i in items) or "(empty)"
    except Exception as e:
        return f"Error: {e}"


@tool
async def open_url(url: str) -> str:
    """Open a URL in the computer's default web browser."""
    if not await _approve("Open URL in browser", url):
        return "DENIED by the human."
    webbrowser.open(url)
    return f"Opened {url}"


@tool
async def open_application(name: str) -> str:
    """Open a desktop application by name (e.g. 'Visual Studio Code', 'Safari', 'Terminal')."""
    if not await _approve("Open application", name):
        return "DENIED by the human."
    if platform.system() == "Darwin":
        cmd = ["open", "-a", name]
    elif platform.system() == "Windows":
        cmd = ["cmd", "/c", "start", "", name]
    else:
        cmd = [name]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return f"Opened {name}" if r.returncode == 0 else f"Failed: {r.stderr[:500]}"


@tool
async def take_screenshot() -> str:
    """Take a screenshot of the screen and save it in the workspace. Returns the file path."""
    if not await _approve("Take screenshot", "Capture the screen to the workspace folder"):
        return "DENIED by the human."
    out = config.WORKSPACE / "screenshots" / f"shot_{int(time.time())}.png"
    out.parent.mkdir(exist_ok=True)
    if platform.system() == "Darwin":
        r = subprocess.run(["screencapture", "-x", str(out)], capture_output=True, text=True)
        return f"Saved {out}" if r.returncode == 0 else f"Failed: {r.stderr}"
    return "Screenshots only supported on macOS in this build."


FILE_TOOLS = [read_file, write_file, list_dir]
COMPUTER_TOOLS = [run_shell, *FILE_TOOLS, open_url, open_application, take_screenshot]

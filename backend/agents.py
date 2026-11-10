"""The agent team, wired together with LangGraph.

    user task ──► Orchestrator ──► (researcher | coder | github | operator) ──┐
                     ▲                                                       │
                     └──────────────── result ◄──────────────────────────────┘
                     └─► FINISH ─► final summary
"""
import json
import operator
import re
from typing import Annotated, Any, TypedDict

from langchain.agents import create_agent
from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from . import config
from .events import bus
from .llm import get_llm, provider_label
from .tools.computer_tools import COMPUTER_TOOLS, FILE_TOOLS, current_agent, run_shell
from .tools.github_tools import GITHUB_TOOLS

# ---------------------------------------------------------------- team roster
AGENTS: dict[str, dict[str, Any]] = {
    "orchestrator": {
        "name": "Atlas", "role": "Orchestrator", "color": "#f5c542",
        "desc": "Plans the work, delegates to teammates, reviews results.",
    },
    "researcher": {
        "name": "Nova", "role": "Researcher / Analyst", "color": "#4fc3f7",
        "desc": "Reads code and docs, analyses problems, writes plans and explanations. No side effects.",
        "tools": FILE_TOOLS,
        "prompt": "You are Nova, a sharp researcher and analyst. Investigate, read files, reason and "
                  "produce clear findings, plans or written content. You cannot run commands.",
    },
    "coder": {
        "name": "Byte", "role": "Software Engineer", "color": "#66bb6a",
        "desc": "Writes and edits code in the local workspace, runs tests and builds via shell.",
        "tools": [run_shell, *FILE_TOOLS],
        "prompt": "You are Byte, a senior software engineer. Write clean, working code into files in the "
                  "workspace, run it/tests with run_shell to verify, and fix errors. Report what you changed.",
    },
    "github": {
        "name": "Octo", "role": "GitHub Ops", "color": "#ab47bc",
        "desc": "Works on GitHub repos: list/read repos, clone, branches, commits, PRs, issues, comments.",
        "tools": [*GITHUB_TOOLS, run_shell],
        "prompt": "You are Octo, a GitHub operations expert. Use the gh_* tools to inspect repos, create "
                  "branches, commit files, open pull requests, manage issues. NEVER commit directly to the "
                  "default branch: always create a feature branch and open a PR. Clone repos with "
                  "gh_clone_repo when local work is needed. Always return the URLs of what you created.",
    },
    "operator": {
        "name": "Pixel", "role": "Computer Operator", "color": "#ff7043",
        "desc": "Controls this computer: shell commands, opening apps and URLs, screenshots, files.",
        "tools": COMPUTER_TOOLS,
        "prompt": "You are Pixel, a computer operator on the user's machine (OS: macOS likely). Use the tools "
                  "to carry out actions on the computer. Prefer safe, reversible commands. If an action is "
                  "DENIED, do not retry it; report back.",
    },
}
WORKERS = [k for k in AGENTS if k != "orchestrator"]


def roster() -> list[dict]:
    return [
        {"id": k, "name": v["name"], "role": v["role"], "color": v["color"], "desc": v["desc"],
         "model": provider_label(config.AGENT_PROVIDERS[k])}
        for k, v in AGENTS.items()
    ]


# ---------------------------------------------------------------- live telemetry
class RoomCallback(AsyncCallbackHandler):
    """Streams what an agent is doing to the 3D room."""

    def __init__(self, agent: str):
        self.agent = agent

    async def on_chat_model_start(self, serialized, messages, **kw):
        await bus.status(self.agent, "thinking", "Thinking…")

    async def on_tool_start(self, serialized, input_str, **kw):
        name = (serialized or {}).get("name", "tool")
        await bus.status(self.agent, "tool", f"{name}")
        await bus.emit("tool_call", agent=self.agent, tool=name, input=str(input_str)[:600])

    async def on_tool_end(self, output, **kw):
        text = getattr(output, "content", output)
        await bus.emit("tool_result", agent=self.agent, output=str(text)[:800])
        await bus.status(self.agent, "working", "Processing result")


# ---------------------------------------------------------------- graph state
class TeamState(TypedDict):
    task: str
    target: str | None
    log: Annotated[list[dict], operator.add]   # [{agent, instruction, result}]
    next: str
    instruction: str
    steps: int
    final: str


def _log_text(log: list[dict]) -> str:
    if not log:
        return "(nothing done yet)"
    return "\n\n".join(
        f"### Step {i + 1} – {AGENTS[e['agent']]['name']} ({e['agent']})\nInstruction: {e['instruction']}\n"
        f"Result:\n{e['result'][:3000]}" for i, e in enumerate(log))


def _parse_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    try:
        return json.loads(m.group(0)) if m else {}
    except json.JSONDecodeError:
        return {}


ORCH_PROMPT = """You are Atlas, the orchestrator of an AI agent team working in a shared office.
Your team:
{team}

Decide the single next step. Delegate ONE focused instruction to ONE teammate, or finish.
Respond ONLY with JSON:
{{"next": "<{options}|FINISH>", "instruction": "<precise instruction for that teammate, with all needed context such as repo names, paths, prior results>", "say": "<one short sentence you say out loud in the room>"}}

Rules: Don't repeat work already done. Pick FINISH when the task is complete, impossible, or after a teammate reports a blocker you can't route around. Workspace folder on disk: {ws}"""


async def orchestrator_node(state: TeamState) -> dict:
    steps = state.get("steps", 0)
    if steps >= config.MAX_STEPS:
        return {"next": "FINISH", "instruction": "", "steps": steps}

    await bus.status("orchestrator", "thinking", "Planning next step…")
    team = "\n".join(f"- {k} ({AGENTS[k]['name']}): {AGENTS[k]['desc']}" for k in WORKERS)
    sys = ORCH_PROMPT.format(team=team, options="|".join(WORKERS), ws=config.WORKSPACE)
    user = f"TASK FROM HUMAN:\n{state['task']}\n\n"
    if state.get("target") and not state["log"]:
        user += f"(The human addressed {state['target']} directly – delegate to them first.)\n\n"
    user += f"WORK SO FAR:\n{_log_text(state['log'])}"

    llm = get_llm(config.AGENT_PROVIDERS["orchestrator"], temperature=0)
    resp = await llm.ainvoke([SystemMessage(sys), HumanMessage(user)],
                             config={"callbacks": [RoomCallback("orchestrator")]})
    d = _parse_json(resp.content if isinstance(resp.content, str) else str(resp.content))
    nxt = d.get("next", "FINISH")
    if nxt not in WORKERS:
        nxt = "FINISH"
    if d.get("say"):
        await bus.say("orchestrator", d["say"], to=None if nxt == "FINISH" else nxt)
    if nxt != "FINISH":
        await bus.emit("delegate", frm="orchestrator", to=nxt, instruction=d.get("instruction", ""))
    await bus.status("orchestrator", "working" if nxt != "FINISH" else "thinking", f"→ {nxt}")
    return {"next": nxt, "instruction": d.get("instruction", state["task"]), "steps": steps + 1}


def make_worker(key: str):
    spec = AGENTS[key]

    async def worker_node(state: TeamState) -> dict:
        token = current_agent.set(key)
        await bus.status(key, "working", state["instruction"][:200])
        try:
            agent = create_agent(get_llm(config.AGENT_PROVIDERS[key]), spec["tools"],
                                 system_prompt=spec["prompt"] + f"\nWorkspace dir: {config.WORKSPACE}")
            context = f"Overall team task: {state['task']}\n\nPrevious team results:\n{_log_text(state['log'])}"
            out = await agent.ainvoke(
                {"messages": [HumanMessage(f"{context}\n\n=== YOUR INSTRUCTION ===\n{state['instruction']}")]},
                config={"callbacks": [RoomCallback(key)], "recursion_limit": 40},
            )
            result = out["messages"][-1].content
            if not isinstance(result, str):
                result = str(result)
        except Exception as e:  # report the failure back to the orchestrator instead of crashing
            result = f"ERROR: {type(e).__name__}: {e}"
            await bus.status(key, "error", result[:200])
        finally:
            current_agent.reset(token)
        await bus.say(key, result[:1500], to="orchestrator")
        await bus.emit("delegate", frm=key, to="orchestrator", instruction="report")
        await bus.status(key, "idle", "")
        return {"log": [{"agent": key, "instruction": state["instruction"], "result": result}]}

    return worker_node


async def finish_node(state: TeamState) -> dict:
    await bus.status("orchestrator", "thinking", "Writing final report…")
    llm = get_llm(config.AGENT_PROVIDERS["orchestrator"], temperature=0.3)
    resp = await llm.ainvoke([
        SystemMessage("You are Atlas, the team orchestrator. Write a concise final report to the human: what was "
                      "done, key results (include any URLs/paths), and anything left open. Use markdown."),
        HumanMessage(f"TASK: {state['task']}\n\nWORK LOG:\n{_log_text(state['log'])}"),
    ])
    final = resp.content if isinstance(resp.content, str) else str(resp.content)
    await bus.status("orchestrator", "idle", "")
    return {"final": final}


def build_graph():
    g = StateGraph(TeamState)
    g.add_node("orchestrator", orchestrator_node)
    for k in WORKERS:
        g.add_node(k, make_worker(k))
        g.add_edge(k, "orchestrator")
    g.add_node("finish", finish_node)
    g.add_edge(START, "orchestrator")
    g.add_conditional_edges("orchestrator", lambda s: "finish" if s["next"] == "FINISH" else s["next"],
                            {**{k: k for k in WORKERS}, "finish": "finish"})
    g.add_edge("finish", END)
    return g.compile()


graph = build_graph()


async def run_task(task: str, target: str | None = None) -> str:
    await bus.emit("task_started", task=task, target=target)
    try:
        out = await graph.ainvoke(
            {"task": task, "target": target, "log": [], "next": "", "instruction": "", "steps": 0, "final": ""},
            config={"recursion_limit": 100},
        )
        await bus.emit("task_done", report=out["final"])
        return out["final"]
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        await bus.emit("task_error", error=msg)
        for k in AGENTS:
            await bus.status(k, "idle", "")
        return msg

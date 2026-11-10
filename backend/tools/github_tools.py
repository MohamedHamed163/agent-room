"""GitHub tools (REST API + git). Needs GITHUB_TOKEN in .env with repo scope."""
import asyncio
import base64
import re

import httpx
from langchain_core.tools import tool

from .. import config

API = "https://api.github.com"


def _headers() -> dict:
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if config.GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {config.GITHUB_TOKEN}"
    return h


async def _gh(method: str, path: str, **kw):
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.request(method, f"{API}{path}", headers=_headers(), **kw)
    if r.status_code >= 400:
        return {"error": r.status_code, "message": r.text[:800]}
    return r.json() if r.text else {}


def _short(x, n: int = 6000) -> str:
    s = str(x)
    return s if len(s) <= n else s[:n] + f"\n...[truncated {len(s) - n} chars]"


@tool
async def gh_list_my_repos(limit: int = 30) -> str:
    """List repositories of the authenticated GitHub user (most recently updated first)."""
    data = await _gh("GET", "/user/repos", params={"per_page": min(limit, 100), "sort": "updated"})
    if isinstance(data, dict):
        return _short(data)
    return "\n".join(f"{r['full_name']} - {r.get('description') or ''} (default: {r['default_branch']})" for r in data)


@tool
async def gh_get_repo(repo: str) -> str:
    """Get info about a repo. repo = 'owner/name'."""
    d = await _gh("GET", f"/repos/{repo}")
    if "error" in d:
        return _short(d)
    keys = ["full_name", "description", "default_branch", "language", "stargazers_count", "open_issues_count", "html_url"]
    return _short({k: d.get(k) for k in keys})


@tool
async def gh_list_files(repo: str, path: str = "", ref: str = "") -> str:
    """List files/folders at a path in a repo. repo='owner/name'."""
    params = {"ref": ref} if ref else {}
    d = await _gh("GET", f"/repos/{repo}/contents/{path}", params=params)
    if isinstance(d, dict):
        return _short(d)
    return "\n".join(f"{'[dir] ' if i['type'] == 'dir' else ''}{i['path']}" for i in d)


@tool
async def gh_read_file(repo: str, path: str, ref: str = "") -> str:
    """Read a file's contents from a GitHub repo."""
    params = {"ref": ref} if ref else {}
    d = await _gh("GET", f"/repos/{repo}/contents/{path}", params=params)
    if "error" in d or "content" not in d:
        return _short(d)
    return _short(base64.b64decode(d["content"]).decode("utf-8", "replace"), 12000)


@tool
async def gh_create_branch(repo: str, new_branch: str, from_branch: str = "") -> str:
    """Create a new branch in a repo from from_branch (default branch if empty)."""
    if not from_branch:
        info = await _gh("GET", f"/repos/{repo}")
        from_branch = info.get("default_branch", "main")
    ref = await _gh("GET", f"/repos/{repo}/git/ref/heads/{from_branch}")
    if "error" in ref:
        return _short(ref)
    d = await _gh("POST", f"/repos/{repo}/git/refs", json={"ref": f"refs/heads/{new_branch}", "sha": ref["object"]["sha"]})
    return _short(d if "error" in d else f"Created branch {new_branch} from {from_branch}")


@tool
async def gh_write_file(repo: str, path: str, content: str, message: str, branch: str) -> str:
    """Create or update a file in a repo with a commit on the given branch.
    Never write directly to the default branch: create a branch first."""
    existing = await _gh("GET", f"/repos/{repo}/contents/{path}", params={"ref": branch})
    body = {"message": message, "content": base64.b64encode(content.encode()).decode(), "branch": branch}
    if isinstance(existing, dict) and existing.get("sha"):
        body["sha"] = existing["sha"]
    d = await _gh("PUT", f"/repos/{repo}/contents/{path}", json=body)
    return _short(d if "error" in d else f"Committed {path} to {branch}: {d['commit']['html_url']}")


@tool
async def gh_create_pull_request(repo: str, title: str, head: str, base: str = "", body: str = "") -> str:
    """Open a pull request from branch `head` into `base` (default branch if empty)."""
    if not base:
        base = (await _gh("GET", f"/repos/{repo}")).get("default_branch", "main")
    d = await _gh("POST", f"/repos/{repo}/pulls", json={"title": title, "head": head, "base": base, "body": body})
    return _short(d if "error" in d else f"PR #{d['number']} opened: {d['html_url']}")


@tool
async def gh_list_issues(repo: str, state: str = "open") -> str:
    """List issues (not PRs) in a repo."""
    d = await _gh("GET", f"/repos/{repo}/issues", params={"state": state, "per_page": 30})
    if isinstance(d, dict):
        return _short(d)
    return "\n".join(f"#{i['number']} {i['title']}" for i in d if "pull_request" not in i) or "No issues."


@tool
async def gh_list_pull_requests(repo: str, state: str = "open") -> str:
    """List pull requests in a repo."""
    d = await _gh("GET", f"/repos/{repo}/pulls", params={"state": state, "per_page": 30})
    if isinstance(d, dict):
        return _short(d)
    return "\n".join(f"#{p['number']} {p['title']} ({p['head']['ref']} -> {p['base']['ref']})" for p in d) or "No PRs."


@tool
async def gh_create_issue(repo: str, title: str, body: str = "") -> str:
    """Create an issue in a repo."""
    d = await _gh("POST", f"/repos/{repo}/issues", json={"title": title, "body": body})
    return _short(d if "error" in d else f"Issue #{d['number']} created: {d['html_url']}")


@tool
async def gh_comment(repo: str, number: int, body: str) -> str:
    """Comment on an issue or pull request."""
    d = await _gh("POST", f"/repos/{repo}/issues/{number}/comments", json={"body": body})
    return _short(d if "error" in d else f"Commented: {d['html_url']}")


@tool
async def gh_clone_repo(repo: str) -> str:
    """Clone 'owner/name' into the local workspace so the coder/operator can edit and run it.
    Returns the local folder path."""
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        return "Invalid repo name, use owner/name"
    dest = config.WORKSPACE / repo.replace("/", "__")
    if dest.exists():
        proc = await asyncio.create_subprocess_exec("git", "-C", str(dest), "pull", "--ff-only",
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        out, _ = await proc.communicate()
        return f"Already cloned at {dest}. git pull: {out.decode()[-500:]}"
    url = f"https://github.com/{repo}.git"
    if config.GITHUB_TOKEN:
        url = f"https://x-access-token:{config.GITHUB_TOKEN}@github.com/{repo}.git"
    proc = await asyncio.create_subprocess_exec("git", "clone", "--depth", "50", url, str(dest),
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    out, _ = await proc.communicate()
    text = out.decode().replace(config.GITHUB_TOKEN, "***") if config.GITHUB_TOKEN else out.decode()
    return f"Cloned to {dest}" if proc.returncode == 0 else f"Clone failed: {text[-800:]}"


GITHUB_TOOLS = [
    gh_list_my_repos, gh_get_repo, gh_list_files, gh_read_file, gh_create_branch, gh_write_file,
    gh_create_pull_request, gh_list_issues, gh_list_pull_requests, gh_create_issue, gh_comment, gh_clone_repo,
]

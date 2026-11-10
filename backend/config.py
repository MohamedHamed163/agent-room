"""Central configuration, loaded from .env."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL") or None

GLM_API_KEY = os.getenv("GLM_API_KEY", "")
GLM_MODEL = os.getenv("GLM_MODEL", "glm-4.6")
# Zhipu BigModel (China): https://open.bigmodel.cn/api/paas/v4/
# Z.ai (international):   https://api.z.ai/api/paas/v4/
GLM_BASE_URL = os.getenv("GLM_BASE_URL", "https://api.z.ai/api/paas/v4/")

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")

WORKSPACE = Path(os.getenv("WORKSPACE_DIR", ROOT / "workspace")).resolve()
WORKSPACE.mkdir(parents=True, exist_ok=True)

# When true, every computer action (shell, open app, write outside workspace...)
# waits for you to click "Approve" in the 3D room.
REQUIRE_APPROVAL = os.getenv("REQUIRE_APPROVAL", "true").lower() != "false"

# Which provider each agent uses: "openai" or "glm"
AGENT_PROVIDERS = {
    "orchestrator": os.getenv("ORCHESTRATOR_PROVIDER", "openai"),
    "researcher": os.getenv("RESEARCHER_PROVIDER", "openai"),
    "coder": os.getenv("CODER_PROVIDER", "glm"),
    "github": os.getenv("GITHUB_AGENT_PROVIDER", "openai"),
    "operator": os.getenv("OPERATOR_PROVIDER", "glm"),
}

MAX_STEPS = int(os.getenv("MAX_ORCHESTRATOR_STEPS", "8"))

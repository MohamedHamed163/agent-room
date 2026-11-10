"""LLM factory: ChatGPT (OpenAI) and GLM (Zhipu / Z.ai, OpenAI-compatible API)."""
from langchain_openai import ChatOpenAI

from . import config


def available_providers() -> list[str]:
    out = []
    if config.OPENAI_API_KEY:
        out.append("openai")
    if config.GLM_API_KEY:
        out.append("glm")
    return out


def get_llm(provider: str, temperature: float = 0.2) -> ChatOpenAI:
    avail = available_providers()
    if not avail:
        raise RuntimeError("No API keys set. Add OPENAI_API_KEY and/or GLM_API_KEY to .env")
    if provider not in avail:  # fall back to whichever key exists
        provider = avail[0]

    if provider == "glm":
        return ChatOpenAI(
            model=config.GLM_MODEL,
            api_key=config.GLM_API_KEY,
            base_url=config.GLM_BASE_URL,
            temperature=temperature,
        )
    return ChatOpenAI(
        model=config.OPENAI_MODEL,
        api_key=config.OPENAI_API_KEY,
        base_url=config.OPENAI_BASE_URL,
        temperature=temperature,
    )


def provider_label(provider: str) -> str:
    avail = available_providers()
    if provider not in avail and avail:
        provider = avail[0]
    return f"GLM · {config.GLM_MODEL}" if provider == "glm" else f"ChatGPT · {config.OPENAI_MODEL}"

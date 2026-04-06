"""
orchestrator.py

Runs an LLM reviewer (via safechain + ValidChatPromptTemplate) against the
Case Review Chat agentic backend. The reviewer LLM generates questions,
posts them to the backend via HTTP, and the agent responds via SSE.
The React UI shows the full conversation in real-time.

Usage:
    python orchestrator.py [--case CASE_ID] [--turns N] [--backend URL]
"""

import argparse
import json
import os
import threading
import time

import httpx
from dotenv import load_dotenv
load_dotenv()  # loads CONFIG_PATH (and other vars) from .env if present

from safechain import model
from safechain.prompts import ValidChatPromptTemplate

if not os.environ.get("CONFIG_PATH"):
    raise EnvironmentError(
        "CONFIG_PATH environment variable is not set.\n"
        "Set it to the path of your safechain config YAML, e.g.:\n"
        "  export CONFIG_PATH=/path/to/safechain_config.yaml\n"
        "Or create a .env file in this directory with:\n"
        "  CONFIG_PATH=/path/to/safechain_config.yaml"
    )

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_BACKEND = "http://localhost:3001"
DEFAULT_CASE_ID = "C-7891"
DEFAULT_MAX_TURNS = 5

# ---------------------------------------------------------------------------
# Load case context (one level up from this file)
# ---------------------------------------------------------------------------

with open("../consumer_data_dict.json", "r") as f:
    consumer_data_dict = json.load(f)
with open("../commercial_data_dict.json", "r") as f:
    commercial_data_dict = json.load(f)
with open("../consumer_context_dict.json", "r") as f:
    consumer_context_dict = json.load(f)
with open("../commercial_context_dict.json", "r") as f:
    commercial_context_dict = json.load(f)

prompt_base = (
    f"These are the available tables and variables for the case review task "
    f"from both consumer and commercial sides. "
    f"Consumer: {consumer_data_dict}. Commercial: {commercial_data_dict}.\n"
    f"These are the related contexts for each side. "
    f"Consumer: {consumer_context_dict}. Commercial: {commercial_context_dict}."
)

# ---------------------------------------------------------------------------
# LLM + prompt chain
# ---------------------------------------------------------------------------

llm = model("3")

reviewer_chain = ValidChatPromptTemplate.from_messages([
    ("system",
     "You are a professional financial case reviewer at a bank. "
     "You are interacting with an AI agent that has access to case data. "
     "Ask one focused, specific question per turn to uncover key facts about the case. "
     "Keep questions concise. Do not repeat questions already asked."),
    ("human", "{prompt_base}"),
    ("ai", "Sure, what would you like to know about the case?"),
    ("human", "{history}\n\nAsk your next question:"),
]) | llm

# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def format_history(thread: list[dict]) -> str:
    """Convert thread to a readable string for the prompt."""
    lines = []
    for m in thread:
        role = "Reviewer" if m["role"] == "reviewer" else "Agent"
        lines.append(f"{role}: {m['text']}")
    return "\n".join(lines) if lines else "(no conversation yet)"


def post_reviewer_message(backend: str, case_id: str, text: str) -> None:
    try:
        httpx.post(
            f"{backend}/api/cases/{case_id}/message",
            json={"text": text},
            timeout=10,
        )
    except Exception as e:
        print(f"[ERROR] Failed to post message: {e}")


def listen_sse(backend: str, case_id: str, thread: list[dict], stop: threading.Event) -> None:
    url = f"{backend}/api/cases/{case_id}/stream"
    try:
        with httpx.stream("GET", url, timeout=None) as r:
            for line in r.iter_lines():
                if stop.is_set():
                    break
                if line.startswith("data:"):
                    try:
                        msg = json.loads(line[5:].strip())
                        thread.append(msg)
                        print(f"[Agent]    {msg['text']}")
                    except json.JSONDecodeError:
                        pass
    except Exception as e:
        print(f"[ERROR] SSE connection failed: {e}")


def wait_for_agent_response(thread: list[dict], prev_len: int, timeout: int = 30) -> bool:
    """Block until a new agent message appears in the thread, or timeout."""
    for _ in range(timeout):
        time.sleep(1)
        if len(thread) > prev_len and thread[-1]["role"] == "agent":
            return True
    return False


def run(case_id: str, backend: str, max_turns: int) -> None:
    print(f"\n{'='*60}")
    print(f"Case Review Demo — Case: {case_id}")
    print(f"Backend: {backend}  |  Max turns: {max_turns}")
    print(f"{'='*60}\n")

    thread: list[dict] = []
    stop = threading.Event()

    # Start SSE listener in background
    listener = threading.Thread(
        target=listen_sse,
        args=(backend, case_id, thread, stop),
        daemon=True,
    )
    listener.start()

    # Wait for agent's opening message
    print("[System] Waiting for agent to open the case...")
    time.sleep(2)

    for turn in range(1, max_turns + 1):
        print(f"\n--- Turn {turn}/{max_turns} ---")

        # Reviewer LLM generates next question
        question = reviewer_chain.invoke({
            "prompt_base": prompt_base,
            "history": format_history(thread),
        }).content

        print(f"[Reviewer] {question}")
        thread.append({"role": "reviewer", "text": question})
        post_reviewer_message(backend, case_id, question)

        # Wait for agent response via SSE
        prev_len = len(thread)
        responded = wait_for_agent_response(thread, prev_len, timeout=30)
        if not responded:
            print("[WARNING] Agent did not respond within 30s, continuing...")

    stop.set()
    print(f"\n{'='*60}")
    print("Review session complete.")
    print(f"{'='*60}\n")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Case Review LLM Orchestrator")
    parser.add_argument("--case", default=DEFAULT_CASE_ID, help="Case ID to review")
    parser.add_argument("--turns", type=int, default=DEFAULT_MAX_TURNS, help="Number of reviewer turns")
    parser.add_argument("--backend", default=DEFAULT_BACKEND, help="Backend base URL")
    args = parser.parse_args()

    run(case_id=args.case, backend=args.backend, max_turns=args.turns)

"""
Agentic Tutor Extension Modules

Adds personality, decision intelligence, idle engagement, and speech intent
analysis to the existing Socratic tutoring loop without altering core architecture.

Modules:
  TutorPersonalityLayer     — personality-aware session_meta enrichment
  TutorAgentDecisionEngine  — tracks student state, emits action hints
  TutorAgentState           — per-session student state dataclass
  IdleEngagementHandler     — fires soft re-engagement on silence
  SpeechIntentAnalyzer      — classifies transcripts as directed vs ambient
  AudioClassifier           — classifies raw PCM bytes (SILENCE/NOISE/SPEECH)
"""

from __future__ import annotations

import asyncio
import re
import struct
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional


# ---------------------------------------------------------------------------
# Personality addendum — appended to the tutoring system prompt
# ---------------------------------------------------------------------------

PERSONALITY_ADDENDUM = """
PERSONALITY AND BEHAVIOR RULES:
• Honest: If uncertain, say "I'm not completely sure — let's reason through this together."
• Patient: Never say "this is simple", "obviously", or "easy". Frame difficulty as normal.
  Example: "Many students find this tricky at first — that's completely normal."
• Flexible: If confusion is detected, switch explanation style (analogy, example, visual, slower breakdown).
  Do NOT repeat the same explanation verbatim.
• Empathetic listener: Address confusion or hesitation in the student's message BEFORE continuing the lesson.
• Collaborative: Frame as partnership — "Let's work through this together."
• Meta-learning: Occasionally suggest a strategy — "Drawing a quick diagram often helps here."
• Humble: If a detail may need verification, say so rather than asserting with false certainty.

CONFUSION SIGNALS (switch explanation style when detected):
Keywords: confused, don't understand, lost, not sure, what?, huh, makes no sense, can't follow
→ Switch to analogy OR concrete real-world example OR slower visual step-by-step
→ Do NOT repeat the same explanation verbatim

POST-CONCEPT SUGGESTIONS:
After every check_in AND after completing a concept group (every 3–4 steps), include:
"suggestions": ["Go deeper into the theory", "See a real-world example", "Try a practice problem", "Move to the next concept"]

AGENTIC ACTION HINTS (injected via AGENT_HINT in prompt):
• re_explain      → Use a completely different approach (analogy, example, diagram) — do not repeat old explanation
• provide_example → Lead with a concrete real-world use case before any theory
• ask_socratic    → Open with a guiding question before explaining
• suggest_path    → Present 2–3 possible directions the student can choose from
"""


# ---------------------------------------------------------------------------
# TutorPersonalityLayer
# ---------------------------------------------------------------------------

class TutorPersonalityLayer:
    """Enriches tutoring system prompts and session_meta with personality signals."""

    @staticmethod
    def enrich_prompt(base_prompt: str) -> str:
        """Append personality rules to a base system prompt."""
        return base_prompt + "\n" + PERSONALITY_ADDENDUM

    @staticmethod
    def inject_meta(
        session_meta: Dict[str, Any],
        agent_state: "TutorAgentState",
    ) -> Dict[str, Any]:
        """Add agent decision signals to session_meta before passing to Gemini."""
        meta = dict(session_meta)
        action = agent_state.decide_action()
        if action != "continue":
            meta["action_hint"] = action
        if agent_state.confusion_count >= 2:
            meta["confusion_level"] = "high"
        elif agent_state.confusion_count == 1:
            meta["confusion_level"] = "medium"
        return meta


# ---------------------------------------------------------------------------
# TutorAgentState
# ---------------------------------------------------------------------------

_CONFUSION_RE = re.compile(
    r"\b(confused|don.t understand|not sure|lost|what\?|huh|makes no sense|"
    r"can.t follow|i.m confused|unclear|no idea|repeat|say that again|"
    r"didn.t get|didn.t understand|what does that mean|don.t get it)\b",
    re.IGNORECASE,
)

_CURIOSITY_RE = re.compile(
    r"\b(why|how does|what if|can you show|example|tell me more|interesting|"
    r"go deeper|more detail|expand on|elaborate)\b",
    re.IGNORECASE,
)


@dataclass
class TutorAgentState:
    topic: str = ""
    current_step: int = 0
    confusion_count: int = 0          # consecutive confused responses
    correct_count: int = 0            # consecutive positive responses
    unanswered_questions: List[str] = field(default_factory=list)
    covered_concepts: List[str] = field(default_factory=list)
    last_interaction: float = field(default_factory=time.monotonic)
    steps_since_example: int = 0
    _action_override: Optional[str] = field(default=None, repr=False)

    def record_student_message(self, text: str) -> None:
        self.last_interaction = time.monotonic()
        if _CONFUSION_RE.search(text):
            self.confusion_count += 1
            self.correct_count = 0
        elif _CURIOSITY_RE.search(text):
            self.confusion_count = max(0, self.confusion_count - 1)
            self.correct_count = min(self.correct_count + 1, 5)
        else:
            # neutral — decay confusion slowly
            if self.confusion_count > 0:
                self.confusion_count = max(0, self.confusion_count - 1)
            self.correct_count = min(self.correct_count + 1, 5)

    def record_step_advance(self, step: int, concept: Optional[str] = None) -> None:
        self.current_step = step
        self.steps_since_example += 1
        if concept and concept not in self.covered_concepts:
            self.covered_concepts.append(concept)

    def decide_action(self) -> str:
        if self._action_override:
            action = self._action_override
            self._action_override = None
            return action
        if self.confusion_count >= 3:
            return "re_explain"
        if self.confusion_count == 2:
            return "provide_example"
        if self.steps_since_example >= 5:
            self.steps_since_example = 0
            return "ask_socratic"
        return "continue"

    def idle_seconds(self) -> float:
        return time.monotonic() - self.last_interaction


# ---------------------------------------------------------------------------
# TutorAgentDecisionEngine
# ---------------------------------------------------------------------------

class TutorAgentDecisionEngine:
    """Tracks per-session student state and emits tutor action hints."""

    def __init__(self) -> None:
        self._states: Dict[str, TutorAgentState] = {}

    def get_or_create(self, session_id: str) -> TutorAgentState:
        if session_id not in self._states:
            self._states[session_id] = TutorAgentState()
        return self._states[session_id]

    def remove(self, session_id: str) -> None:
        self._states.pop(session_id, None)

    def update_from_student(self, session_id: str, transcript: str) -> None:
        self.get_or_create(session_id).record_student_message(transcript)

    def update_from_response(self, session_id: str, response: Dict[str, Any]) -> None:
        state = self.get_or_create(session_id)
        if isinstance(response, dict) and response.get("kind") == "step":
            state.record_step_advance(
                int(response.get("step", state.current_step)),
                response.get("subtopic_id"),
            )

    def next_action(self, session_id: str) -> str:
        return self.get_or_create(session_id).decide_action()


# ---------------------------------------------------------------------------
# IdleEngagementHandler
# ---------------------------------------------------------------------------

_IDLE_MESSAGES = [
    "While you're thinking — want to see how this concept shows up in the real world?",
    "I can draw a diagram if a visual would make this clearer. Just say the word.",
    "Many students find a quick practice problem helpful at this point. Want to try one?",
    "Take your time. We can go deeper into the theory or jump to the next idea whenever you're ready.",
    "Here's a small insight that helps many students: most confusion at this stage comes from the notation, not the concept itself.",
    "No rush. When you're ready we can also look at this from a completely different angle.",
]

_idle_indices: Dict[str, int] = {}


def _next_idle_message(session_id: str) -> str:
    idx = _idle_indices.get(session_id, 0)
    msg = _IDLE_MESSAGES[idx % len(_IDLE_MESSAGES)]
    _idle_indices[session_id] = idx + 1
    return msg


class IdleEngagementHandler:
    """
    Sends a gentle re-engagement message when a tutoring session has been
    silent for `silence_threshold` seconds.

    Usage:
        handler = IdleEngagementHandler()
        # call reset() after every student message and every AI response
        await handler.reset(session_id, send_fn)
        # call cancel() when session ends
        handler.cancel(session_id)
    """

    def __init__(self, silence_threshold: float = 45.0) -> None:
        self.silence_threshold = silence_threshold
        self._tasks: Dict[str, asyncio.Task] = {}

    async def reset(
        self,
        session_id: str,
        send_fn: Callable[[Dict[str, Any]], Any],
    ) -> None:
        """Reset the idle timer. Call after any interaction."""
        self.cancel(session_id)
        self._tasks[session_id] = asyncio.create_task(
            self._idle_task(session_id, send_fn)
        )

    def cancel(self, session_id: str) -> None:
        """Cancel any pending idle timer."""
        task = self._tasks.pop(session_id, None)
        if task and not task.done():
            task.cancel()

    async def _idle_task(
        self,
        session_id: str,
        send_fn: Callable[[Dict[str, Any]], Any],
    ) -> None:
        try:
            await asyncio.sleep(self.silence_threshold)
            message = _next_idle_message(session_id)
            await send_fn({
                "kind": "barge_in",
                "narration": message,
                "text": message,
                "visual_content": None,
                "avatar_intent": {"expression": "neutral", "gesture": "idle"},
                "avatar_state":  {"expression": "neutral", "gesture": "idle"},
                "source": "idle_engagement",
            })
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            print(f"[IdleEngagementHandler:{session_id}] {exc}")


# ---------------------------------------------------------------------------
# SpeechIntentAnalyzer
# ---------------------------------------------------------------------------

_DIRECTED_RE = re.compile(
    r"\b(you|can you|could you|please|explain|what is|what are|what does|"
    r"how|why|wait|i don.t|i dont|don.t understand|confused|show me|tell me|"
    r"go back|repeat|example|help|is that|does that|are you|what did you|"
    r"make sense|next|continue|move on|got it|yes|no|okay|sure|alright|"
    r"i see|i get|i understand|never mind|skip|stop|pause)\b",
    re.IGNORECASE,
)


class SpeechIntentAnalyzer:
    """
    Classifies a transcript as directed at the tutor (HUMAN_SPEECH_DIRECTED)
    or ambient/background conversation (HUMAN_SPEECH_AMBIENT).

    Uses lightweight regex heuristics — no LLM call required.
    """

    @staticmethod
    def is_directed(transcript: str) -> bool:
        if not transcript or not transcript.strip():
            return False
        # Very short utterances (≤4 words) are almost always directed
        if len(transcript.split()) <= 4:
            return True
        # Contains a question mark → likely directed
        if "?" in transcript:
            return True
        return bool(_DIRECTED_RE.search(transcript))

    @staticmethod
    def classify(transcript: str) -> str:
        """
        Returns one of:
            HUMAN_SPEECH_DIRECTED  — speech addressed to the tutor
            HUMAN_SPEECH_AMBIENT   — background/side conversation, ignore
            EMPTY                  — no transcribable speech
        """
        if not transcript or not transcript.strip():
            return "EMPTY"
        return (
            "HUMAN_SPEECH_DIRECTED"
            if SpeechIntentAnalyzer.is_directed(transcript)
            else "HUMAN_SPEECH_AMBIENT"
        )


# ---------------------------------------------------------------------------
# AudioClassifier  (raw 16-bit PCM)
# ---------------------------------------------------------------------------

class AudioClassifier:
    """
    Classifies raw 16-bit little-endian PCM audio frames by RMS energy.

    Categories:
        HUMAN_SPEECH       — RMS above speech threshold
        BACKGROUND_NOISE   — low but non-zero RMS
        SILENCE            — RMS below noise floor

    NOTE: For Gemini Live sessions, VAD is handled natively by the model.
    Use this classifier for pre-filtering in non-Live audio pipelines or for
    tracking whether the user is actively speaking on the backend side.
    """

    SILENCE_THRESHOLD = 250    # RMS below this → SILENCE
    NOISE_THRESHOLD = 900      # RMS below this (but above silence) → BACKGROUND_NOISE

    @classmethod
    def classify(cls, pcm_bytes: bytes) -> str:
        if len(pcm_bytes) < 2:
            return "SILENCE"
        n_samples = len(pcm_bytes) // 2
        try:
            samples = struct.unpack(f"<{n_samples}h", pcm_bytes[: n_samples * 2])
        except struct.error:
            return "SILENCE"
        if n_samples == 0:
            return "SILENCE"
        rms = (sum(s * s for s in samples) / n_samples) ** 0.5
        if rms < cls.SILENCE_THRESHOLD:
            return "SILENCE"
        if rms < cls.NOISE_THRESHOLD:
            return "BACKGROUND_NOISE"
        return "HUMAN_SPEECH"

"""
Coaching Engine
Manages coaching modes, barge-in detection, and AI response generation
"""

from typing import Any, Dict, List, Optional
import asyncio
import json
from datetime import datetime

from gemini_client import GeminiClient
from session_manager import SessionManager
from tutor_agent import TutorAgentDecisionEngine, TutorPersonalityLayer


class CoachingEngine:
    """Main coaching intelligence engine."""

    def __init__(self, gemini_client: GeminiClient, session_manager: SessionManager):
        self.gemini = gemini_client
        self.session_manager = session_manager
        self.barge_in_detector = BargeInDetector()
        self.decision_engine = TutorAgentDecisionEngine()
        self.personality = TutorPersonalityLayer()

    def _normalize_avatar_payload(self, payload: Dict[str, Any]) -> Dict[str, str]:
        raw = payload.get("avatar_intent") or payload.get("avatar_state") or {}
        return {
            "expression": raw.get("expression", "neutral"),
            "gesture": raw.get("gesture", "idle"),
        }

    def _parse_draw_directive(self, text: Any) -> Optional[Dict[str, str]]:
        if not text:
            return None
        raw = str(text).strip()
        if not raw.startswith("DRAW_"):
            return None
        parts = raw.split(":", 1)
        command = parts[0].strip()
        detail = parts[1].strip() if len(parts) > 1 else ""
        if not command:
            return None
        return {"command": command, "detail": detail}

    async def process_audio(self, session_id: str, audio_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process incoming audio data and generate response."""
        session = await self.session_manager.get_session(session_id)
        if not session:
            return {"type": "error", "message": f"Session {session_id} not found"}

        mode = session["mode"]
        transcript = audio_data.get("transcript", "")

        biometric_data = await self.session_manager.get_latest_biometric(session_id)
        should_barge_in = None
        if mode != "public_speaking":
            should_barge_in = self.barge_in_detector.should_trigger(
                transcript=transcript,
                biometric_data=biometric_data,
                sensitivity=session.get("barge_in_sensitivity", 0.7),
            )

        if should_barge_in:
            return await self._handle_barge_in(session_id, should_barge_in)

        if mode == "tutoring":
            response = await self._tutoring_response(session_id, transcript, biometric_data)
        elif mode == "interview":
            response = await self._interview_response(session_id, transcript)
        elif mode == "public_speaking":
            response = await self._public_speaking_response(session_id, transcript)
        else:
            response = await self._default_response(session_id, transcript)

        assistant_text = response.get("voice_text") or response.get("narration") or response.get("text", "")
        visual_content = response.get("visual_content", "")
        if not visual_content and isinstance(response.get("visual"), dict):
            visual_content = response["visual"].get("content") or ""

        await self.session_manager.add_interaction(
            session_id,
            {
                "role": "assistant",
                "content": assistant_text,
                "visual_content": visual_content,
                "timestamp": datetime.now().isoformat(),
            },
        )

        if response.get("kind") in {"step", "check_in"} or response.get("type"):
            return response

        return {"type": "coach_response", **response}

    async def process_text(self, session_id: str, text: str) -> Dict[str, Any]:
        """Process text message with structured response."""
        session = await self.session_manager.get_session(session_id)
        if not session:
            return {"type": "error", "message": f"Session {session_id} not found"}

        mode = session.get("mode", "tutoring")

        if mode == "interview":
            return await self._handle_interview_flow(session_id, text)

        if mode == "public_speaking":
            return await self._handle_public_speaking_flow(session_id, text)

        await self.session_manager.add_interaction(
            session_id,
            {
                "role": "user",
                "content": text,
                "timestamp": datetime.now().isoformat(),
            },
        )

        updated_session = await self.session_manager.get_session(session_id)
        messages = updated_session.get("context_history", [])

        session_meta: Dict[str, Any] = {}
        if mode == "tutoring":
            session_meta["current_step"] = int(session.get("tutoring_step", 0))

        # Enrich session_meta with agentic student state signals
        if mode == "tutoring":
            self.decision_engine.update_from_student(session_id, text)
            session_meta = self.personality.inject_meta(
                session_meta, self.decision_engine.get_or_create(session_id)
            )

        response_data = await self.gemini.generate_structured_response(
            messages,
            mode,
            session_meta=session_meta,
        )

        if isinstance(response_data, dict) and response_data.get("kind") in {"step", "check_in"}:
            avatar_payload = self._normalize_avatar_payload(response_data)
            response_data["avatar_intent"] = avatar_payload
            response_data["avatar_state"] = avatar_payload

            if response_data.get("kind") == "step":
                current_step = int(session.get("tutoring_step", 0))
                proposed_step = response_data.get("step")
                if not isinstance(proposed_step, int) or proposed_step <= current_step:
                    response_data["step"] = current_step + 1
                session["tutoring_step"] = int(response_data["step"])

                if not response_data.get("narration"):
                    response_data["narration"] = (
                        response_data.get("voice_text")
                        or response_data.get("visual_content", "")
                    )
                visual_content = response_data.get("visual_content")
                draw_directive = self._parse_draw_directive(visual_content)

                if "visual" not in response_data and visual_content:
                    if draw_directive:
                        response_data["visual"] = {
                            "type": "diagram",
                            "content": draw_directive,
                        }
                    else:
                        response_data["visual"] = {
                            "type": "none",
                            "content": visual_content,
                        }

                if isinstance(response_data.get("visual"), dict):
                    visual_payload = response_data["visual"]
                    visual_type = visual_payload.get("type")
                    if visual_type in (None, "none") and draw_directive:
                        response_data["visual"] = {
                            "type": "diagram",
                            "content": draw_directive,
                        }
                    elif visual_type == "diagram":
                        visual_content_value = visual_payload.get("content")
                        if isinstance(visual_content_value, str):
                            parsed = self._parse_draw_directive(visual_content_value)
                            if parsed:
                                response_data["visual"]["content"] = parsed

            narration = response_data.get("narration", "")
            visual_payload = response_data.get("visual")
            visual_content = ""
            if isinstance(visual_payload, dict):
                visual_content = visual_payload.get("content") or ""

            await self.session_manager.add_interaction(
                session_id,
                {
                    "role": "assistant",
                    "content": narration,
                    "visual_content": visual_content,
                    "timestamp": datetime.now().isoformat(),
                },
            )
            if mode == "tutoring":
                self.decision_engine.update_from_response(session_id, response_data)
            return response_data

        if isinstance(response_data, dict) and response_data.get("type") == "error":
            if mode == "tutoring":
                avatar_payload = {"expression": "concerned", "gesture": "idle"}
                return {
                    "kind": "step",
                    "step": 1,
                    "subtopic_id": "intro",
                    "narration": "I hit a temporary issue reaching the coaching model. Please restate the topic in one short phrase and I will continue.",
                    "visual": {"type": "none", "content": None},
                    "avatar_intent": avatar_payload,
                    "avatar_state": avatar_payload,
                    "error": response_data.get("visual_content") or response_data.get("message"),
                }

            avatar_payload = {"expression": "concerned", "gesture": "idle"}
            return {
                "type": "coach_response",
                "voice_text": "I hit a temporary issue reaching the coaching model. Please repeat that.",
                "visual_content": "Temporary connection issue. Try again in a moment.",
                "avatar_intent": avatar_payload,
                "avatar_state": avatar_payload,
                "pedagogical_state": "error",
                "timestamp": datetime.now().isoformat(),
            }

        if mode == "tutoring" and isinstance(response_data, dict) and response_data.get("kind") is None:
            session["tutoring_step"] = int(session.get("tutoring_step", 0)) + 1
            avatar_payload = self._normalize_avatar_payload(response_data)
            return {
                "kind": "step",
                "step": session["tutoring_step"],
                "subtopic_id": "auto",
                "narration": (
                    response_data.get("voice_text")
                    or response_data.get("visual_content", "")
                    or "Let us begin with the core idea."
                ),
                "visual": {"type": "none", "content": response_data.get("visual_content")},
                "avatar_intent": avatar_payload,
                "avatar_state": avatar_payload,
                "pedagogical_state": response_data.get("pedagogical_state", "explaining"),
            }

        avatar_payload = self._normalize_avatar_payload(response_data)
        await self.session_manager.add_interaction(
            session_id,
            {
                "role": "assistant",
                "content": response_data.get("voice_text", ""),
                "visual_content": response_data.get("visual_content", ""),
                "timestamp": datetime.now().isoformat(),
            },
        )

        return {
            "type": "coach_response",
            "voice_text": response_data.get("voice_text", ""),
            "visual_content": response_data.get("visual_content", ""),
            "avatar_intent": avatar_payload,
            "avatar_state": avatar_payload,
            "pedagogical_state": response_data.get("pedagogical_state", "explaining"),
            "timestamp": datetime.now().isoformat(),
        }

    async def _handle_interview_flow(self, session_id: str, text: str) -> Dict[str, Any]:
        session = await self.session_manager.get_session(session_id)
        if not session:
            return {"type": "error", "message": f"Session {session_id} not found"}

        state = session.get("interview_state") or {}
        if not state:
            state = {
                "stage": "init",
                "role": "",
                "job_description": "",
                "resume": "",
                "started": False,
                "start_time": None,
                "question_count": 0,
                "max_questions": 10,
                "min_questions": 6,
                "target_minutes": 10,
                "max_minutes": 15,
                "current_question": "",
                "current_section": "",
                "hint_used": False,
                "last_question_time": None,
            }

        normalized_text = (text or "").strip()
        lower_text = normalized_text.lower()

        if normalized_text.startswith("BEGIN_INTERVIEW"):
            payload_text = normalized_text.split("::", 1)[1] if "::" in normalized_text else ""
            payload = {}
            if payload_text:
                try:
                    payload = json.loads(payload_text)
                except Exception:
                    payload = {}

            state["job_description"] = payload.get("job_description", "")
            state["resume"] = payload.get("resume", "")
            state["role"] = payload.get("role", state.get("role", ""))

            if not state.get("job_description"):
                state["stage"] = "job_desc"
                session["interview_state"] = state
                await self.session_manager._save_session(session_id)
                return self._interview_prompt(
                    "Paste job description (optional).",
                    "Interview setup",
                )

            state["stage"] = "ready"
            session["interview_state"] = state
            await self.session_manager._save_session(session_id)
            return self._interview_prompt(
                "Thanks. This will be a 10-minute interview. Ready?",
                "Say Yes to begin",
            )

        if lower_text == "end":
            await self.session_manager.end_session(session_id)
            report = await self.generate_vibe_report(session_id)
            return {"type": "session_ended", "report": report}

        await self.session_manager.add_interaction(
            session_id,
            {
                "role": "user",
                "content": normalized_text,
                "timestamp": datetime.now().isoformat(),
            },
        )

        if state.get("stage") == "init":
            state["stage"] = "role"
            session["interview_state"] = state
            await self.session_manager._save_session(session_id)
            return self._interview_prompt(
                "What role are you interviewing for?",
                "Interview setup",
            )

        if state.get("stage") == "role":
            state["role"] = normalized_text
            state["stage"] = "job_desc"
            session["interview_state"] = state
            await self.session_manager._save_session(session_id)
            return self._interview_prompt(
                "Paste job description (optional).",
                "Interview setup",
            )

        if state.get("stage") == "job_desc":
            if not self._is_skip(lower_text):
                state["job_description"] = normalized_text
            state["stage"] = "resume"
            session["interview_state"] = state
            await self.session_manager._save_session(session_id)
            return self._interview_prompt(
                "Upload resume (optional).",
                "Interview setup",
            )

        if state.get("stage") == "resume":
            if not self._is_skip(lower_text):
                state["resume"] = normalized_text
            state["stage"] = "ready"
            session["interview_state"] = state
            await self.session_manager._save_session(session_id)
            return self._interview_prompt(
                "Thanks. This will be a 10-minute interview. Ready?",
                "Say Yes to begin",
            )

        if state.get("stage") == "ready":
            if not self._is_yes(lower_text):
                return self._interview_prompt(
                    "No problem. Tell me when you are ready.",
                    "Waiting",
                )

            state["stage"] = "interview"
            state["started"] = True
            state["start_time"] = datetime.now().isoformat()
            session["interview_state"] = state
            await self.session_manager._save_session(session_id)
            return await self._ask_next_interview_question(session_id, state, feedback=None)

        if self._should_end_interview(state):
            await self.session_manager.end_session(session_id)
            report = await self.generate_vibe_report(session_id)
            return {"type": "session_ended", "report": report}

        # Evaluate answer and decide next step
        evaluation = await self._evaluate_interview_answer(state, normalized_text)

        if state.get("current_section") == "technical":
            if state.get("last_question_time"):
                elapsed = (datetime.now() - datetime.fromisoformat(state["last_question_time"]))
                if elapsed.total_seconds() > 90:
                    state["hint_used"] = True
                    session["interview_state"] = state
                    await self.session_manager._save_session(session_id)
                    feedback = "Let us move to the next question."
                    return await self._ask_next_interview_question(session_id, state, feedback=feedback)

            if evaluation.get("evaluation") == "weak" and not state.get("hint_used"):
                state["hint_used"] = True
                session["interview_state"] = state
                await self.session_manager._save_session(session_id)
                hint = evaluation.get("hint") or "Hint: Consider time complexity and fast lookup."
                return self._interview_prompt(hint, "Hint")

        feedback = self._format_feedback(evaluation)
        return await self._ask_next_interview_question(session_id, state, feedback=feedback)

    async def _ask_next_interview_question(
        self,
        session_id: str,
        state: Dict[str, Any],
        feedback: Optional[str],
    ) -> Dict[str, Any]:
        if self._should_end_interview(state):
            await self.session_manager.end_session(session_id)
            report = await self.generate_vibe_report(session_id)
            return {"type": "session_ended", "report": report}

        next_index = int(state.get("question_count", 0))
        section = self._section_for_question(next_index)
        question = await self._generate_interview_question(state, section, next_index)

        state["question_count"] = next_index + 1
        state["current_section"] = section
        state["current_question"] = question
        state["hint_used"] = False
        state["last_question_time"] = datetime.now().isoformat()

        session = await self.session_manager.get_session(session_id)
        if session:
            session["interview_state"] = state
            await self.session_manager._save_session(session_id)

        visual = feedback or "Interview in progress."
        return {
            "type": "coach_response",
            "voice_text": question,
            "visual_content": visual,
            "avatar_intent": {"expression": "neutral", "gesture": "listening"},
            "pedagogical_state": "evaluating",
            "timestamp": datetime.now().isoformat(),
        }

    def _section_for_question(self, index: int) -> str:
        if index < 1:
            return "warmup"
        if index < 3:
            return "background"
        if index < 7:
            return "technical"
        if index < 9:
            return "behavioral"
        return "wrapup"

    async def _generate_interview_question(self, state: Dict[str, Any], section: str, index: int) -> str:
        role = state.get("role") or "the role"
        job_description = state.get("job_description") or ""
        resume = state.get("resume") or ""

        if section == "warmup":
            return "Give me a quick overview of yourself and your background."

        if section == "background":
            if index == 1:
                return f"Tell me about a project you worked on that relates to {role}. What problem did it solve?"
            return "What was your personal contribution to a recent project you are proud of?"

        if section == "behavioral":
            if index == 7:
                return "Tell me about a challenge you faced."
            return "How do you handle tight deadlines?"

        if section == "wrapup":
            return "What questions do you have for me about the role?"

        difficulty = "same"
        prompt = f"""You are a professional interviewer. Generate ONE technical interview question.

Role: {role}
Job description (optional): {job_description}
Resume (optional): {resume}
Desired difficulty: {difficulty}
Question pattern: concept OR coding/logic OR applied scenario (rotate, keep concise).
Hard constraints:
- Output exactly one question, one sentence, and at most one question mark.
- Do not include multiple parts, follow-ups, or "and"-joined questions.
- Avoid asking for full code; prefer reasoning or short snippets.
- Use simple wording; avoid formulas, math notation, or symbolic expressions unless the user explicitly asked for formulas.

Return ONLY raw JSON:
{{
    "question": "<single technical question, one sentence>"
}}"""

        response = await self.gemini.generate_json_response(prompt, mode="interview", thinking_level="low")
        if isinstance(response, dict) and response.get("question"):
            return self._normalize_interview_question(response["question"])

        return self._normalize_interview_question(
            "What data structure would you use to check if a value has appeared before in a list, and why?"
        )

    def _normalize_interview_question(self, question: str) -> str:
        normalized = " ".join(str(question or "").strip().split())
        if not normalized:
            return "Tell me about a project you worked on recently."

        if "?" in normalized:
            first = normalized.split("?", 1)[0].strip()
            if first:
                return f"{first}?"
            return normalized

        for divider in (". ", "\n", "; "):
            if divider in normalized:
                first = normalized.split(divider, 1)[0].strip()
                if first:
                    return f"{first}?"
                break

        return f"{normalized}?" if not normalized.endswith("?") else normalized

    async def _evaluate_interview_answer(self, state: Dict[str, Any], answer: str) -> Dict[str, Any]:
        role = state.get("role") or "the role"
        section = state.get("current_section") or "technical"
        question = state.get("current_question") or ""

        prompt = f"""You are a professional interviewer. Evaluate the candidate answer.

Role: {role}
Section: {section}
Question: {question}
Answer: {answer}

    Feedback rules:
    - Be specific and actionable; avoid vague phrases like "hard to understand".
    - If the question involves code, algorithms, complexity, or formulas, include a short concrete example or hint.
    - Keep bullets short (max 12 words each).

Return ONLY raw JSON:
{{
  "evaluation": "good" | "partial" | "weak",
  "strengths": ["short bullet"],
  "improvements": ["short bullet"],
  "hint": "short hint for improvement"
}}"""

        response = await self.gemini.generate_json_response(prompt, mode="interview", thinking_level="low")
        if isinstance(response, dict) and response.get("evaluation"):
            return response

        if len(answer) < 30:
            return {
                "evaluation": "weak",
                "strengths": ["Concise response"],
                "improvements": ["Add specific examples"],
                "hint": "Add one concrete example from your experience.",
            }

        return {
            "evaluation": "partial",
            "strengths": ["Clear explanation"],
            "improvements": ["Add more detail"],
            "hint": "Support your answer with a concrete detail.",
        }

    def _format_feedback(self, evaluation: Dict[str, Any]) -> str:
        strengths = evaluation.get("strengths") or []
        improvements = evaluation.get("improvements") or []

        strength_text = "\n".join([f"- {item}" for item in strengths]) or "- Clear response"
        improvement_text = "\n".join([f"- {item}" for item in improvements]) or "- Add one specific example"

        return f"Strengths:\n{strength_text}\n\nImprovements:\n{improvement_text}"

    def _should_end_interview(self, state: Dict[str, Any]) -> bool:
        if int(state.get("question_count", 0)) >= int(state.get("max_questions", 10)):
            return True

        start_time = state.get("start_time")
        if start_time:
            elapsed = datetime.now() - datetime.fromisoformat(start_time)
            if elapsed.total_seconds() >= int(state.get("max_minutes", 15)) * 60:
                return True

        return False

    def _is_yes(self, text: str) -> bool:
        return any(token in text for token in ["yes", "ready", "yep", "yeah", "ok", "okay", "sure", "start"])

    def _is_skip(self, text: str) -> bool:
        return text in {"", "skip", "no", "none", "n/a", "na"}

    def _interview_prompt(self, voice_text: str, visual_text: str) -> Dict[str, Any]:
        avatar_payload = {"expression": "neutral", "gesture": "listening"}
        return {
            "type": "coach_response",
            "voice_text": voice_text,
            "visual_content": visual_text,
            "avatar_intent": avatar_payload,
            "avatar_state": avatar_payload,
            "pedagogical_state": "evaluating",
            "timestamp": datetime.now().isoformat(),
        }

    async def _handle_public_speaking_flow(self, session_id: str, text: str) -> Dict[str, Any]:
        session = await self.session_manager.get_session(session_id)
        if not session:
            return {"type": "error", "message": f"Session {session_id} not found"}

        state = session.get("public_speaking_state") or {}
        if not state:
            state = {
                "stage": "init",
                "speaking_type": "",
                "topic": "",
                "script": "",
                "started": False,
                "start_time": None,
                "main_speech_start": None,
                "followup_index": 0,
                "followup_total": 3,
                "word_count": 0,
                "filler_count": 0,
                "pause_count": 0,
                "long_pause_count": 0,
            }

        normalized_text = (text or "").strip()
        lower_text = normalized_text.lower()

        if normalized_text.startswith("BEGIN_PUBLIC_SPEAKING"):
            payload_text = normalized_text.split("::", 1)[1] if "::" in normalized_text else ""
            payload = {}
            if payload_text:
                try:
                    payload = json.loads(payload_text)
                except Exception:
                    payload = {}

            state["speaking_type"] = payload.get("speaking_type", "")
            state["topic"] = payload.get("topic", "")
            state["script"] = payload.get("script", "")

            if not state.get("speaking_type"):
                state["stage"] = "type"
                session["public_speaking_state"] = state
                await self.session_manager._save_session(session_id)
                return self._public_speaking_prompt(
                    "What type of speaking do you want to practice?",
                    "Speaking type selection",
                )

            if not state.get("topic"):
                state["stage"] = "topic"
                session["public_speaking_state"] = state
                await self.session_manager._save_session(session_id)
                return self._public_speaking_prompt(
                    "Choose a topic or enter your own.",
                    "Topic selection",
                )

            # Script is optional, so if we have type and topic, we go to ready
            state["stage"] = "ready"
            session["public_speaking_state"] = state
            await self.session_manager._save_session(session_id)
            return self._public_speaking_prompt(
                "You will speak for about 3 to 5 minutes. Ready?",
                "Say Yes to begin",
            )

        if self._is_public_speaking_done(lower_text):
            await self.session_manager.end_session(session_id)
            report = await self.generate_vibe_report(session_id)
            return {"type": "session_ended", "report": report}

        if state.get("start_time"):
            try:
                elapsed = datetime.now() - datetime.fromisoformat(state["start_time"])
                if elapsed.total_seconds() >= 15 * 60:
                    await self.session_manager.end_session(session_id)
                    report = await self.generate_vibe_report(session_id)
                    return {"type": "session_ended", "report": report}
            except Exception:
                pass

        await self.session_manager.add_interaction(
            session_id,
            {
                "role": "user",
                "content": normalized_text,
                "timestamp": datetime.now().isoformat(),
            },
        )

        if state.get("stage") == "init":
            state["stage"] = "type"
            session["public_speaking_state"] = state
            await self.session_manager._save_session(session_id)
            return self._public_speaking_prompt(
                "What type of speaking do you want to practice?",
                "Speaking type selection",
            )

        if state.get("stage") == "type":
            matched_type = self._normalize_speaking_type(normalized_text)
            if matched_type:
                state["speaking_type"] = matched_type
                if state.get("topic"):
                    state["stage"] = "script"
                    session["public_speaking_state"] = state
                    await self.session_manager._save_session(session_id)
                    return self._public_speaking_prompt(
                        "Upload a script or outline (optional).",
                        "Optional script upload",
                    )

                state["stage"] = "topic"
                session["public_speaking_state"] = state
                await self.session_manager._save_session(session_id)
                return self._public_speaking_prompt(
                    "Choose a topic or enter your own.",
                    "Topic selection",
                )

            # If the user answered with a topic, accept it and move on.
            if not state.get("topic"):
                state["topic"] = normalized_text
            state["speaking_type"] = state.get("speaking_type") or "Presentation"
            state["stage"] = "script"
            session["public_speaking_state"] = state
            await self.session_manager._save_session(session_id)
            return self._public_speaking_prompt(
                "Upload a script or outline (optional).",
                "Optional script upload",
            )

        if state.get("stage") == "topic":
            if not self._is_skip(lower_text):
                state["topic"] = normalized_text
            if not state.get("topic"):
                return self._public_speaking_prompt(
                    "Choose a topic or enter your own.",
                    "Topic selection",
                )
            # Script is optional, so move to ready
            state["stage"] = "ready"
            session["public_speaking_state"] = state
            await self.session_manager._save_session(session_id)
            return self._public_speaking_prompt(
                "You will speak for about 3 to 5 minutes. Ready?",
                "Say Yes to begin",
            )

        if state.get("stage") == "script":
            if not self._is_skip(lower_text):
                state["script"] = normalized_text
            state["stage"] = "ready"
            session["public_speaking_state"] = state
            await self.session_manager._save_session(session_id)
            return self._public_speaking_prompt(
                "You will speak for about 3 to 5 minutes. Ready?",
                "Say Yes to begin",
            )

        if state.get("stage") == "ready":
            if not self._is_yes(lower_text):
                return self._public_speaking_prompt(
                    "No problem. Tell me when you are ready.",
                    "Waiting",
                )

            state["stage"] = "warmup"
            state["started"] = True
            state["start_time"] = datetime.now().isoformat()
            session["public_speaking_state"] = state
            await self.session_manager._save_session(session_id)
            return self._public_speaking_prompt(
                "Introduce yourself in 30 seconds.",
                "Warm-up",
            )

        if state.get("stage") == "warmup":
            state["stage"] = "main"
            state["main_speech_start"] = datetime.now().isoformat()
            session["public_speaking_state"] = state
            await self.session_manager._save_session(session_id)
            return self._public_speaking_prompt(
                f"Speak about {state.get('topic') or 'your topic'} for 3 minutes.",
                "Main speech",
            )

        if state.get("stage") == "main":
            self._update_public_speaking_metrics(state, normalized_text)
            state["stage"] = "followup"
            state["followup_index"] = 0
            session["public_speaking_state"] = state
            await self.session_manager._save_session(session_id)
            return self._public_speaking_prompt(
                self._followup_question(0),
                "Follow-up 1 of 3",
            )

        if state.get("stage") == "followup":
            self._update_public_speaking_metrics(state, normalized_text)
            next_index = int(state.get("followup_index", 0)) + 1
            if next_index >= int(state.get("followup_total", 3)):
                await self.session_manager.end_session(session_id)
                report = await self.generate_vibe_report(session_id)
                return {"type": "session_ended", "report": report}

            state["followup_index"] = next_index
            session["public_speaking_state"] = state
            await self.session_manager._save_session(session_id)
            return self._public_speaking_prompt(
                self._followup_question(next_index),
                f"Follow-up {next_index + 1} of {state.get('followup_total', 3)}",
            )

        return self._public_speaking_prompt(
            "Let us continue.",
            "Public speaking",
        )

    def _public_speaking_prompt(self, voice_text: str, visual_text: str) -> Dict[str, Any]:
        avatar_payload = {"expression": "encouraging", "gesture": "listening"}
        return {
            "type": "coach_response",
            "voice_text": voice_text,
            "visual_content": visual_text,
            "avatar_intent": avatar_payload,
            "avatar_state": avatar_payload,
            "pedagogical_state": "evaluating",
            "timestamp": datetime.now().isoformat(),
        }

    def _followup_question(self, index: int) -> str:
        questions = [
            "Can you summarize your main point in one sentence?",
            "What is one real-world example that supports your point?",
            "Who is your target audience?",
        ]
        return questions[min(index, len(questions) - 1)]

    def _update_public_speaking_metrics(self, state: Dict[str, Any], text: str) -> None:
        words = [w for w in text.split() if w]
        state["word_count"] = int(state.get("word_count", 0)) + len(words)

        filler_words = ["um", "uh", "like", "you know", "basically", "literally"]
        lowered = text.lower()
        filler_count = sum(lowered.count(word) for word in filler_words)
        state["filler_count"] = int(state.get("filler_count", 0)) + filler_count

        state["pause_count"] = int(state.get("pause_count", 0)) + lowered.count("...")

    def _is_public_speaking_done(self, text: str) -> bool:
        return any(token in text for token in ["done", "thank you", "thanks", "finished", "end"])

    def _normalize_speaking_type(self, text: str) -> Optional[str]:
        normalized = (text or "").strip().lower()
        type_map = {
            "interview answer": "Interview answer",
            "interview": "Interview answer",
            "presentation": "Presentation",
            "pitch": "Pitch",
            "storytelling": "Storytelling",
            "story": "Storytelling",
            "casual conversation": "Casual conversation",
            "conversation": "Casual conversation",
        }

        for key, value in type_map.items():
            if key in normalized:
                return value
        return None

    async def process_biometric(self, session_id: str, biometric_data: Dict[str, Any]):
        """Process and store biometric data."""
        await self.session_manager.add_biometric_data(session_id, biometric_data)

    async def _tutoring_response(self, session_id: str, transcript: str, biometric: Dict[str, Any]) -> Dict[str, Any]:
        """Generate tutoring mode response."""
        return await self.process_text(session_id, transcript)

    async def _interview_response(self, session_id: str, transcript: str) -> Dict[str, Any]:
        """Generate interview mode response."""
        return await self.process_text(session_id, transcript)

    async def _public_speaking_response(self, session_id: str, transcript: str) -> Dict[str, Any]:
        """Generate public speaking mode response."""
        return await self.process_text(session_id, transcript)

    async def _default_response(self, session_id: str, transcript: str) -> Dict[str, Any]:
        """Default conversational response."""
        return await self.process_text(session_id, transcript)

    async def _handle_barge_in(self, session_id: str, trigger: Dict[str, Any]) -> Dict[str, Any]:
        """Handle barge-in interruption."""
        trigger_type = trigger["trigger_type"]

        feedback_messages = {
            "filler_words": "Stop. You are using too many filler words. Take a breath and restart your thought clearly.",
            "stress_spike": "Pause. I can tell you are nervous. Take a moment to collect yourself.",
            "gaze_away": "Look at me. Maintain eye contact when speaking.",
            "combined": "Stop. Let us reset. You are showing stress, poor eye contact, and using filler words. Breathe and try again.",
        }

        text = feedback_messages.get(trigger_type, "Let us pause and refocus.")
        avatar_payload = {"expression": "concerned", "gesture": "pointing"}

        await self.session_manager.add_interaction(
            session_id,
            {
                "type": "barge_in",
                "role": "assistant",
                "content": text,
                "visual_content": text,
                "timestamp": datetime.now().isoformat(),
            },
        )

        return {
            "type": "barge_in",
            "text": text,
            "voice_text": text,
            "visual_content": text,
            "avatar_intent": avatar_payload,
            "avatar_state": avatar_payload,
            "trigger": trigger,
            "timestamp": datetime.now().isoformat(),
        }

    async def generate_vibe_report(self, session_id: str) -> Dict[str, Any]:
        """Generate comprehensive Vibe Report."""
        session = await self.session_manager.get_session(session_id)
        if not session:
            return {
                "session_id": session_id,
                "overall_score": 0,
                "analysis": "Session not found",
                "strengths": [],
                "improvements": [],
            }

        if session.get("mode") == "interview":
            return await self._generate_interview_report(session_id, session)

        if session.get("mode") == "public_speaking":
            return await self._generate_public_speaking_report(session_id, session)

        biometric_timeline = session.get("biometric_timeline", [])
        interactions = session.get("interactions", [])
        discussion_summary = self._build_discussion_summary(session)
        discussion_points = self._extract_discussion_points(session)

        peak_frame = self._find_peak_confidence(biometric_timeline)

        stress_events = sum(1 for b in biometric_timeline if b.get("stress_level") == "high")
        barge_in_count = sum(1 for i in interactions if i.get("type") == "barge_in")

        analysis_prompt = f"""Analyze this coaching session and return ONLY raw JSON:
{{
  "overall_score": 0-100,
  "strengths": ["list of 3 strengths"],
  "improvements": ["list of 3 areas to improve"],
  "analysis": "A brief summary of their vibe and performance"
}}

Session data:
- Duration: {session.get('duration', 'unknown')}s
- Mode: {session.get('mode')}
- Stress events: {stress_events}
- Barge-in corrections: {barge_in_count}
- Interactions: {len(interactions)}"""

        report_data: Dict[str, Any]
        try:
            model = self.gemini.get_model(thinking_level="high")
            response = await asyncio.to_thread(model.generate_content, analysis_prompt)
            text = getattr(response, "text", "") or ""
            start = text.find("{")
            end = text.rfind("}") + 1
            report_data = json.loads(text[start:end])
        except Exception as e:
            report_data = {
                "overall_score": 75,
                "strengths": ["Good engagement", "Clear technical focus"],
                "improvements": ["Reduce filler words", "Maintain eye contact"],
                "analysis": f"Could not generate full AI report: {e}",
            }

        return {
            "session_id": session_id,
            "overall_score": report_data.get("overall_score", 75),
            "peak_confidence_frame": peak_frame,
            "stress_events": stress_events,
            "barge_in_count": barge_in_count,
            "strengths": report_data.get("strengths", []),
            "improvements": report_data.get("improvements", []),
            "analysis": report_data.get("analysis", ""),
            "discussion_summary": discussion_summary,
            "discussion_points": discussion_points,
            "timestamp": datetime.now().isoformat(),
        }

    async def _generate_public_speaking_report(self, session_id: str, session: Dict[str, Any]) -> Dict[str, Any]:
        state = session.get("public_speaking_state", {})
        topic = state.get("topic", "Unknown Topic")
        speaking_type = state.get("speaking_type", "Public Speaking")
        word_count = int(state.get("word_count", 0))
        filler_count = int(state.get("filler_count", 0))
        pause_count = int(state.get("pause_count", 0))

        duration_minutes = 3.0
        if state.get("main_speech_start"):
            try:
                start_time = datetime.fromisoformat(state["main_speech_start"])
                duration_minutes = max(0.5, (datetime.now() - start_time).total_seconds() / 60)
            except Exception:
                duration_minutes = 3.0

        wpm = int(word_count / duration_minutes) if duration_minutes else 0

        prompt = f"""You are a public speaking coach. Create a concise speaking report.

Type: {speaking_type}
Topic: {topic}
Duration minutes: {duration_minutes:.1f}
WPM: {wpm}
Filler words: {filler_count}
Pauses: {pause_count}

Return ONLY raw JSON:
{{
  "overall_score": 0-100,
  "level": "Beginner" | "Improving" | "Confident" | "Presentation Ready",
  "scores": {{"clarity": 1-10, "confidence": 1-10, "structure": 1-10, "pace": 1-10, "engagement": 1-10}},
  "strengths": ["short bullet"],
  "improvements": ["short bullet"],
  "next_steps": "short next steps",
  "moment_feedback": "short moment-level feedback"
}}"""

        response = await self.gemini.generate_json_response(prompt, mode="public_speaking", thinking_level="high")
        if not isinstance(response, dict):
            response = {}

        overall_score = int(response.get("overall_score", 75))
        level = response.get("level", "Confident")
        scores = response.get("scores", {}) or {}
        strengths = response.get("strengths", ["Clear opening"])
        improvements = response.get("improvements", ["Reduce filler words"])
        next_steps = response.get(
            "next_steps",
            "Practice a structured outline and rehearse a strong conclusion.",
        )
        moment_feedback = response.get(
            "moment_feedback",
            "Midway through, add a short transition to keep momentum.",
        )

        analysis = (
            f"Topic: {topic}\n"
            f"Duration: {duration_minutes:.1f} minutes\n"
            f"Overall Score: {overall_score} / 100\n"
            f"Level: {level}\n\n"
            f"Skill Breakdown:\n"
            f"- Clarity: {scores.get('clarity', 7)}/10\n"
            f"- Confidence: {scores.get('confidence', 7)}/10\n"
            f"- Structure: {scores.get('structure', 6)}/10\n"
            f"- Pace: {scores.get('pace', 7)}/10\n"
            f"- Engagement: {scores.get('engagement', 7)}/10\n\n"
            f"Voice and Delivery:\n"
            f"- Avg Speaking Speed: {wpm} wpm\n"
            f"- Filler Words: {filler_count}\n"
            f"- Pauses: {pause_count}\n\n"
            f"Strengths:\n- {strengths[0] if strengths else 'Clear delivery'}\n\n"
            f"Improvement Areas:\n- {improvements[0] if improvements else 'Add stronger conclusion'}\n\n"
            f"Moment-Level Feedback:\n{moment_feedback}\n\n"
            f"Next Steps:\n{next_steps}"
        )

        discussion_summary = self._build_discussion_summary(session)
        discussion_points = self._extract_discussion_points(session)

        return {
            "session_id": session_id,
            "overall_score": overall_score,
            "peak_confidence_frame": None,
            "stress_events": 0,
            "barge_in_count": 0,
            "strengths": strengths,
            "improvements": improvements,
            "analysis": analysis,
            "discussion_summary": discussion_summary,
            "discussion_points": discussion_points,
            "timestamp": datetime.now().isoformat(),
        }

    async def _generate_interview_report(self, session_id: str, session: Dict[str, Any]) -> Dict[str, Any]:
        interactions = session.get("interactions", [])
        role = session.get("interview_state", {}).get("role", "the role")

        summary_lines = []
        for interaction in interactions[-20:]:
            if interaction.get("role") == "user":
                summary_lines.append(f"User: {interaction.get('content', '')}")
            elif interaction.get("role") == "assistant":
                summary_lines.append(f"AI: {interaction.get('content', '')}")

        prompt = f"""You are an interview evaluator. Summarize the interview performance.

Role: {role}
Transcript (recent):
{chr(10).join(summary_lines)}

Return ONLY raw JSON:
{{
  "overall_score": 0-100,
  "overall_level": "Strong Junior" | "Mid" | "Senior",
  "scores": {{"technical": 1-10, "problem_solving": 1-10, "communication": 1-10}},
  "top_strength": "short phrase",
  "top_improvement": "short phrase",
  "next_steps": "short next steps"
}}"""

        response = await self.gemini.generate_json_response(prompt, mode="interview", thinking_level="high")
        if not isinstance(response, dict):
            response = {}

        overall_score = response.get("overall_score", 75)
        overall_level = response.get("overall_level", "Mid")
        scores = response.get("scores", {}) or {}
        top_strength = response.get("top_strength", "Clear communication")
        top_improvement = response.get("top_improvement", "Add more concrete examples")
        next_steps = response.get("next_steps", "Practice concise answers and review core concepts for the role.")

        analysis = (
            f"Overall Level: {overall_level}\n\n"
            f"Scores (1-10):\n"
            f"- Technical: {scores.get('technical', 7)}\n"
            f"- Problem Solving: {scores.get('problem_solving', 7)}\n"
            f"- Communication: {scores.get('communication', 7)}\n\n"
            f"Top Strength: {top_strength}\n"
            f"Top Improvement Area: {top_improvement}\n\n"
            f"Next Steps: {next_steps}"
        )
        discussion_summary = self._build_discussion_summary(session)
        discussion_points = self._extract_discussion_points(session)

        return {
            "session_id": session_id,
            "overall_score": overall_score,
            "peak_confidence_frame": None,
            "stress_events": 0,
            "barge_in_count": 0,
            "strengths": [top_strength],
            "improvements": [top_improvement],
            "analysis": analysis,
            "discussion_summary": discussion_summary,
            "discussion_points": discussion_points,
            "timestamp": datetime.now().isoformat(),
        }

    def _extract_discussion_points(self, session: Dict[str, Any], max_points: int = 4) -> List[str]:
        history = session.get("context_history", []) or []
        points: List[str] = []

        for entry in history[-30:]:
            if entry.get("role") != "user":
                continue
            content = (entry.get("content") or "").strip()
            if not content:
                continue
            normalized = " ".join(content.split())
            if len(normalized) > 140:
                normalized = f"{normalized[:137]}..."
            if normalized in points:
                continue
            points.append(normalized)
            if len(points) >= max_points:
                break

        return points

    def _build_discussion_summary(self, session: Dict[str, Any]) -> str:
        mode = session.get("mode", "session")
        points = self._extract_discussion_points(session, max_points=3)
        if not points:
            return f"You completed a {mode.replace('_', ' ')} session. No detailed discussion transcript was captured."

        lead = points[0]
        if len(points) == 1:
            return f"You focused on: {lead}"

        rest = "; ".join(points[1:])
        return f"You discussed: {lead}. Then covered: {rest}."

    def _find_peak_confidence(self, biometric_timeline: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Find the frame with lowest heart rate and best posture."""
        if not biometric_timeline:
            return None

        scored_frames = []
        for frame in biometric_timeline:
            hr = frame.get("heart_rate", 100)
            posture = frame.get("posture_score", 0)
            score = posture - (hr / 100)
            scored_frames.append((score, frame))

        if scored_frames:
            return max(scored_frames, key=lambda x: x[0])[1]
        return None


class BargeInDetector:
    """Detects when to interrupt user for corrective feedback."""

    def should_trigger(
        self,
        transcript: str,
        biometric_data: Optional[Dict[str, Any]],
        sensitivity: float = 0.7,
    ) -> Optional[Dict[str, Any]]:
        """
        Determine if barge-in should be triggered.
        Returns trigger details if should interrupt, otherwise None.
        """
        triggers: List[str] = []

        filler_words = ["um", "uh", "like", "you know", "basically", "literally"]
        filler_count = sum(transcript.lower().count(word) for word in filler_words)

        if filler_count >= 3:
            triggers.append("filler_words")

        if biometric_data:
            if biometric_data.get("stress_level") == "high":
                triggers.append("stress_spike")

            gaze = biometric_data.get("gaze_direction", [0, 0, 0])
            if abs(gaze[0]) > 0.5 or abs(gaze[1]) > 0.5:
                triggers.append("gaze_away")

        threshold = max(1, int(3 * (1 - sensitivity)))

        if len(triggers) >= threshold:
            return {
                "trigger_type": "combined" if len(triggers) > 1 else triggers[0],
                "confidence": len(triggers) / 3,
                "triggers": triggers,
                "biometric_context": biometric_data,
            }

        return None

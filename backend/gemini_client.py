"""
Gemini API Client
Handles communication with Google's Generative AI
"""

from typing import Any, AsyncIterator, Dict, List, Optional
import asyncio
import base64
import json
import re

import google.generativeai as genai
try:
    from google import genai as genai_live
    from google.genai import types as genai_types
except Exception:  # pragma: no cover
    genai_live = None
    genai_types = None


class GeminiClient:
    """Client for interacting with Gemini APIs."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._preferred_models: Dict[str, Optional[str]] = {"low": None, "high": None}
        self._live_client = None
        if api_key:
            genai.configure(api_key=api_key)
            if genai_live:
                try:
                    self._live_client = genai_live.Client(api_key=api_key)
                except Exception as e:
                    print(f"Warning: Could not init Live client: {e}")

    def _audio_candidate_models(self) -> List[str]:
        return [
            "gemini-2.5-flash-live-001",
            "gemini-2.0-flash-live",
        ]

    def _unary_audio_candidates(self) -> List[str]:
        return [
            "gemini-2.5-flash",
        ]

    def is_connected(self) -> bool:
        """Check if API key is configured."""
        return bool(self.api_key)

    def _generation_config(self, thinking_level: str) -> Dict[str, Any]:
        return {
            "temperature": 0.7 if thinking_level == "low" else 0.4,
            "top_p": 0.95,
            "top_k": 40,
            "max_output_tokens": 2048,
        }

    def _normalize_model_name(self, model_name: str) -> str:
        if model_name.startswith("models/"):
            return model_name
        return f"models/{model_name}"

    def _discover_models(self) -> List[str]:
        discovered: List[str] = []
        try:
            for model in genai.list_models():
                name = model.name.replace("models/", "")
                methods = getattr(model, "supported_generation_methods", []) or []
                if "generateContent" in methods and name.startswith("gemini") and "image" not in name:
                    discovered.append(name)
        except Exception as e:
            print(f"Warning: Could not list Gemini models: {e}")
        return discovered

    def _candidate_models(self, thinking_level: str = "low") -> List[str]:
        # Free-tier accessible models — reliable fallbacks
        static_fallback_low = [
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
        ]
        static_fallback_high = [
            "gemini-2.5-flash",
            "gemini-2.0-flash",
        ]

        candidates: List[str] = []
        preferred = self._preferred_models.get(thinking_level)
        if preferred:
            candidates.append(preferred)

        discovered = self._discover_models()
        if discovered:
            # Prefer gemini-3 flash/preview if available, but exclude pro-only models
            # that have limit:0 on free tier
            gemini3 = [
                name for name in discovered
                if name.startswith("gemini-3") and "pro" not in name
            ]
            if thinking_level == "high":
                ranked = sorted(gemini3, key=lambda n: ("flash" in n, n))
            else:
                ranked = sorted(gemini3, key=lambda n: ("lite" not in n and "exp" in n, n))
            candidates.extend(ranked)

        candidates.extend(static_fallback_high if thinking_level == "high" else static_fallback_low)

        deduped: List[str] = []
        for model_name in candidates:
            if model_name not in deduped:
                deduped.append(model_name)
        return deduped

    def _create_model(self, model_name: str, thinking_level: str = "low"):
        return genai.GenerativeModel(
            model_name=self._normalize_model_name(model_name),
            generation_config=self._generation_config(thinking_level),
        )

    def get_model(self, thinking_level: str = "low"):
        """Return a best-effort model instance for callers that need a model object."""
        for model_name in self._candidate_models(thinking_level):
            try:
                model = self._create_model(model_name, thinking_level)
                self._preferred_models[thinking_level] = model_name
                print(f"Using Gemini model: {model_name}")
                return model
            except Exception as e:
                print(f"Model init failed for {model_name}: {e}")

        return genai.GenerativeModel(
            model_name="models/gemini-pro",
            generation_config=self._generation_config(thinking_level),
        )

    async def _generate_with_fallback(
        self,
        prompt: str,
        thinking_level: str = "low",
        safety_settings: Optional[List[Dict[str, str]]] = None,
    ):
        last_error: Optional[Exception] = None

        for model_name in self._candidate_models(thinking_level):
            try:
                model = self._create_model(model_name, thinking_level)
                if safety_settings:
                    response = await asyncio.to_thread(
                        model.generate_content,
                        prompt,
                        safety_settings=safety_settings,
                    )
                else:
                    response = await asyncio.to_thread(model.generate_content, prompt)

                self._preferred_models[thinking_level] = model_name
                return response
            except Exception as e:
                last_error = e
                print(f"Gemini request failed for {model_name}: {e}")

        if last_error:
            raise last_error
        raise RuntimeError("No Gemini model candidates available")

    def _extract_json_candidates(self, text: str) -> List[str]:
        candidates: List[str] = []
        if not text:
            return candidates

        fenced_json = re.findall(r"```json\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE)
        for block in fenced_json:
            block = block.strip()
            if block:
                candidates.append(block)

        fenced_generic = re.findall(r"```\s*(.*?)\s*```", text, flags=re.DOTALL)
        for block in fenced_generic:
            block = block.strip()
            if block and block not in candidates:
                candidates.append(block)

        raw = text.strip()
        candidates.append(raw)

        for start_idx, ch in enumerate(raw):
            if ch != "{":
                continue
            depth = 0
            for end_idx in range(start_idx, len(raw)):
                if raw[end_idx] == "{":
                    depth += 1
                elif raw[end_idx] == "}":
                    depth -= 1
                    if depth == 0:
                        snippet = raw[start_idx:end_idx + 1].strip()
                        if snippet and snippet not in candidates:
                            candidates.append(snippet)
                        break

        return candidates

    def _parse_response_json(self, text: str) -> Optional[Dict[str, Any]]:
        for candidate in self._extract_json_candidates(text):
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                continue
        return None

    def _extract_audio_payload(self, response: Any) -> Optional[Dict[str, str]]:
        if not response:
            return None

        audio = getattr(response, "audio", None)
        if audio:
            mime_type = getattr(audio, "mime_type", None) or getattr(audio, "mimeType", None)
            data = getattr(audio, "data", None)
            if isinstance(audio, dict):
                mime_type = mime_type or audio.get("mime_type") or audio.get("mimeType")
                data = data or audio.get("data")
            if mime_type and data:
                if isinstance(data, bytes):
                    data = base64.b64encode(data).decode("ascii")
                return {"mime_type": mime_type, "data": data}

        candidates = getattr(response, "candidates", None) or []
        for candidate in candidates:
            content = getattr(candidate, "content", None) or {}
            parts = getattr(content, "parts", None) or []
            for part in parts:
                inline = getattr(part, "inline_data", None)
                if inline is None and isinstance(part, dict):
                    inline = part.get("inline_data")
                if not inline:
                    continue
                mime_type = getattr(inline, "mime_type", None) or getattr(inline, "mimeType", None)
                data = getattr(inline, "data", None)
                if isinstance(inline, dict):
                    mime_type = mime_type or inline.get("mime_type") or inline.get("mimeType")
                    data = data or inline.get("data")
                if mime_type and data:
                    if isinstance(data, bytes):
                        data = base64.b64encode(data).decode("ascii")
                    return {"mime_type": mime_type, "data": data}

        return None

    async def generate_audio_payload(
        self,
        text: str,
        thinking_level: str = "low",
        model_name: Optional[str] = None,
        voice_name: str = "Aoede",
    ) -> Optional[Dict[str, str]]:
        if not self.api_key or not text:
            return None

        prompt = text

        generation_config = self._generation_config(thinking_level)
        generation_config = {
            **generation_config,
            "response_modalities": ["AUDIO"],
            "speech_config": {
                "voice_config": {
                    "prebuilt_voice_config": {"voice_name": voice_name},
                },
            },
        }

        last_error: Optional[Exception] = None
        candidates = [model_name] if model_name else self._audio_candidate_models()

        for candidate in candidates:
            try:
                model = genai.GenerativeModel(
                    model_name=self._normalize_model_name(candidate),
                    generation_config=generation_config,
                )
                response = await asyncio.to_thread(model.generate_content, prompt)
                payload = self._extract_audio_payload(response)
                if payload:
                    self._preferred_models[thinking_level] = candidate
                    return payload
            except Exception as e:
                last_error = e
                print(f"Gemini audio failed for {candidate}: {e}")

        if last_error:
            print(f"Gemini audio generation failed: {last_error}")
        return None

    async def stream_tts_audio(
        self,
        text: str,
        model_name: Optional[str] = None,
        voice_name: str = "Aoede",
    ) -> AsyncIterator[Dict[str, Any]]:
        if not self.api_key or not text:
            return
        if not self._live_client or not genai_types:
            raise RuntimeError("Gemini Live client not available. Install google-genai and restart.")

        config = genai_types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            speech_config=genai_types.SpeechConfig(
                voice_config=genai_types.VoiceConfig(
                    prebuilt_voice_config=genai_types.PrebuiltVoiceConfig(
                        voice_name=voice_name,
                    )
                )
            ),
        )

        candidates = [model_name] if model_name else self._audio_candidate_models()
        connected = False

        for candidate in candidates:
            try:
                print(f"Attempting Live API audio with model: {candidate}")
                async with self._live_client.aio.live.connect(model=candidate, config=config) as session:
                    await session.send(input=text, end_of_turn=True)

                    async for message in session.receive():
                        audio = getattr(message, "audio", None)
                        if audio and getattr(audio, "data", None):
                            data = audio.data
                            if isinstance(data, bytes):
                                data = base64.b64encode(data).decode("ascii")
                            yield {
                                "mime_type": getattr(audio, "mime_type", None) or "audio/pcm",
                                "data": data,
                                "is_final": False,
                            }

                        if getattr(message, "turn_complete", False):
                            yield {"is_final": True}
                            break
                    connected = True
                    return
            except Exception as e:
                print(f"Live API audio failed for {candidate}: {e}")
                continue

        if not connected:
            print("All Live API models failed. Falling back to Unary TTS.")
            # Fallback to Unary TTS (non-streaming)
            # We treat the entire payload as a single "chunk"
            payload = await self.generate_audio_payload(
                text,
                model_name=self._unary_audio_candidates()[0],
                voice_name=voice_name
            )
            if payload:
                yield {
                    "mime_type": payload.get("mime_type", "audio/wav"),
                    "data": payload.get("data"),
                    "is_final": True
                }
            else:
                 print("Unary TTS fallback also failed.")

    async def generate_structured_response(
        self,
        messages: List[Dict[str, str]],
        mode: str,
        session_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate a single structured response for a specific mode."""
        if not self.api_key:
            return self._fallback_response(mode, "Gemini API key is missing or not loaded.")

        session_meta = session_meta or {}
        current_step = int(session_meta.get("current_step", 0))

        system_prompts = {
            "tutoring": f"""You are a clear and helpful AI tutor. Explain topics directly with examples and visual aids.

CORE RULES:
1. FIRST TURN: Start explaining immediately — no greeting, no preamble.
2. EXPLAIN DIRECTLY: Give clear, direct explanations. Do not withhold information.
3. EXAMPLES FIRST: Always include a concrete example to illustrate each concept.
4. VISUAL-FIRST: Every major concept MUST have a whiteboard visual (diagram, equation, or step list).
5. LOGICAL STEPS: Break explanations into 1-3 sentence chunks — one idea per step.
6. MONOTONIC STEPS: Current step is {current_step}. Next step must be >= {current_step + 1}.
7. FOLLOW-UP: For later turns, answer the MOST RECENT user message directly first, then continue.
8. CHECK-IN AFTER EVERY STEP: ALWAYS use kind "check_in". Include the explanation in "narration", the visual in "visual", and end with a check-in question. Never return kind "step" — always "check_in".

OUTPUT SCHEMA (Return ONLY raw JSON, no markdown fences):
- {{"kind": "check_in", "step": 1, "subtopic_id": "intro", "narration": "<explanation here>. Do you want to go deeper, see an example, or do you have any doubts?", "visual": {{"type": "equation", "content": ".."}}, "options": ["Go deeper", "Show an example", "I have a doubt", "Try a practice problem", "Move on"], "avatar_intent": {{"expression": "..", "gesture": ".."}}}}

VISUAL TYPES: "equation", "step_list" ({{"steps": []}}), "diagram" (DRAW_NUMBER_LINE, DRAW_COORDINATE_PLANE, DRAW_BOXES_AND_ARROWS: Label1, Label2, Label3, Description), "table", "none".

AVATAR EXPRESSIONS: neutral, happy, thinking, concerned, excited, explaining
AVATAR GESTURES: idle, greeting, explaining, pointing, listening""",
            "public_speaking": """You are a Public Speaking Coach.
Stay silent while the user speaks unless they stop for a long time.
Provide feedback on pace, confidence, and clarity.
Always return JSON with:
{
  "voice_text": "Brief spoken feedback to keep them inspired",
  "visual_content": "Detailed bullet points of feedback for the user to read",
  "avatar_intent": {"expression": "neutral/encouraging", "gesture": "listening/nodding"},
  "pedagogical_state": "evaluating"
}""",
            "interview": """You are a Professional Interviewer.
Ask role-specific questions. Be challenging but fair.
Always return JSON with:
{
  "voice_text": "The next interview question or follow-up",
  "visual_content": "Strengths/Improvements of their last answer. Use bullet points.",
  "avatar_intent": {"expression": "neutral/skeptical", "gesture": "listening/thinking"},
  "pedagogical_state": "evaluating"
}""",
        }

        system_prompt = system_prompts.get(
            mode,
            "You are a helpful AI assistant. Return JSON with voice_text and visual_content.",
        )

        # Inject agentic tutor signals into prompt for tutoring mode
        if mode == "tutoring" and session_meta:
            action_hint = session_meta.get("action_hint")
            confusion_level = session_meta.get("confusion_level")
            additions: list[str] = []
            if action_hint == "re_explain":
                additions.append("AGENT HINT: Student is confused. Use a COMPLETELY DIFFERENT explanation approach — try an analogy, real-world story, or slower visual breakdown. Do NOT restate what you already said.")
            elif action_hint == "provide_example":
                additions.append("AGENT HINT: Lead with a concrete real-world example before any theory this turn.")
            elif action_hint == "ask_socratic":
                additions.append("AGENT HINT: Open with a guiding Socratic question before explaining.")
            elif action_hint == "suggest_path":
                additions.append("AGENT HINT: Offer 2-3 possible learning directions the student can choose from.")
            if confusion_level == "high":
                additions.append("CONFUSION ALERT: Student has expressed confusion multiple times. Slow down significantly and try a completely different angle.")
            elif confusion_level == "medium":
                additions.append("CONFUSION NOTE: Student seems somewhat confused. Try an analogy or concrete example.")
            if additions:
                system_prompt = system_prompt + "\n\n" + "\n".join(additions)

        # Keep focused recent history so latest intent dominates.
        history_window = messages[-12:] if len(messages) > 12 else messages

        history_str = ""
        for msg in history_window[:-1]:
            role = "AI" if msg.get("role") == "assistant" else "User"
            history_str += f"{role}: {msg.get('content', '')}\n"

        user_message = history_window[-1].get("content", "Hello") if history_window else "Hello"

        full_prompt = (
            f"SYSTEM: {system_prompt}\n\n"
            f"HISTORY:\n{history_str}\n"
            f"USER: {user_message}\n\n"
            "Return ONLY raw JSON."
        )

        safety_settings = [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
        ]

        try:
            response = await self._generate_with_fallback(
                full_prompt,
                thinking_level="low",
                safety_settings=safety_settings,
            )
            text = getattr(response, "text", "") or ""

            parsed = self._parse_response_json(text)
            if parsed:
                if "type" not in parsed and "kind" not in parsed:
                    parsed["type"] = "coach_response"
                return parsed

            return {
                "type": "coach_response",
                "voice_text": text,
                "visual_content": text,
                "avatar_intent": {"expression": "neutral", "gesture": "idle"},
                "pedagogical_state": "explaining",
            }
        except Exception as e:
            print(f"Gemini error: {e}")
            return self._fallback_response(mode, str(e))

    async def generate_json_response(
        self,
        prompt: str,
        mode: str = "interview",
        thinking_level: str = "low",
    ) -> Dict[str, Any]:
        """Generate a JSON-only response for custom prompts."""
        if not self.api_key:
            return self._fallback_response(mode, "Gemini API key is missing or not loaded.")

        safety_settings = [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
        ]

        try:
            response = await self._generate_with_fallback(
                prompt,
                thinking_level=thinking_level,
                safety_settings=safety_settings,
            )
            text = getattr(response, "text", "") or ""
            parsed = self._parse_response_json(text)
            if parsed:
                return parsed

            return {
                "type": "coach_response",
                "voice_text": text,
                "visual_content": text,
                "avatar_intent": {"expression": "neutral", "gesture": "idle"},
                "pedagogical_state": "explaining",
            }
        except Exception as e:
            print(f"Gemini JSON error: {e}")
            return self._fallback_response(mode, str(e))

    def _fallback_response(self, mode: str, error_message: str) -> Dict[str, Any]:
        """Return a mode-appropriate fallback response instead of a hard error."""
        if mode == "tutoring":
            return {
                "kind": "step",
                "step": 1,
                "subtopic_id": "intro",
                "narration": "I am having trouble reaching the coaching model right now. I can still start with a quick overview. Tell me the topic again in one short phrase.",
                "visual": {"type": "none", "content": None},
                "avatar_intent": {"expression": "concerned", "gesture": "idle"},
                "error": error_message,
            }

        if mode == "public_speaking":
            return {
                "type": "coach_response",
                "voice_text": "I am having trouble reaching the coaching model right now. Please repeat your last line and I will continue.",
                "visual_content": "Temporary connection issue. Try again in a moment.",
                "avatar_intent": {"expression": "concerned", "gesture": "idle"},
                "pedagogical_state": "error",
                "error": error_message,
            }

        if mode == "interview":
            return {
                "type": "coach_response",
                "voice_text": "I am having trouble reaching the coaching model right now. Please repeat your last answer.",
                "visual_content": "Temporary connection issue. Try again in a moment.",
                "avatar_intent": {"expression": "concerned", "gesture": "idle"},
                "pedagogical_state": "error",
                "error": error_message,
            }

        return {
            "type": "coach_response",
            "voice_text": "I am having trouble reaching the coaching model right now. Please repeat that.",
            "visual_content": "Temporary connection issue.",
            "avatar_intent": {"expression": "concerned", "gesture": "idle"},
            "pedagogical_state": "error",
            "error": error_message,
        }

    async def analyze_communication_pattern(self, transcript: str, biometric_data: Dict) -> Dict[str, Any]:
        """Analyze speech quality indices."""
        prompt = (
            "Analyze this speech for filler words and quality: "
            f"'{transcript}'. Return JSON: {{'filler_count': N, 'quality_score': 0-100}}"
        )
        try:
            response = await self._generate_with_fallback(prompt, thinking_level="low")
            text = getattr(response, "text", "") or ""
            parsed = self._parse_response_json(text)
            if parsed:
                return parsed
            return json.loads(text)
        except Exception:
            return {"filler_count": 0, "quality_score": 80}

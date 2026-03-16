"""
Gemini Live API – bidirectional audio session handler.

Each coaching mode gets a voice-optimised system prompt.
The handler bridges a FastAPI WebSocket to a Gemini Live API session:
  - Client → backend: {"type":"audio_chunk","data":"<base64 PCM 16kHz>"}
                       {"type":"text","content":"...","end_of_turn":true}
                       {"type":"end_session"}
  - Backend → client: {"type":"audio_chunk","data":"<base64 PCM 24kHz>","mime_type":"audio/pcm;rate=24000"}
                       {"type":"transcript","text":"...","role":"model"|"user"}
                       {"type":"turn_complete"}
                       {"type":"interrupted"}
                       {"type":"error","message":"..."}
"""

from __future__ import annotations

import asyncio
import base64
import json
from typing import Any, Dict, Optional

from fastapi import WebSocket, WebSocketDisconnect
from tutor_agent import AudioClassifier, SpeechIntentAnalyzer, IdleEngagementHandler

try:
    from google import genai as genai_live
    from google.genai import types as genai_types
except Exception:
    genai_live = None  # type: ignore
    genai_types = None  # type: ignore


# ---------------------------------------------------------------------------
# System prompts (voice-optimised – concise sentences, no markdown)
# ---------------------------------------------------------------------------

_SYSTEM_PROMPTS: Dict[str, str] = {
    "tutoring": (
        "You are an expert Socratic tutor conducting a live voice-and-video session. "
        "You can SEE the student through their camera — use this to notice confusion, "
        "held-up work, or distraction. "
        "PERSONALITY: Be patient and collaborative. Never say 'this is simple' or 'obvious'. "
        "If the student seems confused, switch explanation style — try an analogy, "
        "real-world example, or slower visual breakdown. "
        "Normalize struggle: 'Many students find this tricky at first.' "
        "Frame as partnership: 'Let's work through this together.' "
        "Speak in clear, short sentences suitable for audio. "
        "Guide with Socratic questions rather than direct answers. "
        "After each explanation, invite a response with a short question. "
        "If stuck, give a small hint. "
        "If silence persists, gently re-engage: offer an example or diagram. "
        "Never use bullet points, markdown, or formatting — plain speech only."
    ),
    "public_speaking": (
        "You are a professional public-speaking coach conducting a live voice-and-video session. "
        "You can SEE the speaker through their camera — observe their posture, gestures, eye contact, "
        "and facial expressions. Comment on what you see when relevant. "
        "Listen while the student practises and give brief spoken feedback on pace, "
        "clarity, filler words, confidence, body language, and eye contact. "
        "Be encouraging but specific. Speak in short sentences. "
        "Never use markdown or bullet points – plain speech only."
    ),
    "interview": (
        "You are a professional interviewer conducting a realistic mock job interview over voice and video. "
        "You can SEE the candidate through their camera — notice body language, eye contact, "
        "and professional presentation. Mention these briefly when giving feedback. "
        "Ask one question at a time and wait for the candidate's answer before continuing. "
        "After each answer, give a one-sentence observation then ask the next question. "
        "Cover: warm-up, background, technical skills, behavioural, and wrap-up. "
        "Be challenging but fair. Speak naturally. No markdown."
    ),
}

_DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful AI coach conducting a live voice-and-video session. "
    "You can see the user through their camera. "
    "Speak in clear, concise sentences. No markdown or bullet points."
)

_live_idle_handler = IdleEngagementHandler(silence_threshold=50.0)

def _build_biometric_hint(data: Dict[str, Any]) -> Optional[str]:
    """
    Build a silent context injection for Gemini Live based on biometric data.
    Framed so Gemini adapts its coaching style without reading the data aloud.
    """
    if not data:
        return None

    hr = data.get("heartRate") or data.get("heart_rate")
    stress = (data.get("stressLevel") or data.get("stress_level") or "").lower()
    gaze = data.get("gazeDirection") or data.get("gaze_direction") or [0, 0, 0]
    confidence = data.get("confidenceLevel") or data.get("confidence_level")
    posture = data.get("postureScore") or data.get("posture_score")

    parts: list[str] = []

    if hr:
        parts.append(f"heart rate {int(hr)} BPM{'(elevated)' if hr > 90 else ''}")

    if stress == "high":
        parts.append("stress level HIGH — slow down, be more encouraging, use shorter sentences")
    elif stress == "medium":
        parts.append("stress level MEDIUM — maintain calm, supportive tone")

    gaze_x = gaze[0] if isinstance(gaze, (list, tuple)) and len(gaze) > 0 else 0
    gaze_y = gaze[1] if isinstance(gaze, (list, tuple)) and len(gaze) > 1 else 0
    if abs(gaze_x) > 0.4 or abs(gaze_y) > 0.4:
        parts.append("gaze AVERTED — gently re-engage the student with a direct question")

    if confidence is not None and confidence < 0.4:
        parts.append("confidence LOW — offer reassurance and positive reinforcement")

    if posture is not None and posture < 0.4:
        parts.append("posture POOR — optionally remind the student to sit up straight")

    if not parts:
        return None

    details = "; ".join(parts)
    return (
        f"[SILENT COACH CONTEXT — do NOT speak this aloud or reference it directly. "
        f"Adapt your next response based on: {details}.]"
    )


_LIVE_MODELS = [
    "gemini-2.5-flash-preview-native-audio-dialog",
    "gemini-2.5-flash-live-001",
    "gemini-2.0-flash-live-001",
    "gemini-2.0-flash-live",
]


# ---------------------------------------------------------------------------
# Session runner
# ---------------------------------------------------------------------------

async def run_live_session(
    websocket: WebSocket,
    session_id: str,
    mode: str,
    api_key: str,
    voice_name: str = "Aoede",
) -> None:
    """
    Open a Gemini Live API bidirectional session and bridge it to the WebSocket.
    Must be called after `websocket.accept()`.
    """
    if genai_live is None or genai_types is None:
        await websocket.send_json({
            "type": "error",
            "message": "Gemini Live SDK not available. Run: pip install google-genai",
        })
        return

    system_prompt = _SYSTEM_PROMPTS.get(mode, _DEFAULT_SYSTEM_PROMPT)

    config = genai_types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=system_prompt,
        speech_config=genai_types.SpeechConfig(
            voice_config=genai_types.VoiceConfig(
                prebuilt_voice_config=genai_types.PrebuiltVoiceConfig(
                    voice_name=voice_name,
                )
            )
        ),
    )

    client = genai_live.Client(api_key=api_key)
    last_error: Optional[Exception] = None

    for model_name in _LIVE_MODELS:
        try:
            print(f"[live_session:{session_id}] Trying model {model_name}")
            async with client.aio.live.connect(model=model_name, config=config) as gemini_session:
                await websocket.send_json({
                    "type": "live_ready",
                    "model": model_name,
                    "session_id": session_id,
                })
                await _bridge(websocket, gemini_session, session_id)
            _live_idle_handler.cancel(session_id)
            return  # clean exit
        except WebSocketDisconnect:
            print(f"[live_session:{session_id}] Client disconnected")
            return
        except Exception as exc:
            last_error = exc
            print(f"[live_session:{session_id}] Model {model_name} failed: {exc}")
            continue

    msg = str(last_error) if last_error else "No Live API model available"
    try:
        await websocket.send_json({"type": "error", "message": msg})
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Bridge: WebSocket ↔ Gemini Live session
# ---------------------------------------------------------------------------

async def _bridge(websocket: WebSocket, gemini_session: Any, session_id: str) -> None:
    """Run receive and send tasks concurrently until either side closes."""

    async def _receive_from_client() -> None:
        """Forward client messages to Gemini Live."""
        try:
            while True:
                raw = await websocket.receive_text()
                msg: Dict[str, Any] = json.loads(raw)
                msg_type = msg.get("type", "")

                if msg_type == "audio_chunk":
                    b64 = msg.get("data", "")
                    if b64:
                        pcm_bytes = base64.b64decode(b64)
                        # Classify audio — skip pure silence/noise for non-Gemini-VAD pipelines.
                        # Gemini Live handles its own VAD, so we still forward BACKGROUND_NOISE
                        # to keep the stream alive; we only drop pure silence to save bandwidth.
                        audio_class = AudioClassifier.classify(pcm_bytes)
                        if audio_class == "SILENCE":
                            continue  # drop silent frames
                        await gemini_session.send(
                            input=genai_types.LiveClientRealtimeInput(
                                media_chunks=[
                                    genai_types.Blob(
                                        mime_type="audio/pcm;rate=16000",
                                        data=pcm_bytes,
                                    )
                                ]
                            )
                        )

                elif msg_type == "text":
                    content = msg.get("content", "")
                    end_of_turn = bool(msg.get("end_of_turn", True))
                    if content:
                        await gemini_session.send(
                            input=content,
                            end_of_turn=end_of_turn,
                        )

                elif msg_type == "video_frame":
                    b64 = msg.get("data", "")
                    if b64:
                        try:
                            jpeg_bytes = base64.b64decode(b64)
                            await gemini_session.send(
                                input=genai_types.LiveClientRealtimeInput(
                                    media_chunks=[
                                        genai_types.Blob(
                                            mime_type="image/jpeg",
                                            data=jpeg_bytes,
                                        )
                                    ]
                                )
                            )
                        except Exception as exc:
                            print(f"[live_session:{session_id}] video frame failed: {exc}")

                elif msg_type == "biometric_update":
                    hint = _build_biometric_hint(msg.get("data", {}))
                    if hint:
                        # Send as background context — end_of_turn=False so
                        # Gemini does not treat this as a user turn to respond to.
                        try:
                            await gemini_session.send(
                                input=hint,
                                end_of_turn=False,
                            )
                        except Exception as exc:
                            print(f"[live_session:{session_id}] biometric hint failed: {exc}")

                elif msg_type == "end_session":
                    break

        except WebSocketDisconnect:
            pass
        except Exception as exc:
            print(f"[live_session:{session_id}] receive_from_client error: {exc}")

    async def _receive_from_gemini() -> None:
        """Forward Gemini Live responses to client WebSocket."""
        try:
            async for message in gemini_session.receive():
                # --- audio output ---
                audio = getattr(message, "audio", None)
                if audio:
                    data = getattr(audio, "data", None)
                    if data:
                        if isinstance(data, bytes):
                            data = base64.b64encode(data).decode("ascii")
                        await websocket.send_json({
                            "type": "audio_chunk",
                            "data": data,
                            "mime_type": "audio/pcm;rate=24000",
                        })
                    continue

                # --- text / transcript output ---
                server_content = getattr(message, "server_content", None)
                if server_content:
                    # model transcript
                    model_turn = getattr(server_content, "model_turn", None)
                    if model_turn:
                        parts = getattr(model_turn, "parts", []) or []
                        for part in parts:
                            text = getattr(part, "text", None)
                            if text:
                                await websocket.send_json({
                                    "type": "transcript",
                                    "text": text,
                                    "role": "model",
                                })

                    # turn complete
                    if getattr(server_content, "turn_complete", False):
                        await websocket.send_json({"type": "turn_complete"})

                    # interrupted (user barged in)
                    if getattr(server_content, "interrupted", False):
                        await websocket.send_json({"type": "interrupted"})

                # input transcription (user speech echoed back)
                input_transcription = getattr(message, "input_transcription", None)
                if input_transcription:
                    text = getattr(input_transcription, "text", None) or ""
                    if text:
                        # For tutoring: filter ambient speech, reset idle timer on directed speech
                        intent = SpeechIntentAnalyzer.classify(text)
                        if intent == "HUMAN_SPEECH_AMBIENT":
                            continue  # side conversation — ignore
                        await websocket.send_json({
                            "type": "transcript",
                            "text": text,
                            "role": "user",
                        })
                        # Reset idle engagement timer on directed student speech
                        await _live_idle_handler.reset(
                            session_id,
                            websocket.send_json,
                        )

        except Exception as exc:
            print(f"[live_session:{session_id}] receive_from_gemini error: {exc}")

    await asyncio.gather(
        _receive_from_client(),
        _receive_from_gemini(),
        return_exceptions=True,
    )

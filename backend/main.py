"""
FastAPI Backend for Socratic Mirror Agent
Main application with WebSocket support
"""
import os

# Suppress noisy gRPC and ALTS logging - MUST BE SET BEFORE OTHER IMPORTS
os.environ["GRPC_VERBOSITY"] = "NONE"
os.environ["GLOG_minloglevel"] = "3"

import json
import asyncio
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Import custom modules
from gemini_client import GeminiClient
from coaching_engine import CoachingEngine
from session_manager import SessionManager
from live_session import run_live_session
from tts_service import create_tts_service
from tutor_agent import IdleEngagementHandler

# Load environment variables
load_dotenv()

# Initialize FastAPI app
app = FastAPI(title="Socratic Mirror Agent API", version="1.0.0")

# CORS configuration — allow all origins for hackathon demo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize components
gemini_client = GeminiClient(api_key=os.getenv("GEMINI_API_KEY"))
session_manager = SessionManager()
coaching_engine = CoachingEngine(gemini_client, session_manager)
tts_service = create_tts_service()
idle_handler = IdleEngagementHandler(silence_threshold=45.0)

# Active WebSocket connections
active_connections: Dict[str, WebSocket] = {}





# Pydantic Models
class SessionCreate(BaseModel):
    user_id: str
    mode: str  # 'tutoring', 'public_speaking', 'interview'
    
class BiometricData(BaseModel):
    heart_rate: float
    stress_level: str
    gaze_direction: List[float]
    posture_score: float
    confidence_level: float
    timestamp: float


# Health check endpoint
@app.get("/")
async def root():
    return {
        "status": "online",
        "service": "Socratic Mirror Agent",
        "version": "1.0.0"
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "gemini_connected": gemini_client.is_connected()
    }


# Session management endpoints
@app.post("/api/session/create")
async def create_session(session_data: SessionCreate):
    """Create a new coaching session"""
    try:
        session = await session_manager.create_session(
            user_id=session_data.user_id,
            mode=session_data.mode
        )
        return session
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    """Get session details"""
    session = await session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get("/api/session/{session_id}/report")
async def get_vibe_report(session_id: str):
    """Generate and return Vibe Report for completed session"""
    try:
        report = await coaching_engine.generate_vibe_report(session_id)
        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/end/{session_id}")
async def end_session(session_id: str):
    """End a session and persist results."""
    session = await session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        await session_manager.end_session(session_id)
        return {"status": "ended", "session_id": session_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    speaking_rate: Optional[float] = None


@app.post("/api/tts")
async def synthesize_speech(req: TTSRequest):
    """
    Convert text to speech using Google Cloud TTS.

    Returns JSON:
        { audio_b64, mime_type, viseme_events }

    If the service is unavailable (no API key / httpx missing), responds with
    HTTP 503 so the frontend can fall back to the Web Speech API.
    """
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    if not tts_service.is_available():
        raise HTTPException(
            status_code=503,
            detail="Google Cloud TTS is not configured (set GOOGLE_TTS_API_KEY)"
        )

    result = await tts_service.synthesize(
        text,
        voice_name=req.voice,
        speaking_rate=req.speaking_rate,
    )

    if result is None:
        raise HTTPException(status_code=502, detail="TTS synthesis failed")

    return result


# WebSocket endpoint for real-time coaching
@app.websocket("/ws/coach/{session_id}")
async def coaching_websocket(websocket: WebSocket, session_id: str):
    """
    Main WebSocket endpoint for real-time coaching interaction
    Handles: audio streaming, biometric data, barge-in triggers
    """
    await websocket.accept()
    active_connections[session_id] = websocket
    
    try:
        # Get or create session
        session = await session_manager.get_session(session_id)
        if not session:
            await websocket.send_json({
                "type": "error",
                "message": "Session not found"
            })
            await websocket.close()
            return
        
        # Send initial connection confirmation
        await websocket.send_json({
            "type": "connected",
            "session_id": session_id,
            "mode": session["mode"]
        })
        
        # Main message loop
        while True:
            # Receive message from frontend
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON payload"
                })
                continue

            if not isinstance(message, dict):
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid message payload: expected JSON object"
                })
                continue
            message_type = message.get("type")
            print(f"Received WebSocket message: {message_type}")

            if not message_type:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid message payload: missing 'type'"
                })
                continue

            try:
                # Route message based on type
                if message_type == "user_speech":
                    # Process speech/text through coaching engine
                    transcript = (message.get("transcript") or "").strip()
                    if not transcript:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Empty transcript received"
                        })
                        continue

                    response = await coaching_engine.process_text(
                        session_id=session_id,
                        text=transcript
                    )
                    await websocket.send_json(response)

                    # Reset idle timer after each interaction (tutoring only)
                    if session.get("mode") == "tutoring":
                        await idle_handler.reset(session_id, websocket.send_json)
                    


                elif message_type == "biometric_data":
                    # Process biometric data
                    biometric_payload = message.get("data", {})
                    if not isinstance(biometric_payload, dict):
                        await websocket.send_json({
                            "type": "error",
                            "message": "Invalid biometric_data payload"
                        })
                        continue
                    await coaching_engine.process_biometric(
                        session_id=session_id,
                        biometric_data=biometric_payload
                    )

                elif message_type == "text":
                    # Process text message
                    payload_text = (message.get("payload") or "").strip()
                    if not payload_text:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Empty text payload received"
                        })
                        continue
                    response = await coaching_engine.process_text(
                        session_id=session_id,
                        text=payload_text
                    )
                    await websocket.send_json(response)
                    


                elif message_type == "end_session":
                    # End session and generate report
                    await session_manager.end_session(session_id)
                    report = await coaching_engine.generate_vibe_report(session_id)
                    await websocket.send_json({
                        "type": "session_ended",
                        "report": report
                    })
                    break
                else:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Unsupported message type: {message_type}"
                    })
            except Exception as message_error:
                import traceback
                print(f"Message handling failed for type '{message_type}': {message_error}")
                traceback.print_exc()
                try:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Failed to process '{message_type}' message"
                    })
                except Exception:
                    break
                
    except WebSocketDisconnect:
        print(f"Client disconnected from session {session_id}")
    except Exception as e:
        print(f"Error in WebSocket connection: {e}")
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except Exception:
            pass
    finally:
        idle_handler.cancel(session_id)
        if session_id in active_connections:
            del active_connections[session_id]
        try:
            await websocket.close()
        except:
            pass


@app.websocket("/ws/live/{session_id}")
async def live_coaching_websocket(websocket: WebSocket, session_id: str):
    """
    Bidirectional Gemini Live API WebSocket endpoint.
    Streams raw PCM audio directly to/from Gemini Live API —
    enabling natural conversation with native interruption support.
    """
    await websocket.accept()

    session = await session_manager.get_session(session_id)
    if not session:
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return

    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        await websocket.send_json({"type": "error", "message": "GEMINI_API_KEY not configured"})
        await websocket.close()
        return

    await run_live_session(
        websocket=websocket,
        session_id=session_id,
        mode=session["mode"],
        api_key=api_key,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

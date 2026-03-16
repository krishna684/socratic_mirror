# System Architecture

This document shows how the Socratic Mirror Agent connects frontend, backend, AI services, and persistence.

## 1) Component Diagram

```mermaid
flowchart LR
    subgraph FE[Frontend - Next.js (Browser)]
        PAGE[page.tsx\nSession bootstrap]
        SESSION[CoachingSession.tsx\nMain orchestrator]
        LIVEUI[LiveCoachingInterface.tsx\nRealtime audio/video]
        BIO[BiometricMonitor.tsx\nHeart rate + stress + gaze]
        AUDIO[AudioProcessor.tsx\nSpeech recognition]
        AVATAR[AvatarScene/AvatarModel\n3D avatar + lip sync]
        WB[Whiteboard.tsx\nTutoring visuals]
        REPORTUI[VibeReport.tsx\nPost-session analytics]
    end

    subgraph BE[Backend - FastAPI]
        MAIN[main.py\nREST + WebSocket gateways]
        ENGINE[coaching_engine.py\nMode logic + orchestration]
        GCLIENT[gemini_client.py\nGemini model fallback]
        LIVEBRIDGE[live_session.py\nGemini Live bridge]
        SESS[session_manager.py\nSession lifecycle + persistence]
        TTS[tts_service.py\nOptional TTS endpoint]
    end

    GEM[Google Gemini API\nText/structured generation]
    GLIVE[Gemini Live API\nBidirectional streaming]
    GSTTS[Google Cloud TTS API\nOptional]
    STORE[(File-based session store\nbackend/sessions/*.json)]

    PAGE --> SESSION
    SESSION --> BIO
    SESSION --> AUDIO
    SESSION --> AVATAR
    SESSION --> WB
    SESSION --> REPORTUI
    SESSION --> LIVEUI

    PAGE -->|POST /api/session/create| MAIN
    SESSION <-->|WS /ws/coach/{session_id}| MAIN
    LIVEUI <-->|WS /ws/live/{session_id}| MAIN
    SESSION -->|GET report / end session| MAIN

    MAIN --> ENGINE
    MAIN --> LIVEBRIDGE
    MAIN --> SESS
    ENGINE --> GCLIENT --> GEM
    LIVEBRIDGE --> GLIVE
    MAIN --> TTS --> GSTTS

    ENGINE --> SESS --> STORE
```

## 2) Standard Coaching Sequence (/ws/coach)

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser (CoachingSession)
    participant API as FastAPI main.py
    participant CE as CoachingEngine
    participant GC as GeminiClient
    participant G as Gemini API
    participant SM as SessionManager
    participant FS as Session JSON Store

    B->>API: POST /api/session/create
    API->>SM: create_session(user_id, mode)
    SM->>FS: write session_id.json
    API-->>B: {session_id, mode, ...}

    B->>API: WS connect /ws/coach/{session_id}
    API-->>B: {type: connected}

    loop During session
        B->>API: {type: user_speech, transcript}
        API->>CE: process_text(session_id, text)
        CE->>SM: add_interaction(user)
        CE->>GC: generate_structured_response(history, mode)
        GC->>G: model.generate_content(...)
        G-->>GC: response payload
        GC-->>CE: structured response
        CE->>SM: add_interaction(assistant)
        CE-->>API: coach response JSON
        API-->>B: coach response

        B->>API: {type: biometric_data, data}
        API->>CE: process_biometric(...)
        CE->>SM: add_biometric_data(...)
    end

    B->>API: {type: end_session}
    API->>SM: end_session(session_id)
    SM->>FS: persist finalized session
    API-->>B: {type: session_ended, report}
```

## 3) Live Realtime Sequence (/ws/live)

```mermaid
sequenceDiagram
    autonumber
    participant L as Browser (LiveCoachingInterface)
    participant API as FastAPI /ws/live
    participant LS as run_live_session bridge
    participant GL as Gemini Live API

    L->>API: WS connect /ws/live/{session_id}
    API->>LS: start bridge(session_id, mode)
    LS->>GL: open live session (model fallback list)
    LS-->>L: {type: live_ready, model}

    loop Realtime stream
        L->>API: audio_chunk (PCM16 16kHz, base64)
        API->>LS: forward audio
        LS->>GL: send realtime audio

        L->>API: video_frame (jpeg, base64)
        API->>LS: forward frame
        LS->>GL: send vision frame

        L->>API: biometric_update
        API->>LS: biometric hint injection
        LS->>GL: silent context input

        GL-->>LS: audio output / transcripts / interruptions
        LS-->>API: translated events
        API-->>L: audio_chunk / transcript / interrupted / turn_complete
    end
```

## 4) Deployment View (Cloud Run)

```mermaid
flowchart TB
    DEV[Developer push / trigger] --> CB[Cloud Build]

    subgraph Build_and_Deploy
        CB --> BBE[Build backend image\nbackend/Dockerfile]
        CB --> DBE[Deploy socratic-mirror-backend\nCloud Run]
        DBE --> URL[Capture backend URL]
        URL --> BFE[Build frontend image\nDockerfile with NEXT_PUBLIC_BACKEND_URL]
        BFE --> DFE[Deploy socratic-mirror-frontend\nCloud Run]
    end

    USER[End user browser] --> FEURL[Frontend Cloud Run URL]
    FEURL --> BEURL[Backend Cloud Run URL]
    BEURL --> GEMAPI[Google Gemini APIs]

    SECRET[Secret Manager: GEMINI_API_KEY] --> BEURL
```

## Notes

- Current persistence is file-based (`backend/sessions/*.json`), not Postgres/Redis.
- If you later add a database, replace the file-store node and keep SessionManager as the abstraction boundary.

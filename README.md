# Socratic Mirror Agent

AI-powered multimodal coaching system with real-time biometric feedback, voice interaction, and a 3D avatar — built for Gemini hackathon.

## What It Does

The Socratic Mirror Agent is an AI coach that talks to you through a 3D avatar while monitoring your biometrics via webcam. It adapts its coaching style in real time based on your stress level, speech patterns, and engagement. After each session you get a detailed performance report ("Vibe Report").

Three coaching modes are available:

- **Socratic Tutoring** — Ask about any topic. The AI guides you with leading questions and a live whiteboard that renders equations, diagrams, step lists, and tables. It never gives direct answers; instead it checks your understanding every few steps.
- **Interview Preparation** — Paste a job description and optionally upload your resume. The AI acts as a challenging interviewer, cycling through background, technical, and behavioral questions with follow-ups.
- **Public Speaking** — Choose a speech type (persuasive, informative, or impromptu), enter your topic, and optionally upload a script. The AI listens, tracks filler words and pauses, then gives structured feedback.

## Tech Stack

| Layer | Technology |
| ----- | ---------- |
| Frontend | Next.js 14, TypeScript, React Three Fiber, KaTeX |
| 3D Avatar | Ready Player Me `.glb`, Three.js bone rigging, procedural lip-sync |
| Voice | Web Speech API (recognition), browser SpeechSynthesis (TTS) |
| Backend | Python 3.10+, FastAPI, WebSocket |
| AI | Google Gemini API (multi-model fallback: flash → pro) |
| Testing | Jest, fast-check (property-based tests) |

## Getting Started

### Prerequisites

- **Node.js 18+**
- **Python 3.10+**
- **Gemini API key** — get one at <https://aistudio.google.com/apikey>
- A webcam and microphone
- A modern browser with WebGL support (Chrome or Edge recommended)

### 1. Install Dependencies

**Frontend:**

```bash
npm install
```

**Backend:**

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS / Linux
pip install -r requirements.txt
```

### 2. Configure Environment

Copy the example and fill in your API key:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_GEMINI_API_KEY=your_gemini_api_key_here
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_RPM_AVATAR_URL=/avatars/6986dfdd47a75ab0c820deb2.glb
```

Create `backend/.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
FRONTEND_URL=http://localhost:3000
```

### 3. Start the App

You need **two terminals**:

**Terminal 1 — Backend (FastAPI on port 8000):**

```bash
cd backend
venv\Scripts\activate
python main.py
```

Or from the project root:

```bash
npm run backend
```

**Terminal 2 — Frontend (Next.js on port 3000):**

```bash
npm run dev
```

Open <http://localhost:3000> in your browser.

## How to Use

1. **Pick a mode** on the landing page (Tutoring, Interview, or Public Speaking).
2. **Allow camera and microphone** when prompted.
3. **Set up your session:**
   - *Tutoring:* type a topic (e.g. "quadratic equations").
   - *Interview:* paste a job description; optionally upload a resume.
   - *Public Speaking:* choose a speech type, enter a topic, and optionally upload a script.
4. **Wait ~10 seconds** for biometric calibration (heart rate baseline).
5. **Start talking.** The avatar responds with voice, gestures, and expressions. In tutoring mode, content appears on the whiteboard.
6. **Barge-in:** If the AI detects excessive filler words, high stress, or gaze deviation it will interrupt with corrective coaching feedback.
7. **End the session** when finished. A **Vibe Report** appears with your performance score, strengths, areas for improvement, and a discussion summary. You can print it or download whiteboard data as JSON.

## Project Structure

```text
socratic-mirror-agent/
├── src/
│   ├── app/
│   │   ├── page.tsx                # Landing page & mode selection
│   │   ├── CoachingSession.tsx     # Main session orchestrator
│   │   ├── layout.tsx              # Root layout
│   │   └── globals.css             # Global styles
│   ├── components/
│   │   ├── AvatarScene.tsx         # Three.js canvas & camera
│   │   ├── AvatarModel.tsx         # Avatar rigging, gestures, lip-sync
│   │   ├── AudioProcessor.tsx      # Speech recognition & VAD
│   │   ├── BiometricMonitor.tsx    # Webcam biometric capture
│   │   ├── Whiteboard.tsx          # Equation/diagram/step renderer
│   │   ├── VibeReport.tsx          # Post-session report UI
│   │   └── SessionControls.tsx     # Mode-specific tips panel
│   ├── types/index.ts              # Shared TypeScript interfaces
│   └── utils/rppg.ts               # rPPG signal processing algorithms
├── backend/
│   ├── main.py                     # FastAPI server & WebSocket endpoint
│   ├── gemini_client.py            # Gemini API with multi-model fallback
│   ├── coaching_engine.py          # Coaching logic & barge-in detection
│   ├── session_manager.py          # File-based session persistence
│   ├── mizzou_context.py           # Mizzou-specific data & prompts
│   └── requirements.txt            # Python dependencies
├── tests/
│   └── properties/
│       └── biometric.test.ts       # Property-based tests (fast-check)
├── public/
│   └── avatars/                    # Ready Player Me .glb avatar
└── package.json
```

## Development

### Run Tests

```bash
npm test
```

Property-based tests use `fast-check` with 100 iterations each, covering rPPG signal processing, stress detection hysteresis, and biometric pipeline performance.

### Build for Production

```bash
npm run build
npm start
```

## Architecture Overview

```mermaid
flowchart LR
    subgraph FE[Frontend - Browser]
        UI[Next.js App\nCoachingSession / LiveCoachingInterface]
        CAM[BiometricMonitor\nCamera + rPPG]
        MIC[AudioProcessor\nMic + transcript]
    end

    subgraph BE[Backend - FastAPI]
        API[REST Endpoints\n/api/session/*, /api/tts]
        WS1[WebSocket\n/ws/coach/{session_id}]
        WS2[WebSocket\n/ws/live/{session_id}]
        ENG[CoachingEngine]
        GM[GeminiClient]
        SM[SessionManager]
    end

    GEM[Google Gemini API\nGenerate Content]
    LIVE[Gemini Live API\nRealtime Audio/Video]
    DB[(Session Storage\nJSON files in backend/sessions)]

    UI -->|POST create session| API
    UI <-->|coach WS messages| WS1
    UI <-->|live WS audio/video| WS2
    CAM -->|biometric_data / biometric_update| WS1
    CAM -->|biometric_update| WS2
    MIC -->|user_speech transcript| WS1

    WS1 --> ENG --> GM --> GEM
    WS2 --> LIVE

    API --> SM
    ENG --> SM
    SM --> DB
```

For a complete architecture document with sequence and deployment diagrams, see `architecture.md`.

- Frontend creates a session via `POST /api/session/create`, then opens a WebSocket at `/ws/coach/{session_id}`.
- Speech transcripts are sent as `user_speech` messages; biometric data is sent every second as `biometric_data` messages.
- Backend routes messages through the `CoachingEngine`, which calls Gemini and returns structured JSON responses.
- Sessions are persisted as JSON files under `backend/sessions/` with 24-hour validity and automatic context compression for long conversations.

## Important Notes

- Biometric monitoring (heart rate via rPPG) is **not medical grade** — for educational purposes only.
- Best results in a **quiet, well-lit** environment.
- Requires a **WebGL-capable browser** (Chrome or Edge recommended).
- The system targets **sub-200ms** response times for real-time interaction.

## Reproducible Testing

### 1. Verify Gemini model access

Create `backend/test_gemini.py`:

```python
import os, asyncio, google.generativeai as genai
from dotenv import load_dotenv
load_dotenv()
genai.configure(api_key=os.environ["GEMINI_API_KEY"])
model = genai.GenerativeModel("gemini-2.0-flash-exp")
resp = asyncio.run(model.generate_content_async("Say hello"))
print("Gemini connection OK -", resp.text[:60])
```

```bash
cd backend && python3 test_gemini.py
```

---

### 2. Tutor agent modules (no API key required)

Create `backend/test_tutor_agent.py`:

```python
from tutor_agent import (
    TutorPersonalityLayer, TutorAgentDecisionEngine,
    SpeechIntentAnalyzer, AudioClassifier
)

layer = TutorPersonalityLayer()
prompt = layer.enrich_prompt("Teach Python basics.")
assert "honest" in prompt.lower() or "patient" in prompt.lower()
print("TutorPersonalityLayer OK")

engine = TutorAgentDecisionEngine()
engine.update_from_student("sess1", "I am confused about this")
action = engine.next_action("sess1")
assert action in ("re_explain", "provide_example", "ask_socratic", "continue", "suggest_path")
print(f"TutorAgentDecisionEngine OK - action={action}")

assert SpeechIntentAnalyzer.classify("") == "EMPTY"
assert SpeechIntentAnalyzer.classify("what is recursion?") == "HUMAN_SPEECH_DIRECTED"
print("SpeechIntentAnalyzer OK")

assert AudioClassifier.classify(bytes(200)) == "SILENCE"
print("AudioClassifier OK")

print("All tutor_agent tests passed.")
```

```bash
cd backend && python3 test_tutor_agent.py
```

---

### 3. TTS service test

Create `backend/test_tts.py`:

```python
import os, requests
from dotenv import load_dotenv
load_dotenv()
key = os.environ.get("GOOGLE_TTS_API_KEY", "")
r = requests.post(
    f"https://texttospeech.googleapis.com/v1/text:synthesize?key={key}",
    json={
        "input": {"text": "Hello"},
        "voice": {"languageCode": "en-US", "name": "en-US-Neural2-F"},
        "audioConfig": {"audioEncoding": "MP3"}
    },
    timeout=10,
)
assert r.status_code == 200, f"TTS API error {r.status_code}: {r.text[:200]}"
assert "audioContent" in r.json()
print(f"Google TTS OK - audio base64 length: {len(r.json()['audioContent'])}")
```

```bash
cd backend && python3 test_tts.py
```

---

### 4. Backend health check

With the backend running (`uvicorn main:app --reload --port 8000`):

```bash
curl -s http://localhost:8000/health | python3 -m json.tool
```

Expected: `{"status": "ok"}`

---

### 5. Session creation

```bash
curl -s -X POST http://localhost:8000/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"mode":"tutoring","topic":"Python lists"}' \
  | python3 -m json.tool
```

Expected: JSON with a `session_id` UUID field.

---

### 6. WebSocket coaching flow

Create `backend/test_websocket.py`:

```python
import asyncio, json, websockets

async def test():
    uri = "ws://localhost:8000/ws/coaching/test-ws-session"
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({
            "type": "user_speech",
            "text": "Explain what a list is in Python",
            "mode": "tutoring",
            "topic": "Python lists"
        }))
        msg = await asyncio.wait_for(ws.recv(), timeout=30)
        data = json.loads(msg)
        assert data.get("type") in ("step", "check_in", "response", "error")
        print("WebSocket coaching flow OK - type:", data.get("type"))

asyncio.run(test())
```

```bash
cd backend && python3 test_websocket.py
```

---

### 7. Frontend type check

```bash
npx tsc --noEmit
```

Expected: no output (zero TypeScript errors).

---

### 8. Frontend lint

```bash
npm run lint
```

Expected: `No ESLint warnings or errors.`

---

### 9. Manual end-to-end checklist

Run these steps in a browser after both servers are running:

| # | Step | Expected Result |
|---|------|----------------|
| 1 | Open http://localhost:3000 | Landing page loads; three mode cards visible |
| 2 | Click **Tutor** card | Setup dialog opens with topic input field |
| 3 | Click **Back to Home** in setup dialog | Returns to landing page |
| 4 | Re-open Tutor, type a topic, click **Start Session** | Coaching interface loads |
| 5 | Grant microphone permission when prompted | Mic permission row shows "Granted" |
| 6 | Skip camera permission | Camera row shows "Skipped" |
| 7 | Speak a question about your topic | AI responds with a numbered step; avatar mouth animates |
| 8 | Click the **Public Speaking** card | Correct mode loads |
| 9 | Click the **Interview Prep** card | Correct mode loads |
| 10 | Scroll the home page | Scroll is smooth with no jank |
| 11 | Verify AI voice | Voice is female (Samantha / Zira / Neural2-F) |

---

## License

MIT

## Acknowledgments

- Google Gemini
- Ready Player Me

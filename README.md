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

```text
Browser                          Server
┌──────────────────┐       ┌──────────────────┐
│  Next.js App     │       │  FastAPI          │
│                  │       │                  │
│  CoachingSession │◄─ws──►│  WebSocket        │
│  AudioProcessor  │       │  CoachingEngine   │
│  BiometricMonitor│       │  GeminiClient     │
│  AvatarScene     │       │  SessionManager   │
│  Whiteboard      │       │                  │
└──────────────────┘       └───────┬──────────┘
                                   │
                           ┌───────▼──────────┐
                           │  Google Gemini    │
                           │  API              │
                           └──────────────────┘
```

- Frontend creates a session via `POST /api/session/create`, then opens a WebSocket at `/ws/coach/{session_id}`.
- Speech transcripts are sent as `user_speech` messages; biometric data is sent every second as `biometric_data` messages.
- Backend routes messages through the `CoachingEngine`, which calls Gemini and returns structured JSON responses.
- Sessions are persisted as JSON files under `backend/sessions/` with 24-hour validity and automatic context compression for long conversations.

## Important Notes

- Biometric monitoring (heart rate via rPPG) is **not medical grade** — for educational purposes only.
- Best results in a **quiet, well-lit** environment.
- Requires a **WebGL-capable browser** (Chrome or Edge recommended).
- The system targets **sub-200ms** response times for real-time interaction.

## License

MIT

## Acknowledgments

- Google Gemini
- Ready Player Me

# socratic_mirror

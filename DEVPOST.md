## Inspiration

The best teachers don't lecture — they ask questions. The Socratic method has guided human learning for 2,500 years: instead of giving answers, a good tutor asks *"Why do you think that?"* and *"What would happen if…?"* until the student discovers the answer themselves.

We wanted to bring that experience into an AI that doesn't just talk *at* you — one that watches your face, hears the hesitation in your voice, and adapts in real time. The idea of a **mirror** is intentional: the system reflects your own understanding back at you, making invisible confusion visible so you can face and fix it.

Watching students cram for exams with passive YouTube videos, and seeing interview candidates crumble under pressure despite knowing the material, made the problem concrete. The gap isn't knowledge — it's the lack of a patient, always-available human presence that challenges you just enough. We built that presence.

---

## What it does

**Socratic Mirror Agent** is a multimodal AI coaching platform with three modes:

### Socratic Tutoring

You name a topic — *"explain gradient descent"* or *"help me understand recursion"* — and the AI teaches through guided questions rather than monologues. It renders live visual aids (equations, step lists, diagrams, tables) on a whiteboard panel. Every 3–4 steps it checks your understanding with a targeted question. It never repeats itself, and if you signal confusion it re-explains from a different angle.

The teaching follows a deliberate rhythm. For a concept like backpropagation, the AI builds intuition before revealing the full chain rule update:

$$\delta^{(l)} = \left(W^{(l+1)}\right)^T \delta^{(l+1)} \odot \sigma'\!\left(z^{(l)}\right)$$

### Public Speaking Coach

Choose a speech type (persuasive, informative, impromptu), enter your topic, and optionally upload a script. The AI listens, tracks filler words and pacing in real time, then gives structured feedback with specific timestamp references.

### Interview Prep

Paste a job description, optionally upload your resume, and face a realistic interviewer that cycles through background, technical, and behavioral questions with intelligent follow-ups based on your actual answers.

After every session, a **Vibe Report** summarises your performance score, strengths, and areas to improve — printable and exportable.

---

## How we built it

The stack spans three layers communicating over a persistent WebSocket connection.

**Frontend — Next.js + React Three Fiber**

The 3D avatar is a Ready Player Me `.glb` model rigged with Three.js bone controls. Lip-sync is driven by a viseme timeline: the backend returns an array of `{ viseme, time_ms }` events alongside audio, which the avatar renderer replays against `performance.now()` so mouth shapes track syllables precisely.

**Backend — FastAPI + Gemini**

The FastAPI server manages session state and routes two WebSocket message types: `user_speech` (text transcript) and `biometric_data` (heart rate, stress score, engagement). The `CoachingEngine` builds a structured system prompt for the active mode, calls Gemini 2.0 Flash, and returns typed JSON responses (`step`, `check_in`, `response`, `vibe_report`). For live voice mode, a bidirectional Gemini Live API bridge streams audio in 50 ms PCM chunks.

**Agentic tutoring layer — tutor_agent.py**

The most novel piece is the decision engine sitting between the student and the Gemini prompt. It tracks per-session state — confusion count, correct-answer streaks, steps since the last worked example — and emits an action hint:

| Hint | Trigger | Gemini behaviour |
|---|---|---|
| `continue` | Normal progress | Next concept step |
| `re_explain` | 2+ confusion signals | Rephrase with analogy |
| `provide_example` | 4+ steps without an example | Concrete worked example |
| `ask_socratic` | High confidence detected | Probe deeper understanding |
| `suggest_path` | Diverging interest detected | Offer two sub-topics |

The hint is injected into the Gemini system prompt as a directive. The student never sees it — it just feels like a more attentive teacher.

An **IdleEngagementHandler** runs as an `asyncio` background task and fires one of six rotating re-engagement prompts if the student goes silent for 45 seconds.

---

## Challenges we ran into

**GPU compositing and scroll jank.** Animating three large background orbs with `filter: blur(80px)` forced the browser to repaint every frame at CPU cost, making the page feel like it was about to crash. The fix: remove the filter entirely. `radial-gradient` is already visually soft, and `will-change: transform` + `transform: translateZ(0)` lets the GPU compositor move elements without any per-frame repaint. Removing `backdrop-filter: blur()` from every card saved seven more compositor layers per frame.

**Voice gender.** The `SpeechSynthesisVoice` API exposes no `.gender` property. The TTS fallback kept selecting a male system default. We solved it with a name-pattern match across all known female voices on macOS (Samantha, Karen, Moira), Windows (Zira, Hazel), and Chrome/Edge (Aria, Jenny, Nova), plus `pitch: 1.15` as a last resort.

**Viseme timing drift.** If you load the viseme timeline at `fetch()` time, network and decode latency push mouth shapes ahead of the audio. Setting the timeline origin inside `audio.addEventListener('play')` — at the moment sound actually starts — eliminated drift entirely.

**Ambient audio false positives.** The live audio bridge initially sent every sound (keyboard clicks, background TV, passing cars) to Gemini. We added an `AudioClassifier` that computes RMS energy on raw 16-bit PCM:

$$E_{\text{RMS}} = \sqrt{\frac{1}{N}\sum_{i=0}^{N-1} x_i^2}$$

Chunks below threshold 250 are dropped as silence; 250–900 are classified as background noise. Above 900, a `SpeechIntentAnalyzer` determines whether the utterance is actually directed at the AI before it reaches the coaching engine.

---

## Accomplishments that we are proud of

- **Agentic tutoring loop** that genuinely adapts to the student's confusion level — the mechanism is invisible, it just feels like a more attentive teacher.
- **Sub-frame viseme sync**: mouth shapes track syllables with no perceptible drift even on a 300 ms round-trip connection.
- **Zero-jank landing page** running at a consistent 60 fps on integrated graphics after the GPU compositing fix.
- **Granular permission UX**: per-device (mic / camera) allow/skip dialogs with live status badges — students who decline camera still get a full tutoring session.
- End-to-end **bidirectional live audio pipeline**: PCM capture to AudioWorklet to WebSocket to Gemini Live to audio decode to viseme playback, built in a hackathon timeframe.

---

## What we learned

- **The Socratic method is hard to fake.** Making an AI withhold answers and ask leading questions requires explicit prompt engineering — Gemini's default instinct is to be helpful by explaining. The personality layer and action hints were necessary to override that bias.
- **Browser performance is about compositor layers, not just code.** A single `filter: blur()` on an animated element can cost more than hundreds of lines of JavaScript.
- **Agentic state machines beat prompt-only approaches.** Tracking confusion_count in Python and injecting it as a structured hint keeps Gemini on-task far more reliably than asking Gemini to self-monitor its own teaching behaviour.
- **The Web Speech API is deceptively inconsistent** — voice selection, timing events, and onend reliability vary significantly between Chrome, Edge, and Safari.

---

## What's next for Socratic Mirror Agent

- **Visual confusion detection** — feed webcam-detected expressions (furrowed brows, gaze breaks) directly into the decision engine alongside speech patterns.
- **Persistent learning profiles** — track mastered concepts across sessions and auto-skip them in future sessions on the same topic.
- **Collaborative mode** — two students, one AI moderator running a live Socratic dialogue between them.
- **Curriculum generation** — given a learning goal such as "understand transformer architecture", the agent generates and sequences a multi-session curriculum rather than treating each session independently.
- **LMS integration** — export session transcripts and Vibe Reports to Canvas, Moodle, or Google Classroom as assignment evidence.

/**
 * ttsPlayer — Google Cloud TTS audio player with viseme avatar integration.
 *
 * Usage:
 *   await speakWithVisemes(text, onStart, onEnd);
 *   stopCurrentTTS();   // for barge-in / interrupt
 *
 * How it works:
 *   1. POST /api/tts with the text.
 *   2. Backend returns { audio_b64, mime_type, viseme_events }.
 *   3. Decode base64 → Blob → object URL → HTMLAudioElement.
 *   4. On audio "play": call setVisemeTimeline(events) from AvatarModel.
 *   5. On audio "ended": call clearVisemeTimeline().
 *   6. Falls back to Web Speech API if the endpoint is unavailable.
 */

import {
    setVisemeTimeline,
    clearVisemeTimeline,
    type VisemeEvent,
} from '@/components/AvatarModel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TTSResponse {
    audio_b64: string;
    mime_type: string;
    viseme_events: VisemeEvent[];
}

// ---------------------------------------------------------------------------
// Module-level state — tracks the active Audio element for barge-in support
// ---------------------------------------------------------------------------

let _currentAudio: HTMLAudioElement | null = null;

/** Stop the currently playing TTS audio immediately (barge-in / interrupt). */
export function stopCurrentTTS(): void {
    if (_currentAudio) {
        _currentAudio.pause();
        _currentAudio.currentTime = 0;
        _currentAudio = null;
    }
    clearVisemeTimeline();
    // Also cancel Web Speech API in case we are mid-fallback utterance
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
}

// ---------------------------------------------------------------------------
// Main speak function
// ---------------------------------------------------------------------------

const BACKEND_URL =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

/**
 * Speak text using Google Cloud TTS with viseme-driven avatar animation.
 *
 * @param text      Text to speak.
 * @param onStart   Called when audio playback begins.
 * @param onEnd     Called when audio playback ends (or errors).
 *
 * Falls back to the Web Speech API if the backend returns a non-OK response
 * (e.g. GOOGLE_TTS_API_KEY is not set) or if a network error occurs.
 */
export async function speakWithVisemes(
    text: string,
    onStart?: () => void,
    onEnd?: () => void,
): Promise<void> {
    if (!text.trim()) {
        onEnd?.();
        return;
    }

    // Attempt Google Cloud TTS via backend
    let ttsResult: TTSResponse | null = null;
    try {
        const res = await fetch(`${BACKEND_URL}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
        if (res.ok) {
            ttsResult = (await res.json()) as TTSResponse;
        } else {
            console.warn(`[ttsPlayer] /api/tts returned ${res.status} — falling back to Web Speech API`);
        }
    } catch (err) {
        console.warn('[ttsPlayer] /api/tts fetch failed — falling back to Web Speech API', err);
    }

    if (ttsResult) {
        return _playGoogleTTS(ttsResult, onStart, onEnd);
    }
    return _playWebSpeech(text, onStart, onEnd);
}

// ---------------------------------------------------------------------------
// Internal: play Google Cloud TTS audio
// ---------------------------------------------------------------------------

function _playGoogleTTS(
    result: TTSResponse,
    onStart?: () => void,
    onEnd?: () => void,
): Promise<void> {
    return new Promise<void>((resolve) => {
        // Decode base64 → Uint8Array → Blob → object URL
        let url = '';
        try {
            const raw = atob(result.audio_b64);
            const bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            const blob = new Blob([bytes], { type: result.mime_type });
            url = URL.createObjectURL(blob);
        } catch (err) {
            console.error('[ttsPlayer] Failed to decode audio:', err);
            onEnd?.();
            resolve();
            return;
        }

        const audio = new Audio(url);
        _currentAudio = audio;

        const cleanup = () => {
            clearVisemeTimeline();
            URL.revokeObjectURL(url);
            if (_currentAudio === audio) _currentAudio = null;
        };

        audio.addEventListener('play', () => {
            // Load the viseme timeline at the moment playback actually starts
            // so the module-level clock (performance.now()) aligns with audio.
            setVisemeTimeline(result.viseme_events);
            onStart?.();
        });

        audio.addEventListener('ended', () => {
            cleanup();
            onEnd?.();
            resolve();
        });

        audio.addEventListener('error', (e) => {
            console.error('[ttsPlayer] Audio playback error:', e);
            cleanup();
            onEnd?.();
            resolve();
        });

        audio.play().catch((err) => {
            console.error('[ttsPlayer] audio.play() rejected:', err);
            cleanup();
            onEnd?.();
            resolve();
        });
    });
}

// ---------------------------------------------------------------------------
// Internal: Web Speech API fallback (no viseme data available)
// ---------------------------------------------------------------------------

function _playWebSpeech(
    text: string,
    onStart?: () => void,
    onEnd?: () => void,
): Promise<void> {
    return new Promise<void>((resolve) => {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            onEnd?.();
            resolve();
            return;
        }

        const speak = (voices: SpeechSynthesisVoice[]) => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'en-US';

            // Pick a female English voice. Try common female voice names across
            // macOS (Samantha, Karen, Victoria, Moira, Tessa),
            // Windows (Zira, Hazel), Chrome/Edge (Aria, Jenny, Nova),
            // then any voice with "female" in the name, then any en-US voice.
            const enUS = voices.filter(v => v.lang.toLowerCase().startsWith('en'));
            const femaleVoice =
                enUS.find(v => /(samantha|karen|victoria|moira|tessa|zira|hazel|aria|jenny|nova|ava|female)/i.test(v.name)) ??
                enUS.find(v => v.lang.toLowerCase() === 'en-us') ??
                enUS[0] ??
                voices[0];
            if (femaleVoice) utterance.voice = femaleVoice;
            utterance.pitch = 1.15;
            utterance.rate = 0.95;

            utterance.onstart = () => onStart?.();
            utterance.onend = () => { onEnd?.(); resolve(); };
            utterance.onerror = () => { onEnd?.(); resolve(); };

            window.speechSynthesis.speak(utterance);
        };

        // getVoices() is empty on first call in Chrome — wait for voiceschanged
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            speak(voices);
        } else {
            window.speechSynthesis.addEventListener('voiceschanged', () => {
                speak(window.speechSynthesis.getVoices());
            }, { once: true });
            // Safety timeout: if voiceschanged never fires, speak anyway
            setTimeout(() => {
                if (window.speechSynthesis.getVoices().length === 0) {
                    speak([]);
                }
            }, 1000);
        }
    });
}

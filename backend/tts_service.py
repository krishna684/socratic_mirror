"""
Google Cloud Text-to-Speech service with SSML word-mark timing and viseme generation.

Uses the Cloud TTS REST API with an API key — no service account required.

Flow:
  1. Wrap each word in the input text with an SSML <mark> tag.
  2. POST to the Cloud TTS synthesize endpoint with enableTimePointing: ["SSML_MARK"].
  3. The response includes base64 MP3 audio + timepoints [{markName, timeSeconds}, ...].
  4. Map each word's time range → phoneme sequence → VisemeEvent list.
  5. Return {audio_b64, mime_type, viseme_events} for the frontend.

Required env var:
  GOOGLE_TTS_API_KEY  — Cloud TTS API key (enable the Text-to-Speech API in Cloud Console).

Optional env vars:
  GOOGLE_TTS_VOICE    — Voice name (default: en-US-Neural2-F).
  GOOGLE_TTS_RATE     — Speaking rate 0.25–4.0 (default: 1.0).
"""

from typing import Any, Dict, List, Optional
import asyncio
import base64
import os
import re

try:
    import httpx
    _HTTPX_AVAILABLE = True
except ImportError:
    _HTTPX_AVAILABLE = False


# ---------------------------------------------------------------------------
# Viseme label → English phoneme heuristic
# ---------------------------------------------------------------------------

# Digraphs are checked before single characters (longest-match wins).
_DIGRAPH_TO_VISEME: Dict[str, str] = {
    # Rounded vowel digraphs → O
    "oo": "O", "ou": "O", "ow": "O", "oi": "O",
    "aw": "O", "au": "O", "ue": "O", "ew": "O",
    # Open vowel digraphs → A
    "ai": "A", "ay": "A", "ea": "A", "ee": "A",
    "ie": "A", "ey": "A", "ei": "A",
    # Alveolar digraphs → L
    "th": "L", "ch": "L", "sh": "L", "ng": "L",
    "wh": "L", "ck": "L", "gh": "L",
    # Labiodental digraph → FV
    "ph": "FV",
}

_CHAR_TO_VISEME: Dict[str, str] = {
    # Open vowels → A
    "a": "A", "e": "A", "i": "A",
    # Rounded vowels → O
    "o": "O", "u": "O",
    # Bilabials → M
    "m": "M", "b": "M", "p": "M",
    # Labiodentals → FV
    "f": "FV", "v": "FV",
    # Alveolars / dentals → L
    "l": "L", "d": "L", "t": "L", "n": "L",
    "s": "L", "z": "L", "r": "L",
    # Rounded approximant → O (w has rounded lips)
    "w": "O",
    # Palatal approximant → L
    "y": "L",
    # Voiced velar → neutral (no strong visible shape, skip)
    # k, g, h, c, q, x → omitted on purpose (minimal lip contribution)
}


def _word_to_visemes(word: str) -> List[str]:
    """
    Convert a single English word to a sequence of viseme labels.

    Uses digraph-first matching on the cleaned (alpha-only) form of the word.
    Silent or back-of-throat consonants (k, g, h, c, q, x) contribute no
    visible mouth shape and are skipped so the mouth does not animate
    unnecessarily.
    """
    cleaned = re.sub(r"[^a-z]", "", word.lower())
    if not cleaned:
        return ["A"]

    visemes: List[str] = []
    i = 0
    while i < len(cleaned):
        digraph = cleaned[i: i + 2]
        if digraph in _DIGRAPH_TO_VISEME:
            visemes.append(_DIGRAPH_TO_VISEME[digraph])
            i += 2
            continue
        v = _CHAR_TO_VISEME.get(cleaned[i])
        if v is not None:
            visemes.append(v)
        # else: silent/back consonant — advance without emitting
        i += 1

    return visemes if visemes else ["A"]


def _build_viseme_events(
    words: List[str],
    timepoints: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Convert word-level SSML timepoints to a flat VisemeEvent list.

    Each timepoint has the shape {markName: "w{i}", timeSeconds: float}.
    Phonemes within a word are distributed evenly across its time span.
    The last word receives a 0.3 s estimated duration when no next mark exists.
    """
    # Build index → time_seconds lookup
    tp_map: Dict[int, float] = {}
    for tp in timepoints:
        mark = tp.get("markName", "")
        if mark.startswith("w"):
            try:
                tp_map[int(mark[1:])] = float(tp.get("timeSeconds", 0.0))
            except ValueError:
                pass

    events: List[Dict[str, Any]] = []

    for i, word in enumerate(words):
        if i not in tp_map:
            # Mark missing from response — skip this word
            continue

        start = tp_map[i]
        end = tp_map.get(i + 1, start + 0.30)
        duration = max(end - start, 0.04)

        phonemes = _word_to_visemes(word)
        step = duration / len(phonemes)

        for j, viseme in enumerate(phonemes):
            events.append({
                "time": round(start + j * step, 4),
                "viseme": viseme,
            })

    return events


# ---------------------------------------------------------------------------
# TTSService
# ---------------------------------------------------------------------------

class TTSService:
    """
    Async Google Cloud TTS client using the REST API.

    Typical usage:
        tts = TTSService(api_key=os.getenv("GOOGLE_TTS_API_KEY"))
        result = await tts.synthesize("Hello, let's learn about calculus.")
        # result = {"audio_b64": "...", "mime_type": "audio/mp3", "viseme_events": [...]}
    """

    _ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize"

    def __init__(
        self,
        api_key: str,
        default_voice: str = "en-US-Neural2-F",
        default_speaking_rate: float = 1.0,
    ) -> None:
        self.api_key = api_key
        self.default_voice = default_voice
        self.default_speaking_rate = default_speaking_rate
        self._client: Optional[Any] = None

    def is_available(self) -> bool:
        """Return True when the service can make requests."""
        return bool(self.api_key) and _HTTPX_AVAILABLE

    def _client_instance(self) -> Any:
        if not _HTTPX_AVAILABLE:
            raise RuntimeError(
                "httpx is required for Google Cloud TTS. "
                "Run: pip install httpx"
            )
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=20.0)
        return self._client

    async def synthesize(
        self,
        text: str,
        voice_name: Optional[str] = None,
        language_code: str = "en-US",
        speaking_rate: Optional[float] = None,
        pitch: float = 0.0,
    ) -> Optional[Dict[str, Any]]:
        """
        Synthesize text and return audio + viseme events.

        Returns a dict with keys:
            audio_b64     (str)   — base64-encoded MP3
            mime_type     (str)   — "audio/mp3"
            viseme_events (list)  — [{time: float, viseme: str}, ...]

        Returns None on any failure so callers can fall back gracefully.
        """
        if not text.strip() or not self.is_available():
            return None

        voice = voice_name or self.default_voice
        rate = speaking_rate if speaking_rate is not None else self.default_speaking_rate

        # Wrap each whitespace-delimited token in a <mark> for word-level timing.
        # We keep the original tokens (including punctuation) so the TTS engine
        # reads them naturally; the mark just precedes the token.
        words = text.split()
        ssml_parts = [f'<mark name="w{i}"/>{word}' for i, word in enumerate(words)]
        ssml = "<speak>" + " ".join(ssml_parts) + "</speak>"

        payload: Dict[str, Any] = {
            "input": {"ssml": ssml},
            "voice": {
                "languageCode": language_code,
                "name": voice,
            },
            "audioConfig": {
                "audioEncoding": "MP3",
                "speakingRate": rate,
                "pitch": pitch,
                "enableTimePointing": ["SSML_MARK"],
            },
        }

        try:
            client = self._client_instance()
            response = await client.post(
                self._ENDPOINT,
                params={"key": self.api_key},
                json=payload,
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
            data: Dict[str, Any] = response.json()
        except Exception as exc:
            print(f"[TTSService] Google Cloud TTS request failed: {exc}")
            return None

        audio_b64: str = data.get("audioContent", "")
        if not audio_b64:
            print("[TTSService] Response contained no audioContent.")
            return None

        timepoints: List[Dict[str, Any]] = data.get("timepoints", [])
        viseme_events = _build_viseme_events(words, timepoints)

        return {
            "audio_b64": audio_b64,
            "mime_type": "audio/mp3",
            "viseme_events": viseme_events,
        }

    async def close(self) -> None:
        """Release the underlying HTTP client."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None


# ---------------------------------------------------------------------------
# Module-level singleton (optional convenience — main.py can also instantiate)
# ---------------------------------------------------------------------------

def create_tts_service() -> TTSService:
    """
    Create a TTSService from environment variables.

    GOOGLE_TTS_API_KEY  — required
    GOOGLE_TTS_VOICE    — optional (default: en-US-Neural2-F)
    GOOGLE_TTS_RATE     — optional float (default: 1.0)
    """
    api_key = os.getenv("GOOGLE_TTS_API_KEY", "")
    voice = os.getenv("GOOGLE_TTS_VOICE", "en-US-Neural2-F")
    rate = float(os.getenv("GOOGLE_TTS_RATE", "1.0"))
    return TTSService(api_key=api_key, default_voice=voice, default_speaking_rate=rate)

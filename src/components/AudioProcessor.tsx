'use client';

import { useState, useEffect, useRef } from 'react';

export type AudioEvent =
    | { kind: 'activity'; isSpeaking: boolean }
    | { kind: 'utterance'; text: string }
    | { kind: 'error'; message: string };

interface AudioProcessorProps {
    onAudioEvent: (event: AudioEvent) => void;
    isActive?: boolean;
    isAiSpeaking?: boolean;
    silenceMsToCommit?: number;
    idleResultCommitMs?: number;
    minUtteranceChars?: number;
}

const styles = {
    card: {
        background: 'rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '1.5rem',
        padding: '1.5rem',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '1rem',
    },
    title: {
        fontSize: '1rem',
        fontWeight: 700,
        color: '#F3F4F6',
        margin: 0,
        fontFamily: '"DM Sans","Inter",sans-serif',
        letterSpacing: '-0.01em',
    },
    badge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.4rem 0.9rem',
        borderRadius: '2rem',
        fontSize: '0.75rem',
        fontWeight: 600,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px',
    },
    badgeSuccess: {
        background: 'rgba(34, 197, 94, 0.15)',
        border: '1px solid rgba(34, 197, 94, 0.3)',
        color: '#4ADE80',
    },
    badgePaused: {
        background: 'rgba(255, 255, 255, 0.08)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        color: '#9CA3AF',
    },
    waveformContainer: {
        background: 'rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '0.75rem',
        padding: '1.5rem',
        height: '6rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        marginBottom: '1rem',
    },
    waveformBar: {
        width: '4px',
        minHeight: '30%',
        background: 'linear-gradient(180deg, #FCD34D, #FBBF24)',
        borderRadius: '2px',
        transition: 'height 0.1s ease',
    },
    progressBar: {
        width: '100%',
        height: '4px',
        background: 'rgba(255, 255, 255, 0.1)',
        borderRadius: '9999px',
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        background: 'linear-gradient(90deg, #FBBF24, #F59E0B)',
        borderRadius: '9999px',
        transition: 'width 0.15s ease',
    },
    button: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1.5rem',
        borderRadius: '0.75rem',
        fontWeight: 600,
        fontSize: '0.95rem',
        border: '1px solid',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        marginBottom: '1rem',
    },
    buttonPrimary: {
        background: 'linear-gradient(135deg, #FBBF24, #F59E0B)',
        color: '#000',
        borderColor: '#FCD34D',
        boxShadow: '0 4px 20px rgba(251, 191, 36, 0.3)',
    },
    buttonDanger: {
        background: 'rgba(239, 68, 68, 0.15)',
        color: '#F87171',
        borderColor: 'rgba(239, 68, 68, 0.3)',
    },
    transcript: {
        background: 'rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '0.75rem',
        padding: '1rem',
    },
    transcriptLabel: {
        fontSize: '0.75rem',
        color: '#9CA3AF',
        marginBottom: '0.5rem',
    },
    transcriptText: {
        fontSize: '0.875rem',
        color: '#fff',
        lineHeight: '1.6',
        margin: 0,
    },
    permissionCard: {
        textAlign: 'center' as const,
        padding: '2rem 0',
    },
    permissionIcon: {
        fontSize: '3rem',
        marginBottom: '1rem',
    },
    permissionText: {
        fontSize: '0.875rem',
        color: '#9CA3AF',
        maxWidth: '20rem',
        margin: '0 auto 1.5rem',
    },
};

// ─── constants ───────────────────────────────────────────────────────────────
const VAD_INTERVAL_MS = 150;          // volume polling — replaces rAF, much less CPU
const SILENCE_COMMIT_MS = 1800;       // ms of silence after last speech → commit
const IDLE_COMMIT_MS = 2000;          // fallback commit after last onresult
const MIN_CHARS = 3;
const DEDUP_WINDOW_MS = 2000;

export default function AudioProcessor({
    onAudioEvent,
    isActive = true,
    isAiSpeaking = false,
    silenceMsToCommit = SILENCE_COMMIT_MS,
    idleResultCommitMs = IDLE_COMMIT_MS,
    minUtteranceChars = MIN_CHARS,
}: AudioProcessorProps) {
    const [isListening, setIsListening] = useState(false);
    const [isUserSpeaking, setIsUserSpeaking] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [hasPermission, setHasPermission] = useState<boolean | null>(null); // null = not yet asked
    const [volume, setVolume] = useState(0);
    const [waveHeights, setWaveHeights] = useState([30, 30, 30, 30, 30]);

    // Refs that closures can always read fresh values from
    const onEventRef = useRef(onAudioEvent);
    const isActiveRef = useRef(isActive);
    const isAiSpeakingRef = useRef(isAiSpeaking);
    const silenceMsRef = useRef(silenceMsToCommit);
    const idleMsRef = useRef(idleResultCommitMs);
    const minCharsRef = useRef(minUtteranceChars);

    const recognitionRef = useRef<any>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // Transcript accumulation
    const transcriptRef = useRef('');
    const lastCommitRef = useRef({ text: '', at: 0 });

    // Timers
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const volumeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastSpeechAtRef = useRef(0);

    // Keep all refs current every render
    useEffect(() => { onEventRef.current = onAudioEvent; }, [onAudioEvent]);
    useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
    useEffect(() => { isAiSpeakingRef.current = isAiSpeaking; }, [isAiSpeaking]);
    useEffect(() => { silenceMsRef.current = silenceMsToCommit; }, [silenceMsToCommit]);
    useEffect(() => { idleMsRef.current = idleResultCommitMs; }, [idleResultCommitMs]);
    useEffect(() => { minCharsRef.current = minUtteranceChars; }, [minUtteranceChars]);

    // ── helpers ──────────────────────────────────────────────────────────────

    const clearTimers = () => {
        if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
        if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    };

    const commitUtterance = (text: string) => {
        const clean = text.trim().replace(/\s+/g, ' ');
        if (clean.length < minCharsRef.current) return;
        const now = Date.now();
        if (lastCommitRef.current.text === clean && now - lastCommitRef.current.at < DEDUP_WINDOW_MS) return;
        lastCommitRef.current = { text: clean, at: now };
        transcriptRef.current = '';
        setTranscript('');
        clearTimers();
        onEventRef.current({ kind: 'utterance', text: clean });
    };

    const scheduleIdleCommit = () => {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => {
            if (!isActiveRef.current || isAiSpeakingRef.current) return;
            const t = transcriptRef.current.trim();
            if (t) commitUtterance(t);
        }, idleMsRef.current);
    };

    // ── volume polling (setInterval, not rAF) ────────────────────────────────

    const startVolumePolling = () => {
        if (volumeIntervalRef.current) return;
        volumeIntervalRef.current = setInterval(() => {
            if (!analyserRef.current) return;
            const buf = new Uint8Array(analyserRef.current.frequencyBinCount);
            analyserRef.current.getByteFrequencyData(buf);
            const rms = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
            const vol = Math.min(100, (rms / 128) * 100);
            setVolume(vol);

            const speaking = rms > 18 && !isAiSpeakingRef.current;
            setIsUserSpeaking(speaking);

            if (speaking) {
                lastSpeechAtRef.current = Date.now();
                // cancel silence timer while user is actively speaking
                if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
                onEventRef.current({ kind: 'activity', isSpeaking: true });
            } else {
                const silentFor = Date.now() - lastSpeechAtRef.current;
                if (lastSpeechAtRef.current > 0 && silentFor > silenceMsRef.current && transcriptRef.current.trim()) {
                    // user has been silent long enough — commit
                    const t = transcriptRef.current.trim();
                    lastSpeechAtRef.current = 0;
                    commitUtterance(t);
                } else {
                    onEventRef.current({ kind: 'activity', isSpeaking: false });
                }
            }
        }, VAD_INTERVAL_MS);
    };

    const stopVolumePolling = () => {
        if (volumeIntervalRef.current) { clearInterval(volumeIntervalRef.current); volumeIntervalRef.current = null; }
        setVolume(0);
        setIsUserSpeaking(false);
    };

    // ── waveform animation (only while sound detected) ───────────────────────

    useEffect(() => {
        if (isUserSpeaking || isAiSpeaking) {
            const iv = setInterval(() => {
                setWaveHeights([
                    Math.random() * 70 + 30,
                    Math.random() * 70 + 30,
                    Math.random() * 70 + 30,
                    Math.random() * 70 + 30,
                    Math.random() * 70 + 30,
                ]);
            }, 100);
            return () => clearInterval(iv);
        } else {
            setWaveHeights([30, 30, 30, 30, 30]);
        }
    }, [isUserSpeaking, isAiSpeaking]);

    // ── speech recognition ───────────────────────────────────────────────────

    const startRecognition = () => {
        if (!recognitionRef.current) return;
        try { recognitionRef.current.start(); } catch (_) { /* already running */ }
    };

    const stopRecognition = () => {
        if (!recognitionRef.current) return;
        try { recognitionRef.current.stop(); } catch (_) { }
    };

    const buildRecognition = () => {
        const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
        if (!SR) return null;
        const r = new SR();
        r.continuous = true;
        r.interimResults = true;
        r.lang = 'en-US';

        r.onresult = (e: any) => {
            if (!isActiveRef.current) return;
            let interim = '', final = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const seg = e.results[i]?.[0]?.transcript || '';
                if (e.results[i]?.isFinal) final += seg + ' ';
                else interim += seg;
            }
            const combined = (final + interim).trim();
            if (!combined) return;
            transcriptRef.current = combined;
            setTranscript(combined);
            scheduleIdleCommit();
        };

        r.onerror = (e: any) => {
            const code = e?.error || 'unknown';
            if (code === 'aborted' || code === 'no-speech') return; // normal, will auto-restart
            if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
                setHasPermission(false);
            }
            onEventRef.current({ kind: 'error', message: `Speech recognition error: ${code}` });
        };

        r.onend = () => {
            // flush any pending transcript
            const t = transcriptRef.current.trim();
            if (t) commitUtterance(t);
            // auto-restart while we should be listening
            if (isActiveRef.current) {
                try { r.start(); } catch (_) { }
            }
        };

        return r;
    };

    // ── microphone setup (runs once on mount) ────────────────────────────────

    useEffect(() => {
        let cancelled = false;

        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
                streamRef.current = stream;
                setHasPermission(true);

                const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 256;
                ctx.createMediaStreamSource(stream).connect(analyser);
                audioContextRef.current = ctx;
                analyserRef.current = analyser;

                if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
                    onEventRef.current({ kind: 'error', message: 'Speech recognition not supported. Use text input.' });
                    return;
                }

                recognitionRef.current = buildRecognition();

                // Start immediately if already active
                if (isActiveRef.current) {
                    startRecognition();
                    startVolumePolling();
                    setIsListening(true);
                }
            })
            .catch(() => {
                if (cancelled) return;
                setHasPermission(false);
                onEventRef.current({ kind: 'error', message: 'Microphone permission denied or unavailable.' });
            });

        return () => {
            cancelled = true;
            clearTimers();
            stopVolumePolling();
            stopRecognition();
            streamRef.current?.getTracks().forEach(t => t.stop());
            audioContextRef.current?.close();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── react to isActive prop changes ───────────────────────────────────────

    useEffect(() => {
        if (!recognitionRef.current) return; // mic not ready yet

        if (isActive) {
            startRecognition();
            startVolumePolling();
            setIsListening(true);
        } else {
            clearTimers();
            stopVolumePolling();
            stopRecognition();
            setIsListening(false);
            transcriptRef.current = '';
            setTranscript('');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isActive]);

    // ─── render ──────────────────────────────────────────────────────────────

    if (hasPermission === false) {
        return (
            <div style={{ ...styles.card, ...styles.permissionCard }}>
                <div style={styles.permissionIcon} aria-hidden="true">🎤</div>
                <p style={styles.permissionText}>
                    Microphone access is required for voice coaching.
                    Please allow microphone access in your browser settings.
                </p>
            </div>
        );
    }

    return (
        <div style={styles.card}>
            <div style={styles.header}>
                <h3 style={styles.title}>Voice Processor</h3>
                <div
                    role="status"
                    aria-live="polite"
                    aria-label={isListening ? 'Voice processor listening' : 'Voice processor paused'}
                    style={{ ...styles.badge, ...(isListening ? styles.badgeSuccess : styles.badgePaused) }}
                >
                    {isListening ? 'Listening' : 'Paused'}
                </div>
            </div>

            {/* Waveform */}
            <div style={styles.waveformContainer} aria-hidden="true">
                {waveHeights.map((height, i) => (
                    <div
                        key={i}
                        style={{
                            ...styles.waveformBar,
                            height: `${height}%`,
                            opacity: (!isUserSpeaking && !isAiSpeaking) ? 0.3 : 1,
                            background: isAiSpeaking
                                ? 'linear-gradient(180deg, #3B82F6, #2563EB)'
                                : 'linear-gradient(180deg, #FCD34D, #FBBF24)',
                        }}
                    />
                ))}
            </div>

            {/* Volume */}
            <div style={{ marginBottom: transcript ? '1rem' : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '0.5rem' }}>
                    <span>Input Level</span>
                    <span>{volume.toFixed(0)}%</span>
                </div>
                <div style={styles.progressBar}>
                    <div style={{ ...styles.progressFill, width: `${volume}%` }} />
                </div>
            </div>

            {/* Live transcript */}
            {transcript && (
                <div style={styles.transcript}>
                    <p style={styles.transcriptLabel} id="transcript-label">Live Transcript</p>
                    <p style={styles.transcriptText} aria-labelledby="transcript-label" aria-live="polite">{transcript}</p>
                </div>
            )}
        </div>
    );
}

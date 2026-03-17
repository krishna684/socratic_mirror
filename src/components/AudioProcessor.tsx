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
        borderRadius: '1rem',
        transition: 'height 0.1s ease-out',
    },
    progressBar: {
        width: '100%',
        height: '8px',
        background: 'rgba(255, 255, 255, 0.08)',
        borderRadius: '1rem',
        overflow: 'hidden',
        marginBottom: '1rem',
    },
    progressFill: {
        height: '100%',
        background: 'linear-gradient(90deg, #FBBF24, #FCD34D)',
        borderRadius: '1rem',
        transition: 'width 0.3s ease',
    },
    button: {
        width: '100%',
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

export default function AudioProcessor({
    onAudioEvent,
    isActive = true,
    isAiSpeaking = false,
    silenceMsToCommit,
    idleResultCommitMs,
    minUtteranceChars,
}: AudioProcessorProps) {
    const [isListening, setIsListening] = useState(isActive);
    const [isUserSpeaking, setIsUserSpeaking] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [hasPermission, setHasPermission] = useState(false);
    const [volume, setVolume] = useState(0);
    const [waveHeights, setWaveHeights] = useState([30, 30, 30, 30, 30]);

    const recognitionRef = useRef<any>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const animationRef = useRef<number | null>(null);
    const transcriptRef = useRef('');
    const silenceStartRef = useRef<number | null>(null);
    const vadLoopRunningRef = useRef(false);
    const isActiveRef = useRef(isActive);
    const isListeningRef = useRef(isActive);
    const hasPermissionRef = useRef(false);
    const isAiSpeakingRef = useRef(isAiSpeaking);
    const lastCommittedUtteranceRef = useRef('');
    const lastCommitAtRef = useRef(0);
    const idleCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const MIN_UTTERANCE_CHARS_DEFAULT = 2;
    const SILENCE_MS_TO_COMMIT_DEFAULT = 500;
    const COMMIT_DEDUP_WINDOW_MS = 2000;
    const IDLE_RESULT_COMMIT_MS_DEFAULT = 700;
    const minUtteranceCharsRef = useRef(minUtteranceChars ?? MIN_UTTERANCE_CHARS_DEFAULT);
    const silenceMsToCommitRef = useRef(silenceMsToCommit ?? SILENCE_MS_TO_COMMIT_DEFAULT);
    const idleResultCommitMsRef = useRef(idleResultCommitMs ?? IDLE_RESULT_COMMIT_MS_DEFAULT);
    const lastSpeechAtRef = useRef(0);

    useEffect(() => {
        transcriptRef.current = transcript;
    }, [transcript]);

    useEffect(() => {
        isActiveRef.current = isActive;
    }, [isActive]);

    useEffect(() => {
        isListeningRef.current = isListening;
    }, [isListening]);

    useEffect(() => {
        hasPermissionRef.current = hasPermission;
    }, [hasPermission]);

    useEffect(() => {
        isAiSpeakingRef.current = isAiSpeaking;
    }, [isAiSpeaking]);

    useEffect(() => {
        minUtteranceCharsRef.current = minUtteranceChars ?? MIN_UTTERANCE_CHARS_DEFAULT;
    }, [minUtteranceChars]);

    useEffect(() => {
        silenceMsToCommitRef.current = silenceMsToCommit ?? SILENCE_MS_TO_COMMIT_DEFAULT;
    }, [silenceMsToCommit]);

    useEffect(() => {
        idleResultCommitMsRef.current = idleResultCommitMs ?? IDLE_RESULT_COMMIT_MS_DEFAULT;
    }, [idleResultCommitMs]);

    useEffect(() => {
        setIsListening(isActive);
        if (isActive) {
            if (recognitionRef.current && !isListening) {
                try { recognitionRef.current.start(); } catch (e) { }
            }
            if (!vadLoopRunningRef.current) {
                monitorVoiceActivity();
            }
        } else {
            clearIdleCommitTimer();
            if (recognitionRef.current) {
                try { recognitionRef.current.stop(); } catch (e) { }
            }
            vadLoopRunningRef.current = false;
        }
    }, [isActive]);

    useEffect(() => {
        initializeSpeechRecognition();
        return cleanup;
    }, []);

    useEffect(() => {
        if (isUserSpeaking || isAiSpeaking) {
            const interval = setInterval(() => {
                setWaveHeights([
                    Math.random() * 70 + 30,
                    Math.random() * 70 + 30,
                    Math.random() * 70 + 30,
                    Math.random() * 70 + 30,
                    Math.random() * 70 + 30,
                ]);
            }, 100);
            return () => clearInterval(interval);
        } else {
            setWaveHeights([30, 30, 30, 30, 30]);
        }
    }, [isUserSpeaking, isAiSpeaking]);

    const initializeSpeechRecognition = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            setHasPermission(true);

            setupAudioAnalysis(stream);

            if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
                const recognition = new SpeechRecognition();

                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.lang = 'en-US';

                recognition.onresult = (event: any) => {
                    let interimTranscript = '';
                    let finalTranscript = '';

                    for (let i = event.resultIndex; i < event.results.length; i++) {
                        const result = event.results?.[i];
                        const transcriptText = result?.[0]?.transcript || '';
                        if (!transcriptText) continue;
                        if (result?.isFinal) {
                            finalTranscript += transcriptText + ' ';
                        } else {
                            interimTranscript += transcriptText;
                        }
                    }

                    const currentTranscript = (finalTranscript + interimTranscript).trim();
                    if (currentTranscript) {
                        setTranscript(currentTranscript);
                        transcriptRef.current = currentTranscript;
                        scheduleIdleCommit();
                    } else {
                        clearIdleCommitTimer();
                    }

                    // Fast-path commit for short interview answers when the recognizer finalizes quickly.
                    const finalized = finalTranscript.trim();
                    if (finalized && !interimTranscript.trim() && finalized.length >= minUtteranceCharsRef.current) {
                        commitUtterance(finalized);
                        setTranscript('');
                        transcriptRef.current = '';
                        silenceStartRef.current = null;
                        clearIdleCommitTimer();
                    }
                };

                recognition.onerror = (event: any) => {
                    const code = event?.error || 'unknown';

                    // Normal transient recognizer states; auto-restart via onend.
                    if (code === 'aborted' || code === 'no-speech') {
                        return;
                    }

                    if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
                        setHasPermission(false);
                    }

                    onAudioEvent({
                        kind: 'error',
                        message: `Speech recognition error: ${code}`,
                    });
                };

                recognition.onend = () => {
                    if (transcriptRef.current.trim()) {
                        flushTranscriptAsUtterance();
                    }
                    if (isListeningRef.current && hasPermissionRef.current && isActiveRef.current) {
                        try {
                            recognition.start();
                        } catch (e) {
                            console.error("Failed to restart recognition:", e);
                        }
                    }
                };

                recognitionRef.current = recognition;

                // Auto-start listening if possible
                if (isListening) {
                    recognition.start();
                }
            } else {
                onAudioEvent({
                    kind: 'error',
                    message: 'Speech recognition is not supported in this browser. Use text input as fallback.',
                });
                setIsListening(false);
            }
        } catch (error) {
            console.error('Microphone access denied:', error);
            setHasPermission(false);
            onAudioEvent({
                kind: 'error',
                message: 'Microphone permission denied or unavailable.',
            });
        }
    };

    const commitUtterance = (rawText: string) => {
        const text = String(rawText || '').trim().replace(/\s+/g, ' ');
        if (text.length < minUtteranceCharsRef.current) return;

        const now = Date.now();
        const isDuplicate =
            lastCommittedUtteranceRef.current === text &&
            now - lastCommitAtRef.current < COMMIT_DEDUP_WINDOW_MS;

        if (isDuplicate) return;

        lastCommittedUtteranceRef.current = text;
        lastCommitAtRef.current = now;
        onAudioEvent({ kind: 'utterance', text });
    };

    const clearIdleCommitTimer = () => {
        if (idleCommitTimerRef.current) {
            clearTimeout(idleCommitTimerRef.current);
            idleCommitTimerRef.current = null;
        }
    };

    const flushTranscriptAsUtterance = () => {
        const finalText = transcriptRef.current.trim();
        if (finalText.length >= minUtteranceCharsRef.current) {
            commitUtterance(finalText);
        }
        setTranscript('');
        transcriptRef.current = '';
        silenceStartRef.current = null;
        clearIdleCommitTimer();
    };

    const scheduleIdleCommit = () => {
        clearIdleCommitTimer();
        idleCommitTimerRef.current = setTimeout(() => {
            if (!isActiveRef.current || isAiSpeakingRef.current) return;
            flushTranscriptAsUtterance();
        }, idleResultCommitMsRef.current);
    };

    const setupAudioAnalysis = (stream: MediaStream) => {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);

        analyser.fftSize = 256;
        microphone.connect(analyser);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        monitorVoiceActivity();
    };

    const monitorVoiceActivity = () => {
        if (!analyserRef.current || !isActiveRef.current || vadLoopRunningRef.current) return;

        vadLoopRunningRef.current = true;
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const checkVAD = () => {
            if (!analyserRef.current || !isActiveRef.current) {
                vadLoopRunningRef.current = false;
                return;
            }

            analyserRef.current.getByteFrequencyData(dataArray);

            const rms = Math.sqrt(
                dataArray.reduce((acc, val) => acc + val * val, 0) / bufferLength
            );

            const normalizedVolume = Math.min(100, (rms / 128) * 100);
            setVolume(normalizedVolume);

            const VAD_THRESHOLD = 20;
            const speaking = rms > VAD_THRESHOLD && !isAiSpeakingRef.current; // Direct isolation
            setIsUserSpeaking(speaking);

            // Silence Detection for Turn-taking
            if (speaking) {
                lastSpeechAtRef.current = Date.now();
                silenceStartRef.current = null;
                clearIdleCommitTimer();
                onAudioEvent({ kind: 'activity', isSpeaking: true });
            } else if (transcriptRef.current.trim()) {
                if (silenceStartRef.current === null) {
                    silenceStartRef.current = Date.now();
                } else if (Date.now() - silenceStartRef.current > silenceMsToCommitRef.current) {
                    // Turn finished!
                    flushTranscriptAsUtterance();
                }
            } else {
                onAudioEvent({ kind: 'activity', isSpeaking: false });
            }

            animationRef.current = requestAnimationFrame(checkVAD);
        };

        checkVAD();
    };

    const toggleListening = () => {
        if (!recognitionRef.current) return;

        if (isListening) {
            // Flush on stop
            flushTranscriptAsUtterance();
            try {
                recognitionRef.current.stop();
            } catch (error) {
                console.error('Error stopping recognition:', error);
            }
            setIsListening(false);
            setTranscript('');
            transcriptRef.current = '';
        } else {
            try {
                recognitionRef.current.start();
                setIsListening(true);
            } catch (error: any) {
                console.error('Error starting recognition:', error);
                if (error.message && error.message.includes('already started')) {
                    setIsListening(true);
                }
            }
        }
    };

    const cleanup = () => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
        }
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
        }
        clearIdleCommitTimer();
    };

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

            {/* Waveform Visualization */}
            <div style={styles.waveformContainer} aria-hidden="true">
                {waveHeights.map((height, i) => (
                    <div
                        key={i}
                        style={{
                            ...styles.waveformBar,
                            height: `${height}%`,
                            opacity: (!isUserSpeaking && !isAiSpeaking) ? 0.3 : 1,
                            background: isAiSpeaking ? 'linear-gradient(180deg, #3B82F6, #2563EB)' : 'linear-gradient(180deg, #FCD34D, #FBBF24)',
                        }}
                    />
                ))}
            </div>

            {/* Volume Meter */}
            <div style={{ marginBottom: transcript ? '1rem' : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: '#9CA3AF', marginBottom: '0.5rem' }}>
                    <span>Input Level</span>
                    <span>{volume.toFixed(0)}%</span>
                </div>
                <div style={styles.progressBar}>
                    <div style={{ ...styles.progressFill, width: `${volume}%` }}></div>
                </div>
            </div>

            {/* Transcript Display */}
            {transcript && (
                <div style={styles.transcript}>
                    <p style={styles.transcriptLabel} id="transcript-label">Live Transcript</p>
                    <p style={styles.transcriptText} aria-labelledby="transcript-label" aria-live="polite">{transcript}</p>
                </div>
            )}
        </div>
    );
}

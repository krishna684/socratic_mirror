'use client';

/**
 * LiveCoachingInterface
 * ---------------------
 * Connects to /ws/live/{sessionId} for true bidirectional audio with Gemini Live API.
 *
 * Audio pipeline:
 *   Microphone → AudioContext → AudioWorklet (resample 16 kHz, PCM Int16)
 *               → base64 → WebSocket → backend → Gemini Live API
 *               → PCM 24 kHz → WebSocket → base64 → AudioContext → Speaker
 *
 * Native barge-in: when the user speaks, Gemini detects the interruption
 * automatically and sends {"type":"interrupted"} – no client-side logic needed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BiometricData, CoachingMode } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LiveMessage {
    type:
        | 'live_ready'
        | 'audio_chunk'
        | 'transcript'
        | 'turn_complete'
        | 'interrupted'
        | 'error';
    data?: string;       // base64 PCM (audio_chunk)
    mime_type?: string;
    text?: string;       // transcript
    role?: 'model' | 'user';
    message?: string;    // error
    model?: string;      // live_ready
    session_id?: string; // live_ready
}

interface TranscriptEntry {
    role: 'model' | 'user';
    text: string;
}

interface Props {
    sessionId: string;
    mode: CoachingMode;
    biometricData?: BiometricData | null;
    onSessionEnd?: () => void;
}

// ---------------------------------------------------------------------------
// PCM 24 kHz → AudioBuffer player
// ---------------------------------------------------------------------------

function createPcmPlayer(audioCtx: AudioContext) {
    let nextStartTime = 0;

    return function playChunk(pcm16: Int16Array, sampleRate = 24000) {
        const floats = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) {
            floats[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
        }
        const buffer = audioCtx.createBuffer(1, floats.length, sampleRate);
        buffer.copyToChannel(floats, 0);

        const src = audioCtx.createBufferSource();
        src.buffer = buffer;
        src.connect(audioCtx.destination);

        const now = audioCtx.currentTime;
        const start = Math.max(now, nextStartTime);
        src.start(start);
        nextStartTime = start + buffer.duration;
    };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LiveCoachingInterface({ sessionId, mode, biometricData, onSessionEnd }: Props) {
    const wsRef = useRef<WebSocket | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const playChunkRef = useRef<((pcm: Int16Array) => void) | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    // Vision refs
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
    const [modelName, setModelName] = useState('');
    const [isSpeaking, setIsSpeaking] = useState(false); // model speaking
    const [isInterrupted, setIsInterrupted] = useState(false);
    const transcriptEndRef = useRef<HTMLDivElement>(null);
    // Biometric state tracking — send update only when stress level changes or every 30 s
    const lastBiometricSentRef = useRef<{ stress: string; ts: number }>({ stress: '', ts: 0 });

    // Scroll transcript to bottom on update
    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript]);

    // Forward biometric data to Gemini Live when stress level changes or every 30 s
    useEffect(() => {
        if (!biometricData || status !== 'live' || !wsRef.current) return;
        const ws = wsRef.current;
        if (ws.readyState !== WebSocket.OPEN) return;

        const now = Date.now();
        const prev = lastBiometricSentRef.current;
        const stressChanged = biometricData.stressLevel !== prev.stress;
        const intervalElapsed = now - prev.ts > 30_000;

        if (stressChanged || intervalElapsed) {
            lastBiometricSentRef.current = { stress: biometricData.stressLevel, ts: now };
            ws.send(JSON.stringify({ type: 'biometric_update', data: biometricData }));
        }
    }, [biometricData, status]);

    // ---------------------------------------------------------------------------
    // Start live session
    // ---------------------------------------------------------------------------

    const startLive = useCallback(async () => {
        setStatus('connecting');
        setErrorMsg('');
        setTranscript([]);

        // 1. Create AudioContext
        const audioCtx = new AudioContext({ sampleRate: 48000 });
        audioCtxRef.current = audioCtx;
        playChunkRef.current = createPcmPlayer(audioCtx);

        // 2. Load worklet
        try {
            await audioCtx.audioWorklet.addModule('/audio-capture-worklet.js');
        } catch (err) {
            setErrorMsg('Failed to load audio worklet: ' + err);
            setStatus('error');
            return;
        }

        // 3. Get microphone + camera
        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            streamRef.current = stream;
        } catch (_videoErr) {
            // Fallback: audio only if camera is unavailable
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                streamRef.current = stream;
            } catch (err) {
                setErrorMsg('Microphone permission denied: ' + err);
                setStatus('error');
                return;
            }
        }

        // Attach video stream to the hidden video element for frame capture
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
        }

        // 4. Connect mic → worklet
        const micSource = audioCtx.createMediaStreamSource(stream);
        const workletNode = new AudioWorkletNode(audioCtx, 'audio-capture-processor');
        workletNodeRef.current = workletNode;
        micSource.connect(workletNode);
        // workletNode is not connected to destination (we don't want echo)

        // 5. Open WebSocket
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'ws://localhost:8000';
        const wsUrl = `${backendUrl.replace(/^http/, 'ws')}/ws/live/${sessionId}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('[Live] WebSocket connected');
            // Wire worklet → WebSocket: send audio chunks
            workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
                if (ws.readyState !== WebSocket.OPEN) return;
                const b64 = arrayBufferToBase64(e.data);
                ws.send(JSON.stringify({ type: 'audio_chunk', data: b64 }));
            };
        };

        ws.onmessage = (e: MessageEvent<string>) => {
            const msg: LiveMessage = JSON.parse(e.data);
            handleServerMessage(msg);
        };

        ws.onerror = () => {
            setErrorMsg('WebSocket error – check backend is running.');
            setStatus('error');
        };

        ws.onclose = () => {
            console.log('[Live] WebSocket closed');
            if (status !== 'error') setStatus('idle');
        };
    }, [sessionId, status]);

    // ---------------------------------------------------------------------------
    // Handle messages from server
    // ---------------------------------------------------------------------------

    function handleServerMessage(msg: LiveMessage) {
        switch (msg.type) {
            case 'live_ready':
                setStatus('live');
                setModelName(msg.model || '');
                // Start sending video frames at ~1 fps
                startVideoFrames();
                break;

            case 'audio_chunk':
                if (msg.data && playChunkRef.current) {
                    setIsSpeaking(true);
                    setIsInterrupted(false);
                    const pcm16 = base64ToPcm16(msg.data);
                    playChunkRef.current(pcm16);
                }
                break;

            case 'transcript':
                if (msg.text && msg.role) {
                    setTranscript((prev) => {
                        // Merge consecutive same-role entries for readability
                        if (prev.length > 0 && prev[prev.length - 1].role === msg.role) {
                            return [
                                ...prev.slice(0, -1),
                                { role: msg.role!, text: prev[prev.length - 1].text + ' ' + msg.text },
                            ];
                        }
                        return [...prev, { role: msg.role!, text: msg.text! }];
                    });
                }
                break;

            case 'turn_complete':
                setIsSpeaking(false);
                break;

            case 'interrupted':
                setIsSpeaking(false);
                setIsInterrupted(true);
                break;

            case 'error':
                setErrorMsg(msg.message || 'Unknown error');
                setStatus('error');
                break;
        }
    }

    // ---------------------------------------------------------------------------
    // Video frame capture (1 fps → Gemini vision)
    // ---------------------------------------------------------------------------

    function startVideoFrames() {
        if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = setInterval(() => {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            const ws = wsRef.current;
            if (!video || !canvas || !ws || ws.readyState !== WebSocket.OPEN) return;
            if (video.readyState < 2) return; // not enough data yet

            // Draw current video frame onto canvas and extract JPEG
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            canvas.width = 640;
            canvas.height = 480;
            ctx.drawImage(video, 0, 0, 640, 480);
            const b64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
            ws.send(JSON.stringify({ type: 'video_frame', data: b64 }));
        }, 1000); // 1 fps
    }

    // ---------------------------------------------------------------------------
    // Stop
    // ---------------------------------------------------------------------------

    const stopLive = useCallback(() => {
        if (frameIntervalRef.current) {
            clearInterval(frameIntervalRef.current);
            frameIntervalRef.current = null;
        }

        wsRef.current?.send(JSON.stringify({ type: 'end_session' }));
        wsRef.current?.close();
        wsRef.current = null;

        workletNodeRef.current?.disconnect();
        workletNodeRef.current = null;

        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        if (videoRef.current) videoRef.current.srcObject = null;

        audioCtxRef.current?.close();
        audioCtxRef.current = null;
        playChunkRef.current = null;

        setStatus('idle');
        setIsSpeaking(false);
        onSessionEnd?.();
    }, [onSessionEnd]);

    // Cleanup on unmount
    useEffect(() => () => { stopLive(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            background: 'rgba(255,255,255,0.03)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '1.5rem',
            overflow: 'hidden',
        }}>
            {/* Hidden video + canvas for frame capture */}
            <video ref={videoRef} aria-hidden="true" style={{ display: 'none' }} muted playsInline />
            <canvas ref={canvasRef} aria-hidden="true" style={{ display: 'none' }} />

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.15)', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <span
                        role="status"
                        aria-label={
                            status === 'live' ? 'Session live' :
                            status === 'connecting' ? 'Connecting' :
                            status === 'error' ? 'Connection error' : 'Ready to start'
                        }
                        style={{
                            width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0,
                            background: status === 'live' ? '#4ADE80' : status === 'connecting' ? '#FBBF24' : status === 'error' ? '#F87171' : '#6B7280',
                            boxShadow: status === 'live' ? '0 0 6px #4ADE80' : status === 'connecting' ? '0 0 6px #FBBF24' : 'none',
                            animation: (status === 'live' || status === 'connecting') ? 'pulse 2s ease-in-out infinite' : 'none',
                        }}
                    />
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#E5E7EB', fontFamily: '"DM Sans","Inter",sans-serif' }}>
                        {status === 'live' ? `Live · ${modelName || 'Gemini'}` :
                         status === 'connecting' ? 'Connecting…' :
                         status === 'error' ? 'Error' : 'Ready'}
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    {isSpeaking && (
                        <span aria-live="polite" style={{ fontSize: '0.75rem', color: '#FBBF24', animation: 'pulse 1.5s ease-in-out infinite', fontWeight: 500 }}>AI speaking…</span>
                    )}
                    {isInterrupted && (
                        <span aria-live="polite" style={{ fontSize: '0.75rem', color: '#93C5FD', fontWeight: 500 }}>Interrupted</span>
                    )}
                    {status === 'live' ? (
                        <button
                            onClick={stopLive}
                            aria-label="Stop live session"
                            style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem', fontWeight: 700, borderRadius: '0.75rem', background: 'rgba(239,68,68,0.12)', color: '#F87171', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', transition: 'background 0.2s ease', minHeight: '36px', fontFamily: 'inherit' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.22)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; }}
                        >
                            Stop
                        </button>
                    ) : (
                        <button
                            onClick={startLive}
                            disabled={status === 'connecting'}
                            aria-label={status === 'connecting' ? 'Connecting to live session' : 'Start live session'}
                            style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem', fontWeight: 700, borderRadius: '0.75rem', background: status === 'connecting' ? 'rgba(251,191,36,0.1)' : 'linear-gradient(135deg, #FCD34D, #FBBF24)', color: status === 'connecting' ? '#FBBF24' : '#0a0a0a', border: '1px solid rgba(251,191,36,0.3)', cursor: status === 'connecting' ? 'wait' : 'pointer', opacity: status === 'connecting' ? 0.7 : 1, transition: 'all 0.2s ease', minHeight: '36px', fontFamily: 'inherit' }}
                        >
                            {status === 'connecting' ? 'Connecting…' : 'Start Live'}
                        </button>
                    )}
                </div>
            </div>

            {/* Error banner */}
            {status === 'error' && (
                <div role="alert" style={{ padding: '0.75rem 1.25rem', background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.2)', color: '#F87171', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    {errorMsg}
                </div>
            )}

            {/* Transcript */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }} aria-label="Conversation transcript" aria-live="polite">
                {transcript.length === 0 && status !== 'live' && (
                    <div style={{ textAlign: 'center', color: '#6B7280', fontSize: '0.875rem', marginTop: '2rem', padding: '0 1rem' }}>
                        <p style={{ marginBottom: '0.375rem', color: '#9CA3AF' }}>Press <strong style={{ color: '#FBBF24' }}>Start Live</strong> to begin.</p>
                        <p style={{ fontSize: '0.8125rem', color: '#6B7280', lineHeight: 1.6 }}>Speak naturally — Gemini Live API handles real-time audio and interruptions.</p>
                    </div>
                )}
                {transcript.map((entry, i) => (
                    <div
                        key={i}
                        style={{ display: 'flex', justifyContent: entry.role === 'user' ? 'flex-end' : 'flex-start' }}
                    >
                        <div style={{
                            maxWidth: '80%',
                            padding: '0.625rem 0.875rem',
                            borderRadius: entry.role === 'user' ? '1rem 1rem 0.25rem 1rem' : '1rem 1rem 1rem 0.25rem',
                            fontSize: '0.875rem',
                            background: entry.role === 'user' ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.05)',
                            border: entry.role === 'user' ? '1px solid rgba(251,191,36,0.2)' : '1px solid rgba(255,255,255,0.07)',
                            color: entry.role === 'user' ? '#FDE68A' : '#E5E7EB',
                        }}>
                            <span style={{ display: 'block', fontSize: '0.6875rem', marginBottom: '0.25rem', opacity: 0.6, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>
                                {entry.role === 'user' ? 'You' : 'Gemini'}
                            </span>
                            {entry.text}
                        </div>
                    </div>
                ))}
                <div ref={transcriptEndRef} />
            </div>

            {/* Status bar: camera pip + mic + biometrics */}
            {status === 'live' && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.2)', flexShrink: 0 }}>
                    {/* Camera preview */}
                    <div style={{ position: 'relative' }}>
                        <video
                            ref={(el) => {
                                if (el && streamRef.current) {
                                    el.srcObject = streamRef.current;
                                    el.play().catch(() => {});
                                }
                            }}
                            aria-label="Camera preview"
                            style={{ width: '100%', height: '96px', objectFit: 'cover', opacity: 0.8, display: 'block' }}
                            muted
                            playsInline
                        />
                        <div style={{ position: 'absolute', top: '0.375rem', left: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.375rem', background: 'rgba(0,0,0,0.65)', borderRadius: '0.5rem', padding: '0.25rem 0.5rem' }}>
                            <span aria-hidden="true" style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#F87171', animation: 'pulse 2s ease-in-out infinite', flexShrink: 0 }} />
                            <span style={{ fontSize: '0.6875rem', color: '#E5E7EB', fontWeight: 500 }}>Gemini sees you</span>
                        </div>
                        {biometricData && (
                            <div style={{ position: 'absolute', top: '0.375rem', right: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(0,0,0,0.65)', borderRadius: '0.5rem', padding: '0.25rem 0.5rem' }}>
                                <span style={{ fontSize: '0.6875rem', color: '#D1D5DB', fontWeight: 500 }}>{biometricData.heartRate.toFixed(0)} BPM</span>
                                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: biometricData.stressLevel === 'high' ? '#F87171' : biometricData.stressLevel === 'medium' ? '#FBBF24' : '#4ADE80', textTransform: 'capitalize' as const }}>
                                    {biometricData.stressLevel}
                                </span>
                            </div>
                        )}
                    </div>
                    <div style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span aria-hidden="true" style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#F87171', animation: 'pulse 2s ease-in-out infinite', flexShrink: 0 }} />
                        <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>Mic + camera active — speak anytime, interrupt freely</span>
                    </div>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToPcm16(b64: string): Int16Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer);
}

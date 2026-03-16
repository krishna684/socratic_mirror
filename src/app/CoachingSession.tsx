'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CoachingMode, BiometricData, VibeReport as VibeReportType } from '@/types';
import BiometricMonitor from '@/components/BiometricMonitor';
import dynamic from 'next/dynamic';
const AvatarScene = dynamic(() => import('@/components/AvatarScene'), { ssr: false });
import AudioProcessor, { AudioEvent } from '@/components/AudioProcessor';
import { speakWithVisemes, stopCurrentTTS } from '@/lib/ttsPlayer';
import { usePermissions, type PermissionChoice } from '@/context/PermissionContext';
import NavBar from '@/components/NavBar';
import SessionControls from '@/components/SessionControls';
import Whiteboard, { WhiteboardStep } from '@/components/Whiteboard';
import VibeReport from '@/components/VibeReport';

interface CoachingSessionProps {
    mode: string;
    sessionId: string;
    onExit: () => void;
}

const styles = {
    container: {
        minHeight: '100dvh',
        height: '100dvh',
        background: 'radial-gradient(ellipse 90% 50% at 50% -5%, rgba(251,191,36,0.04) 0%, transparent 55%), linear-gradient(180deg, #070707 0%, #050506 100%)',
        color: '#F3F4F6',
        display: 'flex',
        flexDirection: 'column' as const,
        overflow: 'hidden',
        fontFamily: '"Inter", -apple-system, sans-serif',
    },
    header: {
        background: 'rgba(5, 5, 6, 0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
        padding: '0.875rem 1.5rem',
        flexShrink: 0,
    },
    headerContent: {
        maxWidth: '1800px',
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
    },
    sessionInfo: {
        display: 'flex',
        alignItems: 'center',
        gap: '1.25rem',
        flexWrap: 'wrap' as const,
        minWidth: 0,
    },
    modeBadge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.3rem 0.875rem',
        background: 'rgba(251, 191, 36, 0.1)',
        border: '1px solid rgba(251, 191, 36, 0.22)',
        borderRadius: '9999px',
        fontSize: '0.8125rem',
        fontWeight: 600,
        color: '#FBBF24',
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap' as const,
    },
    modeTitle: {
        fontSize: '1.125rem',
        fontWeight: 700,
        margin: 0,
        fontFamily: '"DM Sans", "Inter", sans-serif',
        background: 'linear-gradient(135deg, #FCD34D, #FBBF24)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        letterSpacing: '-0.01em',
    },
    metrics: {
        display: 'flex',
        gap: '1rem',
        paddingLeft: '1rem',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
        flexWrap: 'wrap' as const,
    },
    metric: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '0.1rem',
    },
    metricLabel: {
        fontSize: '0.6875rem',
        color: '#6B7280',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.06em',
        fontWeight: 600,
    },
    metricValue: {
        fontSize: '0.9375rem',
        fontWeight: 700,
        color: '#F3F4F6',
        lineHeight: 1.2,
    },
    endButton: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.5rem 1.125rem',
        background: 'rgba(239, 68, 68, 0.1)',
        color: '#F87171',
        border: '1px solid rgba(239, 68, 68, 0.25)',
        borderRadius: '0.75rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        fontSize: '0.8125rem',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap' as const,
        minHeight: '44px',
        flexShrink: 0,
    },
    main: {
        flex: 1,
        maxWidth: '1800px',
        width: '100%',
        margin: '0 auto',
        padding: '1.25rem 1.5rem',
        display: 'grid',
        gridTemplateColumns: 'minmax(300px, 1fr) 2fr minmax(300px, 1fr)',
        gap: '1.25rem',
        alignItems: 'stretch',
        overflow: 'hidden',
    },
    leftColumn: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '1rem',
        height: '100%',
        overflow: 'hidden',
    },
    centerColumn: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'stretch',
    },
    rightColumn: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '1rem',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
    },
    avatarContainer: {
        background: 'rgba(255, 255, 255, 0.025)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.07)',
        borderRadius: '1.5rem',
        padding: '1.25rem',
        flex: 1,
        height: '100%',
        position: 'relative' as const,
        display: 'flex',
        flexDirection: 'column' as const,
        transition: 'border-color 0.3s ease',
    },
};

type SessionState = 'IDLE' | 'THINK' | 'SPEAK' | 'LISTEN';
type AvatarExpression = 'neutral' | 'happy' | 'thinking' | 'concerned' | 'excited';
type AvatarGesture = 'idle' | 'greeting' | 'explaining' | 'pointing';
type NarrationItem =
    | { kind: 'audio'; audio: { mime_type: string; data: string } }
    | { kind: 'text'; text: string };

export default function CoachingSession({ mode, sessionId, onExit }: CoachingSessionProps) {
    const [gameState, setGameState] = useState<'setup' | 'permissions' | 'active' | 'report'>('setup');
    const [setupInfo, setSetupInfo] = useState('');
    const [interviewJobDescription, setInterviewJobDescription] = useState('');
    const [interviewResumeText, setInterviewResumeText] = useState('');
    const [interviewResumeName, setInterviewResumeName] = useState('');
    const [speakingType, setSpeakingType] = useState('');
    const [speakingTopic, setSpeakingTopic] = useState('');
    const [speakingScriptText, setSpeakingScriptText] = useState('');
    const [speakingScriptName, setSpeakingScriptName] = useState('');
    const [isSessionActive, setIsSessionActive] = useState(true);
    const [biometricData, setBiometricData] = useState<BiometricData | null>(null);
    const [sessionState, setSessionState] = useState<SessionState>('IDLE');
    const [avatarState, setAvatarState] = useState<{ expression: AvatarExpression; gesture: AvatarGesture; isSpeaking: boolean }>({
        expression: 'neutral',
        gesture: 'idle',
        isSpeaking: false,
    });
    const [whiteboardSteps, setWhiteboardSteps] = useState<WhiteboardStep[]>([]);
    const [archivedTopics, setArchivedTopics] = useState<{ id: string, steps: WhiteboardStep[] }[]>([]);
    const [currentStepId, setCurrentStepId] = useState<number>(0);
    const [isPaused, setIsPaused] = useState(false);
    const [thinkingState, setThinkingState] = useState<'idle' | 'logic' | 'check_in'>('idle');
    const [checkInOptions, setCheckInOptions] = useState<string[]>([]);
    const [showReport, setShowReport] = useState(false);
    const [ws, setWs] = useState<WebSocket | null>(null);
    const [quickInput, setQuickInput] = useState('');
    const [finalReport, setFinalReport] = useState<VibeReportType | null>(null);
    const [voiceInputError, setVoiceInputError] = useState<string | null>(null);
    const [wsReconnectNonce, setWsReconnectNonce] = useState(0);
    const [isEnding, setIsEnding] = useState(false);

    const hasSentInitialRef = useRef(false);
    const narrationQueueRef = useRef<NarrationItem[]>([]);
    const isProcessingQueueRef = useRef(false);
    const whiteboardStepCounterRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptRef = useRef(0);
    const isEndingSessionRef = useRef(false);

    const { mic, camera, requestMic, requestCamera, skipMic, skipCamera, hasDecidedMic, hasDecidedCamera } = usePermissions();
    const micEnabled = mic === 'granted';
    const cameraEnabled = camera === 'granted';
    const [showPermSettings, setShowPermSettings] = useState(false);

    const allowFallbackTts = false;
    const baseTurnConfig = { silenceMsToCommit: 800, idleResultCommitMs: 800, minUtteranceChars: 5 };
    const turnConfig = mode === 'interview'
        ? { silenceMsToCommit: 1000, idleResultCommitMs: 1000, minUtteranceChars: 6 }
        : baseTurnConfig;
    const startButtonLabel =
        mode === 'tutoring'
            ? 'Start Tutoring'
            : mode === 'public_speaking'
                ? 'Start Speaking'
                : mode === 'interview'
                    ? 'Start Interview'
                    : 'Start Coaching';

    const sendWsJson = (payload: any, opts?: { setThink?: boolean; failMessage?: string; silentFailure?: boolean }) => {
        const failMessage = opts?.failMessage || 'Connection issue: could not send your message to AI.';
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn(failMessage, payload);
            if (!opts?.silentFailure) setVoiceInputError(failMessage);
            if (opts?.setThink) setSessionState('LISTEN');
            return false;
        }

        try {
            if (opts?.setThink) setSessionState('THINK');
            ws.send(JSON.stringify(payload));
            if (!opts?.silentFailure) setVoiceInputError(null);
            return true;
        } catch (error) {
            console.error('WebSocket send failed:', error);
            if (!opts?.silentFailure) setVoiceInputError(failMessage);
            if (opts?.setThink) setSessionState('LISTEN');
            return false;
        }
    };



    const enqueueNarrationItem = (item: NarrationItem): boolean => {
        if (!item) return false;
        narrationQueueRef.current.push(item);
        if (!isProcessingQueueRef.current) {
            processNarrationQueue();
        } else {
            setTimeout(() => processNarrationQueue(), 0);
        }
        return true;
    };

    const enqueueNarrationFromMessage = (message: any): boolean => {
        const text = message?.narration || message?.voice_text || message?.text;
        if (text) {
            return enqueueNarrationItem({ kind: 'text', text: String(text) });
        }
        return false;
    };




    // Initial message based on mode
    useEffect(() => {
        if (gameState === 'active' && ws && ws.readyState === WebSocket.OPEN && !hasSentInitialRef.current) {
            hasSentInitialRef.current = true;
            const initialMsg = mode === 'tutoring'
                ? `I want to learn about: ${setupInfo}. DO NOT greet me. Immediately start lesson Step 1 by explaining the core concept on the whiteboard.`
                : mode === 'interview'
                    ? `BEGIN_INTERVIEW::${JSON.stringify({
                        job_description: interviewJobDescription,
                        resume: interviewResumeText,
                    })}`
                    : `BEGIN_PUBLIC_SPEAKING::${JSON.stringify({
                        speaking_type: speakingType,
                        topic: speakingTopic,
                        script: speakingScriptText,
                    })}`;

            sendWsJson({
                type: 'user_speech',
                transcript: initialMsg,
            }, { setThink: true, failMessage: 'Could not send initial message to AI.' });
        }
    }, [
        gameState,
        ws,
        mode,
        setupInfo,
        interviewJobDescription,
        interviewResumeText,
        speakingType,
        speakingTopic,
        speakingScriptText,
    ]);

    useEffect(() => {
        if (!sessionId || !isSessionActive) return;
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }

        let shouldReconnect = true;

        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'ws://localhost:8000';
        const websocket = new WebSocket(`${backendUrl.replace('http', 'ws')}/ws/coach/${sessionId}`);

        websocket.onopen = () => {
            console.log('WebSocket connected');
            reconnectAttemptRef.current = 0;
            setVoiceInputError(null);
        };

        websocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (error) {
                console.error('Invalid WS message payload:', event.data, error);
                setVoiceInputError('Received invalid response from server.');
            }
        };

        websocket.onerror = (error) => {
            console.error('WebSocket error:', error);
            setVoiceInputError('Realtime connection error. Try again or use text input.');
        };

        websocket.onclose = () => {
            console.log('WebSocket disconnected');
            setWs(current => (current === websocket ? null : current));
            if (shouldReconnect && isSessionActive && !isEndingSessionRef.current) {
                reconnectAttemptRef.current += 1;
                const retryDelayMs = Math.min(5000, 500 * Math.pow(2, Math.min(reconnectAttemptRef.current, 4)));
                setVoiceInputError(`Connection lost. Reconnecting in ${(retryDelayMs / 1000).toFixed(1)}s...`);
                setSessionState('LISTEN');
                reconnectTimerRef.current = setTimeout(() => {
                    setWsReconnectNonce(prev => prev + 1);
                }, retryDelayMs);
            }
        };

        setWs(websocket);

        return () => {
            shouldReconnect = false;
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            websocket.close();
        };
    }, [sessionId, isSessionActive, wsReconnectNonce]);

    const normalizeExpression = (expression?: string): AvatarExpression => {
        const value = (expression || '').toLowerCase();
        if (value.includes('concern')) return 'concerned';
        if (value.includes('think') || value.includes('skeptical')) return 'thinking';
        if (value.includes('happy') || value.includes('encouraging')) return 'happy';
        if (value.includes('excited')) return 'excited';
        return 'neutral';
    };

    const normalizeGesture = (gesture?: string): AvatarGesture => {
        const value = (gesture || '').toLowerCase();
        if (value.includes('point')) return 'pointing';
        if (value.includes('greet')) return 'greeting';
        if (value.includes('explain')) return 'explaining';
        return 'idle';
    };

    const allocateWhiteboardStepId = (preferred?: number): number => {
        if (
            typeof preferred === 'number' &&
            Number.isFinite(preferred) &&
            preferred > whiteboardStepCounterRef.current
        ) {
            whiteboardStepCounterRef.current = preferred;
            return preferred;
        }

        whiteboardStepCounterRef.current += 1;
        return whiteboardStepCounterRef.current;
    };

    const applyAvatarFromMessage = (message: any, fallbackGesture: AvatarGesture = 'idle') => {
        const avatar = message?.avatar_intent || message?.avatar_state || {};
        setAvatarState(prev => ({
            ...prev,
            expression: normalizeExpression(avatar?.expression),
            gesture: avatar?.gesture ? normalizeGesture(avatar.gesture) : fallbackGesture,
        }));
    };

    const pushFeedbackStep = (content?: any) => {
        if (content === undefined || content === null) return;
        const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        if (!text.trim()) return;
        const feedbackStepId = allocateWhiteboardStepId();

        setWhiteboardSteps(prev => [
            ...prev,
            {
                id: feedbackStepId,
                subtopic_id: 'feedback',
                narration: text,
                visual: { type: 'none', content: null },
            },
        ]);
        setCurrentStepId(feedbackStepId);
    };

    const processNarrationQueue = async () => {
        if (isProcessingQueueRef.current || isPaused || narrationQueueRef.current.length === 0) return;

        isProcessingQueueRef.current = true;
        const item = narrationQueueRef.current.shift();

        if (!item) {
            isProcessingQueueRef.current = false;
            setSessionState('LISTEN');
            return;
        }

        if (item.kind === 'text') {
            await speakWithVisemes(
                item.text,
                () => setAvatarState(prev => ({ ...prev, isSpeaking: true })),
                () => setAvatarState(prev => ({ ...prev, isSpeaking: false })),
            );
        }

        isProcessingQueueRef.current = false;
        if (narrationQueueRef.current.length === 0) {
            setSessionState('LISTEN');
        } else {
            processNarrationQueue();
        }
    };

    const handleWebSocketMessage = (message: any) => {
        console.log('WS Message:', message.kind || message.type, message);
        setThinkingState('idle');

        const messageKind = message.kind || message.type || ((message.narration || message.voice_text || message.text) ? 'coach_response' : 'unknown');

        switch (messageKind) {

            case 'connected':
                setSessionState(prev => (prev === 'THINK' ? 'THINK' : 'LISTEN'));
                break;

            case 'step':
                setSessionState('SPEAK');
                setCheckInOptions([]);
                applyAvatarFromMessage(message, 'explaining');

                const stepId = allocateWhiteboardStepId(
                    typeof message.step === 'number' ? message.step : undefined
                );
                const newStep: WhiteboardStep = {
                    id: stepId,
                    subtopic_id: message.subtopic_id,
                    narration: message.narration,
                    visual: message.visual || { type: 'none' },
                };

                setWhiteboardSteps(prev => [...prev, newStep]);
                setCurrentStepId(stepId);
                if (!enqueueNarrationFromMessage(message)) {
                    setSessionState('LISTEN');
                }
                break;

            case 'meta':
                if (message.action === 'clear_whiteboard') {
                    setWhiteboardSteps(prev => {
                        if (prev.length > 0) {
                            const subtopic = prev[0].subtopic_id || 'Previous Topic';
                            setArchivedTopics(arch => [...arch, { id: subtopic, steps: prev }]);
                        }
                        return [];
                    });
                }
                break;

            case 'check_in':
                applyAvatarFromMessage(message, 'idle');
                setCheckInOptions(message.options || []);
                setSessionState('SPEAK');
                if (!enqueueNarrationFromMessage(message)) {
                    setSessionState('LISTEN');
                }
                break;

            case 'barge_in':
                setSessionState('SPEAK');
                applyAvatarFromMessage(message, 'pointing');
                if (!enqueueNarrationFromMessage(message)) {
                    setSessionState('LISTEN');
                }
                pushFeedbackStep(message.visual_content || message.text);
                break;

            case 'error':
                setSessionState('SPEAK');
                applyAvatarFromMessage(message, 'idle');
                if (!enqueueNarrationFromMessage(message)) {
                    setSessionState('LISTEN');
                }
                if (message.visual_content || message.message) pushFeedbackStep(message.visual_content || message.message);
                break;

            case 'coach_response':
                setSessionState('SPEAK');
                applyAvatarFromMessage(message, 'idle');
                if (!enqueueNarrationFromMessage(message)) {
                    setSessionState('LISTEN');
                }
                if (message.visual_content) pushFeedbackStep(message.visual_content);
                break;

            case 'session_started':
                console.log('Session started successfully');
                setSessionState('LISTEN');
                break;

            case 'session_ended':
                isEndingSessionRef.current = false;
                setIsEnding(false);
                if (message.report) {
                    setFinalReport(message.report);
                }
                setIsSessionActive(false);
                setShowReport(true);
                setGameState('report');
                break;
        }
    };

    const handleBiometricUpdate = (data: BiometricData) => {
        setBiometricData(data);
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        sendWsJson({
            type: 'biometric_data',
            data: {
                heart_rate: data.heartRate,
                stress_level: data.stressLevel,
                gaze_direction: data.gazeDirection,
                posture_score: data.postureScore,
                confidence_level: data.confidenceLevel,
                timestamp: data.timestamp,
            },
        }, { silentFailure: true });
    };



    const handleAudioEvent = (event: AudioEvent) => {
        if (!isSessionActive || isPaused) return;

        // Barge-in: Stop AI speaking if user starts talking
        if (event.kind === 'activity' && event.isSpeaking && sessionState === 'SPEAK') {
            stopCurrentTTS();
            narrationQueueRef.current = [];
            setAvatarState(prev => ({ ...prev, isSpeaking: false }));
            isProcessingQueueRef.current = false;
            setSessionState('LISTEN');
        }

        switch (event.kind) {
            case 'activity':
                setThinkingState(event.isSpeaking ? 'logic' : 'idle');
                break;
            case 'utterance':
                console.log('Sending user speech:', event.text);
                sendWsJson(
                    {
                        type: 'user_speech',
                        transcript: event.text,
                    },
                    { setThink: true, failMessage: 'Voice captured, but failed to send to AI.' }
                );
                break;
            case 'error':
                console.error('AudioProcessor Error:', event.message);
                setVoiceInputError(event.message);
                setSessionState('LISTEN');
                break;
        }
    };

    const handleInterrupt = () => {
        stopCurrentTTS();
        narrationQueueRef.current = [];
        setAvatarState(prev => ({ ...prev, isSpeaking: false }));
        isProcessingQueueRef.current = false;
        setSessionState('LISTEN');
    };

    const handleEndSession = async () => {
        isEndingSessionRef.current = true;
        setIsEnding(true);
        setGameState('report');
        setShowReport(true);
        stopCurrentTTS();
        narrationQueueRef.current = [];
        if (sendWsJson({ type: 'end_session' }, { failMessage: 'Could not notify server to end session.' })) {
            // WS send worked, wait for session_ended message
            return;
        }

        // Fallback if WS fails
        try {
            await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/session/end/${sessionId}`, {
                method: 'POST',
            });
        } catch (err) {
            console.error('Error ending session:', err);
        }

        setIsEnding(false);
        setIsSessionActive(false);
        setGameState('report');
        setShowReport(true);
    };

    const prewarmTts = () => {
        // No-op: Google Cloud TTS does not require a browser prewarm.
    };

    const handleStartSession = () => {
        if (mode === 'tutoring' && !setupInfo) {
            alert('Please enter a topic you want to learn.');
            return;
        }
        if (mode === 'interview' && !interviewJobDescription.trim()) {
            alert('Please paste a job description.');
            return;
        }
        if (mode === 'public_speaking') {
            if (!speakingType) {
                alert('Please select a practice type.');
                return;
            }
            if (!speakingTopic.trim()) {
                alert('Please enter a topic.');
                return;
            }
        }
        isEndingSessionRef.current = false;
        setVoiceInputError(null);
        // Skip the permission dialog if the user has already made their choices
        if (hasDecidedMic && hasDecidedCamera) {
            setGameState('active');
        } else {
            setGameState('permissions');
        }
    };

    const handleQuickSend = () => {
        const text = quickInput.trim();
        if (!text) return;
        setQuickInput('');
        sendWsJson(
            { type: 'user_speech', transcript: text },
            { setThink: true, failMessage: 'Could not send typed message to AI.' }
        );
    };

    const canSendQuick = quickInput.trim().length > 0 && ws?.readyState === WebSocket.OPEN;

    if (showReport && !finalReport) {
        return (
            <div style={styles.container}>
                <div style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    gap: '1rem',
                }}>
                    <div style={{
                        width: '52px',
                        height: '52px',
                        borderRadius: '50%',
                        border: '3px solid rgba(255, 255, 255, 0.12)',
                        borderTopColor: '#FBBF24',
                        animation: 'spin 1s linear infinite',
                    }} />
                    <div style={{ color: '#E5E7EB', fontSize: '1rem' }}>Generating your report...</div>
                    <div style={{ color: '#9CA3AF', fontSize: '0.85rem' }}>This usually takes a few seconds.</div>
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    if (showReport) {
        return (
            <div style={styles.container}>
                <VibeReport
                    sessionId={sessionId}
                    onClose={onExit}
                    initialReport={finalReport}
                    whiteboardExport={{
                        mode,
                        activeSteps: whiteboardSteps,
                        archivedTopics,
                        currentStepId,
                    }}
                />
            </div>
        );
    }

    return (
        <div style={styles.container}>
            {/* Header */}
            <header style={styles.header} role="banner">
                <div style={styles.headerContent}>
                    <div style={styles.sessionInfo}>
                        {/* Mode badge */}
                        <div style={styles.modeBadge} aria-label={`Session mode: ${mode.replace('_', ' ')}`}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                            </svg>
                            <span>Live Session</span>
                        </div>
                        <h1 style={styles.modeTitle}>
                            {mode === 'tutoring' && 'Socratic Tutoring'}
                            {mode === 'public_speaking' && 'Public Speaking'}
                            {mode === 'interview' && 'Interview Mastery'}
                        </h1>
                        {biometricData && (
                            <div style={styles.metrics} aria-label="Live biometrics">
                                <div style={styles.metric}>
                                    <span style={styles.metricLabel}>Heart Rate</span>
                                    <span style={styles.metricValue}>
                                        {biometricData.heartRate.toFixed(0)}&thinsp;<span style={{ fontSize: '0.75rem', color: '#9CA3AF', fontWeight: 500 }}>BPM</span>
                                    </span>
                                </div>
                                <div style={styles.metric}>
                                    <span style={styles.metricLabel}>Stress</span>
                                    <span style={{
                                        ...styles.metricValue,
                                        color: biometricData.stressLevel === 'low' ? '#4ADE80' :
                                            biometricData.stressLevel === 'medium' ? '#FBBF24' : '#F87171',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.35rem',
                                    }}>
                                        <span style={{
                                            width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                                            background: biometricData.stressLevel === 'low' ? '#4ADE80' :
                                                biometricData.stressLevel === 'medium' ? '#FBBF24' : '#F87171',
                                        }} aria-hidden="true" />
                                        <span style={{ textTransform: 'capitalize' }}>{biometricData.stressLevel}</span>
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {/* Permissions settings gear */}
                        <button
                            onClick={() => setShowPermSettings(v => !v)}
                            aria-label="Permissions settings"
                            aria-expanded={showPermSettings}
                            style={{
                                width: '36px', height: '36px', borderRadius: '0.625rem',
                                border: '1px solid rgba(255,255,255,0.08)',
                                background: showPermSettings ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.04)',
                                color: showPermSettings ? '#FBBF24' : '#6B7280',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => { if (!showPermSettings) { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#9CA3AF'; } }}
                            onMouseLeave={e => { if (!showPermSettings) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#6B7280'; } }}
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="3" />
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                            </svg>
                        </button>
                        <button
                            onClick={handleEndSession}
                            style={styles.endButton}
                            aria-label="End coaching session"
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.45)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.25)'; }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                <path d="M18.36 6.64A9 9 0 1 1 5.64 19.36" />
                                <polyline points="9 10 4 10 4 15" />
                            </svg>
                            End Session
                        </button>
                    </div>
                </div>
            </header>

            {/* Permissions mini-panel for in-session settings */}
            {showPermSettings && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Permissions settings"
                    style={{
                        position: 'absolute', top: '70px', right: '1rem',
                        width: 'min(340px, calc(100% - 2rem))',
                        background: 'rgba(14,14,16,0.97)',
                        backdropFilter: 'blur(24px)',
                        WebkitBackdropFilter: 'blur(24px)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '1.25rem',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
                        zIndex: 150,
                        padding: '1rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem',
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#F3F4F6', fontFamily: '"DM Sans","Inter",sans-serif' }}>
                            Permissions
                        </span>
                        <button
                            onClick={() => setShowPermSettings(false)}
                            aria-label="Close"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6B7280', display: 'flex', alignItems: 'center' }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                        </button>
                    </div>
                    <InlinePermRow label="Microphone" status={mic} onAllow={requestMic} onSkip={skipMic} />
                    <InlinePermRow label="Camera" status={camera} onAllow={requestCamera} onSkip={skipCamera} />
                </div>
            )}

            {/* Layout */}
            {gameState === 'active' && (
                <main style={styles.main}>
                    <div style={styles.leftColumn}>
                        <div style={{ flex: '1', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', paddingRight: '0.25rem' }}>
                            {cameraEnabled ? (
                                <BiometricMonitor onBiometricUpdate={handleBiometricUpdate} />
                            ) : (
                                <div style={{
                                    background: 'rgba(255,255,255,0.025)',
                                    border: '1px solid rgba(255,255,255,0.07)',
                                    borderRadius: '1.25rem',
                                    padding: '1rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.75rem',
                                }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '0.75rem', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-hidden="true">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#9CA3AF' }}>Camera Disabled</div>
                                        <button
                                            onClick={requestCamera}
                                            style={{ background: 'none', border: 'none', color: '#FBBF24', fontSize: '0.75rem', cursor: 'pointer', padding: '0', fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px' }}
                                        >
                                            Enable camera
                                        </button>
                                    </div>
                                </div>
                            )}
                            <div style={{ background: 'rgba(255,255,255,0.025)', borderRadius: '1.25rem', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        onClick={handleInterrupt}
                                        disabled={sessionState === 'LISTEN' || sessionState === 'THINK'}
                                        aria-label="Interrupt AI and ask a question"
                                        style={{
                                            flex: 1, padding: '0.7rem 1rem', borderRadius: '0.75rem',
                                            border: '1px solid rgba(251, 191, 36, 0.25)',
                                            background: 'rgba(251, 191, 36, 0.08)',
                                            color: '#FBBF24', fontWeight: 600, cursor: 'pointer',
                                            fontSize: '0.875rem', fontFamily: 'inherit',
                                            transition: 'background 0.2s, border-color 0.2s',
                                            opacity: (sessionState === 'LISTEN' || sessionState === 'THINK') ? 0.4 : 1,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                            minHeight: '44px',
                                        }}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
                                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                        </svg>
                                        Interrupt / Ask
                                    </button>
                                </div>

                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        onClick={() => {
                                            if (isPaused) {
                                                setIsPaused(false);
                                                processNarrationQueue();
                                            } else {
                                                setIsPaused(true);
                                                stopCurrentTTS();
                                            }
                                        }}
                                        aria-label={isPaused ? 'Resume coaching' : 'Pause coaching'}
                                        style={{
                                            flex: 1, padding: '0.7rem 1rem', borderRadius: '0.75rem',
                                            border: isPaused ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(255,255,255,0.08)',
                                            background: isPaused ? 'rgba(74, 222, 128, 0.1)' : 'rgba(255,255,255,0.04)',
                                            color: isPaused ? '#4ADE80' : '#D1D5DB',
                                            fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'inherit',
                                            transition: 'all 0.2s ease',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                            minHeight: '44px',
                                        }}
                                    >
                                        {isPaused ? (
                                            <>
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                                                Resume
                                            </>
                                        ) : (
                                            <>
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="6" y1="4" x2="6" y2="20" /><line x1="18" y1="4" x2="18" y2="20" /></svg>
                                                Pause
                                            </>
                                        )}
                                    </button>
                                </div>

                                {checkInOptions.length > 0 && sessionState === 'LISTEN' && (
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }} role="group" aria-label="Check-in options">
                                        {checkInOptions.map(opt => (
                                            <button
                                                key={opt}
                                                onClick={() => {
                                                    setThinkingState('check_in');
                                                    sendWsJson(
                                                        { type: 'user_speech', transcript: opt.replace('_', ' ') },
                                                        { setThink: true, failMessage: 'Failed to send check-in response.' }
                                                    );
                                                    setCheckInOptions([]);
                                                }}
                                                style={{
                                                    padding: '0.4rem 0.875rem', borderRadius: '9999px',
                                                    border: '1px solid rgba(251, 191, 36, 0.25)',
                                                    background: 'rgba(251, 191, 36, 0.08)',
                                                    color: '#FBBF24', fontSize: '0.8125rem', cursor: 'pointer',
                                                    fontFamily: 'inherit', fontWeight: 500,
                                                    transition: 'background 0.15s ease',
                                                    minHeight: '36px',
                                                }}
                                            >
                                                {opt.replace('_', ' ')}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {voiceInputError && (
                                    <div style={{
                                        padding: '0.65rem 0.8rem',
                                        borderRadius: '0.7rem',
                                        background: 'rgba(239, 68, 68, 0.14)',
                                        border: '1px solid rgba(239, 68, 68, 0.35)',
                                        color: '#FCA5A5',
                                        fontSize: '0.82rem',
                                        lineHeight: 1.35
                                    }}>
                                        {voiceInputError}
                                    </div>
                                )}

                                {micEnabled ? (
                                    <AudioProcessor
                                        onAudioEvent={handleAudioEvent}
                                        isActive={isSessionActive && !isPaused && sessionState === 'LISTEN'}
                                        isAiSpeaking={avatarState.isSpeaking}
                                        {...turnConfig}
                                    />
                                ) : (
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: '0.625rem',
                                        padding: '0.625rem 0.75rem',
                                        background: 'rgba(251,191,36,0.05)',
                                        border: '1px solid rgba(251,191,36,0.15)',
                                        borderRadius: '0.75rem',
                                    }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                                        <span style={{ fontSize: '0.8125rem', color: '#D1D5DB', flex: 1 }}>Text Input Mode</span>
                                        <button
                                            onClick={requestMic}
                                            style={{ background: 'none', border: 'none', color: '#FBBF24', fontSize: '0.75rem', cursor: 'pointer', padding: '0', fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px', whiteSpace: 'nowrap' }}
                                        >
                                            Enable mic
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div style={styles.centerColumn}>
                        <div style={{ ...styles.avatarContainer, cursor: (sessionState === 'SPEAK' || sessionState === 'THINK') ? 'pointer' : 'default' }} onClick={() => (sessionState === 'SPEAK' || sessionState === 'THINK') && handleInterrupt()}>

                            <AvatarScene
                                expression={avatarState.expression}
                                gesture={avatarState.gesture}
                                isSpeaking={avatarState.isSpeaking}

                            />
                            {/* Listening badge */}
                            {sessionState === 'LISTEN' && (
                                <div
                                    role="status"
                                    aria-label="Listening for your voice"
                                    style={{
                                        position: 'absolute', top: '1.25rem', right: '1.25rem',
                                        padding: '0.35rem 0.875rem', borderRadius: '9999px',
                                        background: 'rgba(74, 222, 128, 0.12)',
                                        border: '1px solid rgba(74, 222, 128, 0.35)',
                                        color: '#4ADE80', fontSize: '0.71875rem', fontWeight: 700,
                                        display: 'flex', alignItems: 'center', gap: '0.4rem', zIndex: 10,
                                        letterSpacing: '0.06em', textTransform: 'uppercase',
                                        backdropFilter: 'blur(8px)',
                                    }}>
                                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ADE80', animation: 'pulse 1.4s ease-in-out infinite', flexShrink: 0 }} aria-hidden="true" />
                                    Listening
                                </div>
                            )}
                            {/* Speaking badge */}
                            {sessionState === 'SPEAK' && avatarState.isSpeaking && (
                                <div
                                    role="status"
                                    aria-label="AI is speaking"
                                    style={{
                                        position: 'absolute', top: '1.25rem', right: '1.25rem',
                                        padding: '0.35rem 0.875rem', borderRadius: '9999px',
                                        background: 'rgba(251, 191, 36, 0.12)',
                                        border: '1px solid rgba(251, 191, 36, 0.3)',
                                        color: '#FBBF24', fontSize: '0.71875rem', fontWeight: 700,
                                        display: 'flex', alignItems: 'center', gap: '0.4rem', zIndex: 10,
                                        letterSpacing: '0.06em', textTransform: 'uppercase',
                                        backdropFilter: 'blur(8px)',
                                    }}>
                                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#FBBF24', animation: 'pulse 0.9s ease-in-out infinite', flexShrink: 0 }} aria-hidden="true" />
                                    Speaking
                                </div>
                            )}
                            {/* Thinking badge */}
                            {(thinkingState !== 'idle' || sessionState === 'THINK') && (
                                <div
                                    role="status"
                                    aria-label="AI is processing"
                                    style={{
                                        position: 'absolute', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)',
                                        padding: '0.45rem 1.25rem', borderRadius: '9999px',
                                        background: 'rgba(5, 5, 6, 0.75)',
                                        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                                        border: '1px solid rgba(251, 191, 36, 0.25)',
                                        display: 'flex', alignItems: 'center', gap: '0.6rem', zIndex: 10,
                                        whiteSpace: 'nowrap',
                                    }}>
                                    <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }} aria-hidden="true">
                                        {[0, 0.15, 0.3].map(delay => (
                                            <div key={delay} style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#FBBF24', animation: `pulse 1.2s ease-in-out ${delay}s infinite` }} />
                                        ))}
                                    </div>
                                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#FBBF24', letterSpacing: '0.04em' }}>
                                        {thinkingState === 'logic' ? 'Thinking…' : 'Processing…'}
                                    </span>
                                </div>
                            )}
                        </div>
                        <div style={{
                            marginTop: '0.875rem',
                            background: 'rgba(255,255,255,0.025)',
                            borderRadius: '1.125rem',
                            padding: '0.625rem 0.625rem 0.625rem 0.875rem',
                            border: '1px solid rgba(255,255,255,0.07)',
                            backdropFilter: 'blur(20px)',
                            display: 'flex',
                            alignItems: 'flex-end',
                            gap: '0.5rem',
                        }}>
                            <label htmlFor="quick-input" style={{ position: 'absolute', left: '-9999px' }}>
                                Type a message
                            </label>
                            <textarea
                                id="quick-input"
                                value={quickInput}
                                onChange={(e) => setQuickInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        if (canSendQuick) handleQuickSend();
                                    }
                                }}
                                placeholder={
                                    mode === 'tutoring'
                                        ? 'Ask or answer here… (Enter to send)'
                                        : mode === 'interview'
                                            ? 'Type your answer… (Enter to send)'
                                            : 'Type your response… (Enter to send)'
                                }
                                rows={2}
                                style={{
                                    flex: 1, padding: '0.5rem 0',
                                    background: 'transparent',
                                    border: 'none', outline: 'none',
                                    color: '#F3F4F6', fontSize: '0.9375rem', resize: 'none', lineHeight: 1.5,
                                    fontFamily: 'inherit',
                                }}
                            />
                            <button
                                onClick={handleQuickSend}
                                disabled={!canSendQuick}
                                aria-label="Send message"
                                style={{
                                    width: '44px', height: '44px', borderRadius: '0.875rem', flexShrink: 0,
                                    border: '1px solid',
                                    borderColor: canSendQuick ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.08)',
                                    background: canSendQuick ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.04)',
                                    color: canSendQuick ? '#FBBF24' : '#4B5563',
                                    cursor: canSendQuick ? 'pointer' : 'not-allowed',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <line x1="22" y1="2" x2="11" y2="13" />
                                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div style={styles.rightColumn}>
                        <div style={{ flex: '2', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <Whiteboard
                                steps={whiteboardSteps}
                                archivedTopics={archivedTopics}
                                currentStepId={currentStepId}
                                title={mode === 'tutoring' ? 'VIRTUAL WHITEBOARD' : 'AI FEEDBACK'}
                            />
                        </div>
                        <div style={{ flex: '1', minHeight: 0, overflow: 'hidden' }}>
                            <SessionControls mode={mode as any} />
                        </div>
                    </div>
                </main>
            )}

            {/* Setup Overlay */}
            {gameState === 'setup' && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="setup-title"
                    style={{
                        position: 'absolute', inset: 0,
                        background: 'rgba(5,5,6,0.88)',
                        backdropFilter: 'blur(24px)',
                        WebkitBackdropFilter: 'blur(24px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 100, padding: '1.5rem',
                    }}>
                    <div style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        padding: '2rem 2rem 1.75rem',
                        borderRadius: '1.5rem',
                        maxWidth: '500px', width: '100%', textAlign: 'center',
                        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
                    }}>
                        <h2 id="setup-title" style={{ fontSize: '1.625rem', marginBottom: '0.5rem', fontFamily: '"DM Sans","Inter",sans-serif', fontWeight: 700, letterSpacing: '-0.02em', color: '#FCD34D' }}>
                            {mode === 'tutoring'
                                ? 'What are we learning?'
                                : mode === 'interview'
                                    ? 'Interview Practice'
                                    : 'Public Speaking Practice'}
                        </h2>
                        <p style={{ fontSize: '0.875rem', color: '#9CA3AF', marginBottom: '1.75rem' }}>
                            {mode === 'tutoring' ? 'Enter a topic and the AI coach will guide you.' :
                             mode === 'interview' ? 'Paste a job description to start your mock interview.' :
                             'Choose a practice type and topic.'}
                        </p>
                        {mode === 'interview' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginBottom: '1.5rem' }}>
                                <div>
                                    <label htmlFor="job-desc" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6B7280', marginBottom: '0.375rem' }}>
                                        Job Description
                                    </label>
                                    <textarea
                                        id="job-desc"
                                        value={interviewJobDescription}
                                        onChange={(e) => setInterviewJobDescription(e.target.value)}
                                        placeholder="Paste the job description here…"
                                        rows={6}
                                        style={{
                                            width: '100%', padding: '0.875rem 1rem',
                                            background: 'rgba(255,255,255,0.04)',
                                            border: '1px solid rgba(255,255,255,0.1)',
                                            borderRadius: '0.875rem',
                                            color: '#F3F4F6', fontSize: '0.9375rem',
                                            fontFamily: 'inherit', resize: 'vertical',
                                            lineHeight: 1.6, outline: 'none',
                                            transition: 'border-color 0.15s ease',
                                        }}
                                        onFocus={e => { e.currentTarget.style.borderColor = 'rgba(251,191,36,0.4)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(251,191,36,0.08)'; }}
                                        onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
                                    />
                                </div>
                                <div style={{
                                    padding: '0.875rem 1rem',
                                    background: 'rgba(255,255,255,0.025)',
                                    borderRadius: '0.875rem',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                }}>
                                    <label htmlFor="resume-upload" style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6B7280', display: 'block', marginBottom: '0.5rem' }}>
                                        Resume (optional)
                                    </label>
                                    <input
                                        id="resume-upload"
                                        type="file"
                                        accept=".txt,.md,.pdf"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            setInterviewResumeName(file.name);
                                            const reader = new FileReader();
                                            reader.onload = () => {
                                                const text = typeof reader.result === 'string' ? reader.result : '';
                                                setInterviewResumeText(text.slice(0, 8000));
                                            };
                                            reader.readAsText(file);
                                        }}
                                        style={{ color: '#C4C8D0', fontSize: '0.875rem', fontFamily: 'inherit' }}
                                    />
                                    {interviewResumeName && (
                                        <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#4ADE80', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                                            {interviewResumeName}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        {mode === 'tutoring' && (
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label htmlFor="tutoring-topic" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6B7280', marginBottom: '0.375rem' }}>
                                    Topic
                                </label>
                                <input
                                    id="tutoring-topic"
                                    type="text"
                                    value={setupInfo}
                                    onChange={(e) => setSetupInfo(e.target.value)}
                                    placeholder="e.g. Quantum Physics, Python Basics"
                                    style={{
                                        width: '100%', padding: '0.875rem 1rem',
                                        background: 'rgba(255,255,255,0.04)',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '0.875rem',
                                        color: '#F3F4F6', fontSize: '1rem',
                                        fontFamily: 'inherit', outline: 'none',
                                        transition: 'border-color 0.15s ease',
                                        minHeight: '48px',
                                    }}
                                    onFocus={e => { e.currentTarget.style.borderColor = 'rgba(251,191,36,0.4)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(251,191,36,0.08)'; }}
                                    onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
                                />
                            </div>
                        )}
                        {mode === 'public_speaking' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginBottom: '1.5rem' }}>
                                <div>
                                    <p style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6B7280', marginBottom: '0.5rem' }}>
                                        Practice type
                                    </p>
                                    <div role="group" aria-label="Select practice type" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        {[
                                            'Interview answer',
                                            'Presentation',
                                            'Pitch',
                                            'Storytelling',
                                            'Casual conversation'
                                        ].map((option) => (
                                            <button
                                                key={option}
                                                onClick={() => setSpeakingType(option)}
                                                aria-pressed={speakingType === option}
                                                style={{
                                                    padding: '0.4rem 0.875rem',
                                                    borderRadius: '9999px',
                                                    border: '1px solid',
                                                    borderColor: speakingType === option ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.1)',
                                                    background: speakingType === option ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.04)',
                                                    color: speakingType === option ? '#FBBF24' : '#C4C8D0',
                                                    fontSize: '0.8125rem', fontWeight: 500,
                                                    cursor: 'pointer', fontFamily: 'inherit',
                                                    transition: 'all 0.15s ease',
                                                    minHeight: '36px',
                                                }}
                                            >
                                                {option}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label htmlFor="speaking-topic" style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6B7280', marginBottom: '0.375rem' }}>
                                        Topic
                                    </label>
                                    <input
                                        id="speaking-topic"
                                        type="text"
                                        value={speakingTopic}
                                        onChange={(e) => setSpeakingTopic(e.target.value)}
                                        placeholder="Choose a topic or enter your own"
                                        style={{
                                            width: '100%', padding: '0.875rem 1rem',
                                            background: 'rgba(255,255,255,0.04)',
                                            border: '1px solid rgba(255,255,255,0.1)',
                                            borderRadius: '0.875rem',
                                            color: '#F3F4F6', fontSize: '0.9375rem',
                                            fontFamily: 'inherit', outline: 'none',
                                            transition: 'border-color 0.15s ease',
                                            minHeight: '48px',
                                        }}
                                        onFocus={e => { e.currentTarget.style.borderColor = 'rgba(251,191,36,0.4)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(251,191,36,0.08)'; }}
                                        onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
                                    />
                                </div>
                                <div style={{
                                    padding: '0.875rem 1rem',
                                    background: 'rgba(255,255,255,0.025)',
                                    borderRadius: '0.875rem',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                }}>
                                    <label htmlFor="script-upload" style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6B7280', display: 'block', marginBottom: '0.5rem' }}>
                                        Script or outline (optional)
                                    </label>
                                    <input
                                        id="script-upload"
                                        type="file"
                                        accept=".txt,.md,.pdf"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            setSpeakingScriptName(file.name);
                                            const reader = new FileReader();
                                            reader.onload = () => {
                                                const text = typeof reader.result === 'string' ? reader.result : '';
                                                setSpeakingScriptText(text.slice(0, 8000));
                                            };
                                            reader.readAsText(file);
                                        }}
                                        style={{ color: '#C4C8D0', fontSize: '0.875rem', fontFamily: 'inherit' }}
                                    />
                                    {speakingScriptName && (
                                        <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#4ADE80', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                                            {speakingScriptName}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                            <button
                                onClick={handleStartSession}
                                style={{
                                    width: '100%', padding: '0.875rem 1.5rem',
                                    background: 'linear-gradient(135deg, #FCD34D 0%, #FBBF24 50%, #F59E0B 100%)',
                                    color: '#0a0a0a', fontWeight: 700, borderRadius: '1rem',
                                    border: 'none', cursor: 'pointer', fontSize: '1rem',
                                    fontFamily: '"DM Sans","Inter",sans-serif',
                                    letterSpacing: '0.01em',
                                    transition: 'box-shadow 0.2s ease, transform 0.15s ease',
                                    minHeight: '52px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 0 24px rgba(251,191,36,0.35)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <polygon points="5 3 19 12 5 21 5 3" />
                                </svg>
                                {startButtonLabel}
                            </button>
                            <button
                                onClick={onExit}
                                style={{
                                    width: '100%', padding: '0.75rem',
                                    background: 'transparent',
                                    color: '#9CA3AF', fontWeight: 500, borderRadius: '1rem',
                                    border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
                                    fontSize: '0.9375rem', fontFamily: 'inherit',
                                    transition: 'background 0.2s ease, color 0.2s ease',
                                    minHeight: '44px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#E5E7EB'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9CA3AF'; }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M19 12H5M12 5l-7 7 7 7" />
                                </svg>
                                Back to Home
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Permission Gate Overlay */}
            {gameState === 'permissions' && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="perm-title"
                    style={{
                        position: 'absolute', inset: 0,
                        background: 'rgba(5,5,6,0.9)',
                        backdropFilter: 'blur(28px)',
                        WebkitBackdropFilter: 'blur(28px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 110, padding: '1.5rem',
                    }}>
                    <div style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(251, 191, 36, 0.18)',
                        padding: '2rem',
                        borderRadius: '1.5rem',
                        maxWidth: '440px', width: '100%',
                        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
                    }}>
                        {/* Header */}
                        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
                            <div style={{
                                width: '56px', height: '56px', borderRadius: '1.125rem',
                                background: 'rgba(251, 191, 36, 0.1)',
                                border: '1px solid rgba(251, 191, 36, 0.2)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto 1.25rem',
                            }} aria-hidden="true">
                                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                </svg>
                            </div>
                            <h2 id="perm-title" style={{ fontSize: '1.375rem', marginBottom: '0.5rem', fontFamily: '"DM Sans","Inter",sans-serif', fontWeight: 700, letterSpacing: '-0.02em', color: '#FCD34D' }}>
                                Device Permissions
                            </h2>
                            <p style={{ color: '#9CA3AF', lineHeight: '1.6', fontSize: '0.875rem' }}>
                                Enable devices for the full experience, or skip any you prefer not to use.
                            </p>
                        </div>

                        {/* Permission rows */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                            <PermDialogRow
                                icon={
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
                                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                    </svg>
                                }
                                label="Microphone"
                                description="Voice input for hands-free coaching"
                                status={mic}
                                onAllow={requestMic}
                                onSkip={skipMic}
                            />
                            <PermDialogRow
                                icon={
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M23 7l-7 5 7 5V7z" />
                                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                                    </svg>
                                }
                                label="Camera"
                                description="Biometric monitoring — heart rate & gaze"
                                status={camera}
                                onAllow={requestCamera}
                                onSkip={skipCamera}
                            />
                        </div>

                        <p style={{ color: '#4B5563', fontSize: '0.75rem', textAlign: 'center', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                            Video is processed locally and never stored · You can change these later
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                            <button
                                onClick={() => setGameState('active')}
                                style={{
                                    width: '100%', padding: '0.875rem 1.5rem',
                                    background: 'linear-gradient(135deg, #FCD34D 0%, #FBBF24 50%, #F59E0B 100%)',
                                    color: '#0a0a0a', fontWeight: 700, borderRadius: '1rem',
                                    border: 'none', cursor: 'pointer', fontSize: '1rem',
                                    fontFamily: '"DM Sans","Inter",sans-serif',
                                    letterSpacing: '0.01em',
                                    transition: 'box-shadow 0.2s ease, transform 0.15s ease',
                                    minHeight: '52px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 0 24px rgba(251,191,36,0.35)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
                            >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <polygon points="5 3 19 12 5 21 5 3" />
                                </svg>
                                Start Session
                            </button>
                            <button
                                onClick={() => setGameState('setup')}
                                style={{
                                    width: '100%', padding: '0.75rem',
                                    background: 'transparent',
                                    color: '#9CA3AF', fontWeight: 500, borderRadius: '1rem',
                                    border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
                                    fontSize: '0.9375rem', fontFamily: 'inherit',
                                    transition: 'background 0.2s ease, color 0.2s ease',
                                    minHeight: '44px',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#E5E7EB'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9CA3AF'; }}
                            >
                                ← Change Topic
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ─── InlinePermRow ────────────────────────────────────────────────────────── */
function InlinePermRow({
    label,
    status,
    onAllow,
    onSkip,
}: {
    label: string;
    status: PermissionChoice;
    onAllow: () => void | Promise<void>;
    onSkip: () => void;
}) {
    const isGranted = status === 'granted';
    const isSkipped = status === 'skipped';
    const isDenied = status === 'denied';
    const statusColor = isGranted ? '#4ADE80' : isDenied ? '#F87171' : '#6B7280';
    const statusLabel = isGranted ? 'Enabled' : isDenied ? 'Denied' : isSkipped ? 'Skipped' : 'Not set';
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <span style={{ fontSize: '0.8125rem', color: '#D1D5DB', flex: 1 }}>{label}</span>
            <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: statusColor, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {statusLabel}
            </span>
            {!isGranted && (
                <button
                    onClick={onAllow}
                    style={{ background: 'none', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '0.5rem', color: '#FBBF24', fontSize: '0.75rem', cursor: 'pointer', padding: '0.2rem 0.5rem', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                >
                    Allow
                </button>
            )}
            {!isSkipped && !isGranted && (
                <button
                    onClick={onSkip}
                    style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: '0.75rem', cursor: 'pointer', padding: '0.2rem 0.375rem', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                >
                    Skip
                </button>
            )}
        </div>
    );
}

/* ─── PermDialogRow ────────────────────────────────────────────────────────── */
function PermDialogRow({
    icon,
    label,
    description,
    status,
    onAllow,
    onSkip,
}: {
    icon: React.ReactNode;
    label: string;
    description: string;
    status: PermissionChoice;
    onAllow: () => void | Promise<void>;
    onSkip: () => void;
}) {
    const isGranted = status === 'granted';
    const isSkipped = status === 'skipped';
    const isDenied = status === 'denied';
    const decided = isGranted || isSkipped || isDenied;

    return (
        <div style={{
            background: isGranted ? 'rgba(74,222,128,0.05)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${isGranted ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: '1rem',
            padding: '0.875rem 1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.875rem',
        }}>
            <div style={{
                width: '36px', height: '36px', borderRadius: '0.75rem', flexShrink: 0,
                background: isGranted ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isGranted ? '#4ADE80' : '#9CA3AF',
            }}>
                {icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#E5E7EB', marginBottom: '0.1rem' }}>{label}</div>
                <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>{description}</div>
            </div>
            {decided ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <span style={{
                        fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                        color: isGranted ? '#4ADE80' : isDenied ? '#F87171' : '#6B7280',
                    }}>
                        {isGranted ? 'Enabled' : isDenied ? 'Denied' : 'Skipped'}
                    </span>
                    {!isGranted && (
                        <button
                            onClick={onAllow}
                            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.5rem', color: '#9CA3AF', fontSize: '0.6875rem', cursor: 'pointer', padding: '0.2rem 0.5rem', fontFamily: 'inherit' }}
                        >
                            Allow
                        </button>
                    )}
                </div>
            ) : (
                <div style={{ display: 'flex', gap: '0.375rem' }}>
                    <button
                        onClick={onAllow}
                        style={{
                            padding: '0.375rem 0.75rem', borderRadius: '0.625rem',
                            background: 'rgba(251,191,36,0.12)',
                            border: '1px solid rgba(251,191,36,0.3)',
                            color: '#FBBF24', fontSize: '0.8125rem', fontWeight: 600,
                            cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                            transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(251,191,36,0.2)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(251,191,36,0.12)'; }}
                    >
                        Allow
                    </button>
                    <button
                        onClick={onSkip}
                        style={{
                            padding: '0.375rem 0.75rem', borderRadius: '0.625rem',
                            background: 'transparent',
                            border: '1px solid rgba(255,255,255,0.08)',
                            color: '#6B7280', fontSize: '0.8125rem', fontWeight: 500,
                            cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                            transition: 'color 0.15s, border-color 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#9CA3AF'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#6B7280'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                    >
                        Skip
                    </button>
                </div>
            )}
        </div>
    );
}

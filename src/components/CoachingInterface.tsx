'use client';

import { useState, useEffect } from 'react';
import { CoachingMode, BiometricData } from '@/types';
import BiometricMonitor from './BiometricMonitor';
import dynamic from 'next/dynamic';
const AvatarScene = dynamic(() => import('./AvatarScene'), { ssr: false });
import AudioProcessor from './AudioProcessor';
import SessionControls from './SessionControls';
import VibeReport from './VibeReport';
import LiveCoachingInterface from './LiveCoachingInterface';

export default function CoachingInterface() {
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [mode, setMode] = useState<CoachingMode>('tutoring');
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [biometricData, setBiometricData] = useState<BiometricData | null>(null);
    const [avatarState, setAvatarState] = useState<{
        expression: 'neutral' | 'happy' | 'thinking' | 'concerned' | 'excited';
        gesture: 'idle' | 'greeting' | 'explaining' | 'pointing';
        isSpeaking: boolean;
    }>({
        expression: 'neutral',
        gesture: 'idle',
        isSpeaking: false,
    });
    const [showReport, setShowReport] = useState(false);
    const [ws, setWs] = useState<WebSocket | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [useLiveMode, setUseLiveMode] = useState(false);

    // Initialize WebSocket connection
    useEffect(() => {
        if (!sessionId || !isSessionActive) return;

        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'ws://localhost:8000';
        const websocket = new WebSocket(`${backendUrl.replace('http', 'ws')}/ws/coach/${sessionId}`);

        websocket.onopen = () => {
            console.log('WebSocket connected');
            setIsConnecting(false);
        };

        websocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            handleWebSocketMessage(message);
        };

        websocket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        websocket.onclose = () => {
            console.log('WebSocket disconnected');
        };

        setWs(websocket);

        return () => {
            websocket.close();
        };
    }, [sessionId, isSessionActive]);

    const handleWebSocketMessage = (message: any) => {
        switch (message.type) {
            case 'connected':
                console.log('Session connected:', message.session_id);
                break;

            case 'audio_response':
            case 'text_response':
                if (message.avatar_state) {
                    setAvatarState({
                        expression: message.avatar_state.expression || 'neutral',
                        gesture: message.avatar_state.gesture || 'idle',
                        isSpeaking: true,
                    });
                }
                console.log('AI Response:', message.text);
                break;

            case 'barge_in':
                setAvatarState({
                    expression: 'concerned',
                    gesture: 'pointing',
                    isSpeaking: true,
                });
                console.log('Barge-in triggered:', message.text);
                break;

            case 'session_ended':
                setIsSessionActive(false);
                setShowReport(true);
                break;
        }
    };

    const handleBiometricUpdate = (data: BiometricData) => {
        setBiometricData(data);

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'biometric',
                payload: data,
                timestamp: Date.now(),
            }));
        }
    };

    const handleAudioEvent = (event: import('./AudioProcessor').AudioEvent) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            if (event.kind === 'utterance') {
                ws.send(JSON.stringify({
                    type: 'user_speech',
                    transcript: event.text,
                    timestamp: Date.now(),
                }));
            }
        }
    };

    const startSession = async (selectedMode: CoachingMode) => {
        try {
            setIsConnecting(true);
            const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/session/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: 'user_' + Math.random().toString(36).substr(2, 9),
                    mode: selectedMode,
                }),
            });

            const session = await response.json();
            setSessionId(session.session_id);
            setMode(selectedMode);
            setIsSessionActive(true);
        } catch (error) {
            console.error('Failed to start session:', error);
            setIsConnecting(false);
        }
    };

    const endSession = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'end_session',
                timestamp: Date.now(),
            }));
        }
    };

    if (showReport && sessionId) {
        return <VibeReport sessionId={sessionId} onClose={() => setShowReport(false)} />;
    }

    if (!isSessionActive) {
        return (
            <div className="min-h-screen w-full bg-gradient-to-br from-gray-950 via-gray-900 to-black relative overflow-hidden">
                {/* Animated Background */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute w-96 h-96 bg-yellow-400/10 rounded-full blur-3xl -top-48 -left-48 animate-pulse"></div>
                    <div className="absolute w-96 h-96 bg-yellow-400/5 rounded-full blur-3xl top-1/2 right-0 animate-pulse delay-1000"></div>
                    <div className="absolute w-96 h-96 bg-yellow-400/10 rounded-full blur-3xl -bottom-48 left-1/2 animate-pulse delay-2000"></div>
                </div>

                <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-12">
                    <div className="max-w-7xl w-full">
                        {/* Hero Section */}
                        <div className="text-center mb-16 space-y-6 fade-in">
                            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 text-sm font-medium mb-4">
                                <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></span>
                                Powered by Gemini 3 Flash Preview
                            </div>

                            <h1 className="text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight">
                                <span className="gradient-text">Socratic Mirror</span>
                            </h1>

                            <p className="text-xl md:text-2xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
                                AI-Powered Coaching with Real-Time Biometric Feedback
                            </p>

                            <div className="flex items-center justify-center gap-4 text-sm text-gray-500">
                                <div className="flex items-center gap-2">
                                    <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                                    </svg>
                                    University of Missouri
                                </div>
                                <span>•</span>
                                <div className="flex items-center gap-2">
                                    <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                                        <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" />
                                    </svg>
                                    Real-Time Analysis
                                </div>
                            </div>
                        </div>

                        {/* Mode Selection Cards */}
                        <div className="grid md:grid-cols-3 gap-6 mb-12">
                            {[
                                {
                                    mode: 'tutoring' as CoachingMode,
                                    icon: '🧠',
                                    title: 'Socratic Tutoring',
                                    description: 'Master concepts through guided questioning and critical thinking',
                                    gradient: 'from-blue-500/20 to-purple-500/20',
                                    borderColor: 'border-blue-500/30 hover:border-blue-500/60',
                                },
                                {
                                    mode: 'public_speaking' as CoachingMode,
                                    icon: '🎯',
                                    title: 'Public Speaking',
                                    description: 'Perfect your presentations with real-time delivery feedback',
                                    gradient: 'from-yellow-500/20 to-orange-500/20',
                                    borderColor: 'border-yellow-500/30 hover:border-yellow-500/60',
                                },
                                {
                                    mode: 'interview' as CoachingMode,
                                    icon: '💼',
                                    title: 'Interview Mastery',
                                    description: 'Prepare for high-stakes interviews with AI evaluators',
                                    gradient: 'from-green-500/20 to-emerald-500/20',
                                    borderColor: 'border-green-500/30 hover:border-green-500/60',
                                },
                            ].map((item) => (
                                <button
                                    key={item.mode}
                                    onClick={() => startSession(item.mode)}
                                    disabled={isConnecting}
                                    className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${item.gradient} backdrop-blur-xl border ${item.borderColor} p-8 text-left transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-yellow-400/20 disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

                                    <div className="relative z-10 space-y-4">
                                        <div className="text-6xl">{item.icon}</div>
                                        <h3 className="text-2xl font-bold text-white">{item.title}</h3>
                                        <p className="text-gray-300 text-sm leading-relaxed">{item.description}</p>

                                        <div className="flex items-center gap-2 text-yellow-400 font-medium text-sm">
                                            <span>Start Session</span>
                                            <svg className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>

                        {/* Features Grid */}
                        <div className="grid md:grid-cols-4 gap-4 mb-12">
                            {[
                                { icon: '❤️', label: 'rPPG Heart Rate', sublabel: 'Camera-based monitoring' },
                                { icon: '👁️', label: 'Gaze Tracking', sublabel: 'Eye contact analysis' },
                                { icon: '🎙️', label: 'Voice Analysis', sublabel: 'Communication quality' },
                                { icon: '📊', label: 'Vibe Reports', sublabel: 'Performance insights' },
                            ].map((feature, index) => (
                                <div key={index} className="glass rounded-xl p-4 text-center hover:bg-white/5 transition-colors">
                                    <div className="text-3xl mb-2">{feature.icon}</div>
                                    <div className="text-sm font-semibold text-white">{feature.label}</div>
                                    <div className="text-xs text-gray-400 mt-1">{feature.sublabel}</div>
                                </div>
                            ))}
                        </div>

                        {/* Disclaimer */}
                        <div className="text-center space-y-2 text-sm text-gray-500">
                            <p className="flex items-center justify-center gap-2">
                                <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                </svg>
                                Biometric monitoring requires webcam and microphone access
                            </p>
                            <p>Not medical-grade • For educational and coaching purposes only</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full bg-gradient-to-br from-gray-950 via-gray-900 to-black flex flex-col">
            {/* Premium Header */}
            <header className="glass border-b border-white/10 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <div>
                            <div className="text-xs text-gray-400 mb-1">Mode</div>
                            <div className="text-lg font-bold gradient-text capitalize">
                                {mode.replace('_', ' ')}
                            </div>
                        </div>

                        {biometricData && (
                            <div className="flex items-center gap-4 pl-6 border-l border-white/10">
                                <div>
                                    <div className="text-xs text-gray-400 mb-1">Heart Rate</div>
                                    <div className="text-lg font-bold text-white">
                                        {biometricData.heartRate.toFixed(0)} <span className="text-sm text-gray-400">BPM</span>
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs text-gray-400 mb-1">Stress Level</div>
                                    <div className="flex items-center gap-2">
                                        <div className={`status-indicator status-${biometricData.stressLevel}`}></div>
                                        <span className="text-sm font-semibold text-white capitalize">{biometricData.stressLevel}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <button onClick={endSession} className="btn bg-red-500/20 hover:bg-red-500/30 text-red-400 border-red-500/30">
                        <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        End Session
                    </button>
                </div>
            </header>

            {/* Main Content Area */}
            <div className="flex-1 max-w-screen-2xl mx-auto w-full p-6">
                <div className="grid lg:grid-cols-12 gap-6 h-full">
                    {/* Avatar - Large on desktop */}
                    <div className="lg:col-span-7 h-full min-h-[600px]">
                        <div className="card p-0 overflow-hidden h-full border-2 border-yellow-400/20 shadow-2xl shadow-yellow-400/10">
                            <AvatarScene
                                expression={avatarState.expression}
                                gesture={avatarState.gesture}
                                isSpeaking={avatarState.isSpeaking}
                            />
                        </div>
                    </div>

                    {/* Controls - Sidebar */}
                    <div className="lg:col-span-5 space-y-4 h-full overflow-y-auto custom-scrollbar">
                        {/* Live / Text mode toggle */}
                        <div className="flex items-center gap-2 p-1 rounded-xl bg-gray-800 border border-gray-700">
                            <button
                                onClick={() => setUseLiveMode(false)}
                                className={`flex-1 py-2 text-sm rounded-lg font-medium transition-colors ${!useLiveMode ? 'bg-yellow-500 text-black' : 'text-gray-400 hover:text-white'}`}
                            >
                                Text Mode
                            </button>
                            <button
                                onClick={() => setUseLiveMode(true)}
                                className={`flex-1 py-2 text-sm rounded-lg font-medium transition-colors ${useLiveMode ? 'bg-green-500 text-black' : 'text-gray-400 hover:text-white'}`}
                            >
                                Live Audio
                            </button>
                        </div>

                        {useLiveMode && sessionId ? (
                            <>
                                <BiometricMonitor onBiometricUpdate={handleBiometricUpdate} />
                                <LiveCoachingInterface
                                    sessionId={sessionId}
                                    mode={mode}
                                    biometricData={biometricData}
                                    onSessionEnd={endSession}
                                />
                            </>
                        ) : (
                            <>
                                <BiometricMonitor onBiometricUpdate={handleBiometricUpdate} />
                                <AudioProcessor onAudioEvent={handleAudioEvent} />
                                <SessionControls mode={mode} />
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

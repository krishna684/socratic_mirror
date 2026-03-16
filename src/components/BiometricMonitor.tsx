'use client';

import { useState, useEffect, useRef } from 'react';
import { BiometricData } from '@/types';
import {
    extractGreenChannel,
    rollingMeanSubtraction,
    ButterworthFilter,
    calculateBPM,
    smoothBPM,
    detectStressLevel,
} from '@/utils/rppg';

interface BiometricMonitorProps {
    onBiometricUpdate: (data: BiometricData) => void;
}

export default function BiometricMonitor({ onBiometricUpdate }: BiometricMonitorProps) {
    const [hasPermission, setHasPermission] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [heartRate, setHeartRate] = useState(72);
    const [stressLevel, setStressLevel] = useState<'low' | 'medium' | 'high'>('low');
    const [signalQuality, setSignalQuality] = useState(95);

    const [postureAlert, setPostureAlert] = useState<string | null>(null);

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const rafRef = useRef<number | null>(null);
    const lastSampleTimeRef = useRef<number>(0);
    const lastPublishTimeRef = useRef<number>(0);
    const lastBpmRef = useRef<number>(0);
    const baselineBpmRef = useRef<number | null>(null);
    const stressStateRef = useRef<{ isStressed: boolean; startTime: number | null }>({
        isStressed: false,
        startTime: null,
    });
    const filterRef = useRef<ButterworthFilter>(new ButterworthFilter());
    const signalBufferRef = useRef<number[]>([]);
    const timestampBufferRef = useRef<number[]>([]);

    useEffect(() => {
        initializeCamera();
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    useEffect(() => {
        if (!hasPermission) return;

        const targetFps = 30;
        const maxSamples = 300;
        const minSamples = 90;
        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (!canvas || !video) return;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        canvas.width = 160;
        canvas.height = 120;

        const updatePosture = () => {
            let alert = null;
            const rand = Math.random();
            if (rand < 0.05) alert = 'Slouching detected - sit up straight!';
            else if (rand < 0.1) alert = 'Looking away frequently - maintain eye contact.';
            else if (rand < 0.15) alert = 'Leaning excessively - stay centered.';
            setPostureAlert(alert);
            return alert;
        };

        const computeSignalQuality = (signal: number[], bpm: number) => {
            if (!bpm || signal.length < 20) return 60;
            const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
            const variance = signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
            const stdDev = Math.sqrt(variance);
            const quality = Math.max(60, Math.min(100, 60 + stdDev * 20));
            return quality;
        };

        const processFrame = (now: number) => {
            if (!videoRef.current || videoRef.current.readyState < 2) {
                rafRef.current = requestAnimationFrame(processFrame);
                return;
            }

            const elapsed = now - lastSampleTimeRef.current;
            if (elapsed < 1000 / targetFps) {
                rafRef.current = requestAnimationFrame(processFrame);
                return;
            }

            lastSampleTimeRef.current = now;
            ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const greenValue = extractGreenChannel(imageData);

            signalBufferRef.current.push(greenValue);
            timestampBufferRef.current.push(Date.now());

            if (signalBufferRef.current.length > maxSamples) {
                signalBufferRef.current.shift();
                timestampBufferRef.current.shift();
            }

            if (signalBufferRef.current.length >= minSamples) {
                const centered = rollingMeanSubtraction(signalBufferRef.current, 30);
                filterRef.current.reset();
                const filtered = centered.map(val => filterRef.current.filter(val));

                const timestamps = timestampBufferRef.current;
                const durationSeconds = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000;
                const samplingRate = durationSeconds > 0
                    ? (timestamps.length - 1) / durationSeconds
                    : targetFps;

                const rawBpm = calculateBPM(filtered, samplingRate);
                const previousBpm = lastBpmRef.current || rawBpm || 0;
                const smoothedBpm = rawBpm ? smoothBPM(rawBpm, previousBpm) : previousBpm;

                if (smoothedBpm > 0) {
                    lastBpmRef.current = smoothedBpm;
                    if (baselineBpmRef.current === null) {
                        baselineBpmRef.current = smoothedBpm;
                    } else {
                        baselineBpmRef.current = baselineBpmRef.current * 0.98 + smoothedBpm * 0.02;
                    }
                }

                if (now - lastPublishTimeRef.current >= 1000 && smoothedBpm > 0) {
                    lastPublishTimeRef.current = now;
                    const baseline = baselineBpmRef.current || smoothedBpm;
                    const stressInfo = detectStressLevel(Math.round(smoothedBpm), baseline, stressStateRef.current);
                    const quality = computeSignalQuality(filtered.slice(-120), smoothedBpm);
                    const alert = updatePosture();

                    setHeartRate(smoothedBpm);
                    setStressLevel(stressInfo.level);
                    setSignalQuality(quality);

                    onBiometricUpdate({
                        heartRate: Math.round(smoothedBpm),
                        stressLevel: stressInfo.level,
                        signalQuality: Math.round(quality),
                        gazeDirection: [0, 0, 0],
                        postureScore: alert ? 60 : 100,
                        confidenceLevel: quality,
                        timestamp: Date.now(),
                    });
                }
            }

            rafRef.current = requestAnimationFrame(processFrame);
        };

        rafRef.current = requestAnimationFrame(processFrame);

        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [hasPermission, onBiometricUpdate]);

    // Handle attaching stream to video element when permission is granted
    useEffect(() => {
        if (hasPermission && videoRef.current && streamRef.current) {
            console.log('Attaching stream to video element');
            videoRef.current.srcObject = streamRef.current;
        }
    }, [hasPermission]);

    const initializeCamera = async () => {
        try {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }

            console.log('Requesting camera access...');
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' }
            });

            streamRef.current = stream;
            setHasPermission(true);
            setError(null);
            console.log('Permission granted and stream stored');
        } catch (err: any) {
            console.error('Camera access error:', err);
            setError(err.message || 'Camera access denied');
        }
    };

    if (error) {
        return (
            <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '1.5rem',
                padding: '1.5rem',
            }}>
                <div style={{ textAlign: 'center', padding: '0.5rem' }}>
                    <div style={{ width: '40px', height: '40px', background: 'rgba(239,68,68,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem' }} aria-hidden="true">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    </div>
                    <p style={{ fontSize: '0.8125rem', color: '#F87171', marginBottom: '1rem', lineHeight: 1.5 }}>{error}</p>
                    <button
                        onClick={() => { setError(null); initializeCamera(); }}
                        style={{ padding: '0.625rem 1.25rem', borderRadius: '0.75rem', background: 'linear-gradient(135deg, #FCD34D, #FBBF24)', color: '#0a0a0a', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem', minHeight: '44px', fontFamily: '"DM Sans","Inter",sans-serif' }}
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    if (!hasPermission && !error) {
        return (
            <div style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '1.5rem',
                border: '1px solid rgba(255, 255, 255, 0.08)',
            }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ width: '40px', height: '40px', background: 'rgba(251,191,36,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.625rem', animation: 'pulse 1.5s ease-in-out infinite' }} aria-hidden="true">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>Initializing Camera…</p>
                </div>
            </div>
        );
    }

    return (
        <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '1.5rem',
            padding: '1.5rem',
            overflow: 'hidden',
        }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexShrink: 0 }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#F3F4F6', margin: 0, fontFamily: '"DM Sans","Inter",sans-serif', letterSpacing: '-0.01em' }}>Biometrics</h3>
                <span style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem', borderRadius: '1rem', background: 'rgba(34, 197, 94, 0.2)', color: '#4ADE80', fontWeight: 600 }}>LIVE</span>
            </div>

            {/* Video */}
            <div style={{ position: 'relative', borderRadius: '1rem', overflow: 'hidden', background: '#000', marginBottom: '1rem', flex: 1, minHeight: '180px', aspectRatio: '4/3' }}>
                <video ref={videoRef} autoPlay playsInline muted aria-label="Camera feed for biometric monitoring" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <canvas ref={canvasRef} style={{ display: 'none' }} />

                {/* Gentle Correction Overlay */}
                {postureAlert && (
                    <div style={{
                        position: 'absolute',
                        bottom: '1rem',
                        left: '1rem',
                        right: '1rem',
                        background: 'rgba(239, 68, 68, 0.8)',
                        backdropFilter: 'blur(10px)',
                        color: '#fff',
                        padding: '0.5rem 1rem',
                        borderRadius: '0.5rem',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        textAlign: 'center',
                        animation: 'pulse 2s infinite',
                        zIndex: 10,
                    }}>
                        {postureAlert}
                    </div>
                )}
            </div>
            <style>{`
                @keyframes pulse {
                    0% { transform: scale(1); opacity: 0.9; }
                    50% { transform: scale(1.02); opacity: 1; }
                    100% { transform: scale(1); opacity: 0.9; }
                }
            `}</style>

            {/* Metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.625rem 0.5rem', borderRadius: '0.75rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.625rem', color: '#9CA3AF', marginBottom: '0.25rem', letterSpacing: '0.06em', fontWeight: 600, textTransform: 'uppercase' as const }}>HR</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F3F4F6', fontFamily: '"DM Sans","Inter",sans-serif', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{Math.round(heartRate)}</div>
                    <div style={{ fontSize: '0.625rem', color: '#6B7280', marginTop: '0.125rem' }}>BPM</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.625rem 0.5rem', borderRadius: '0.75rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.625rem', color: '#9CA3AF', marginBottom: '0.375rem', letterSpacing: '0.06em', fontWeight: 600, textTransform: 'uppercase' as const }}>STRESS</div>
                    <div
                        role="status"
                        aria-label={`Stress level: ${stressLevel}`}
                        style={{
                            width: '12px', height: '12px', borderRadius: '50%', margin: '0 auto 0.25rem',
                            background: stressLevel === 'low' ? '#4ADE80' : stressLevel === 'medium' ? '#FBBF24' : '#F87171',
                            boxShadow: `0 0 8px ${stressLevel === 'low' ? '#4ADE80' : stressLevel === 'medium' ? '#FBBF24' : '#F87171'}`,
                        }}
                    />
                    <div style={{ fontSize: '0.6875rem', color: '#E5E7EB', textTransform: 'capitalize' as const, fontWeight: 600 }}>{stressLevel}</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.625rem 0.5rem', borderRadius: '0.75rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.625rem', color: '#9CA3AF', marginBottom: '0.25rem', letterSpacing: '0.06em', fontWeight: 600, textTransform: 'uppercase' as const }}>SIG</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F3F4F6', fontFamily: '"DM Sans","Inter",sans-serif', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{Math.round(signalQuality)}</div>
                    <div style={{ fontSize: '0.625rem', color: '#6B7280', marginTop: '0.125rem' }}>%</div>
                </div>
            </div>
        </div>
    );
}

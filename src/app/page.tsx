'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import styles from './Home.module.css';
import { PermissionProvider } from '@/context/PermissionContext';
import NavBar from '@/components/NavBar';

const CoachingSession = dynamic(() => import('./CoachingSession'), {
    ssr: false,
    loading: () => (
        <div style={{
            minHeight: '100dvh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#050506',
            color: '#fff',
        }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{
                    width: '48px',
                    height: '48px',
                    border: '3px solid rgba(255, 255, 255, 0.08)',
                    borderTopColor: '#FBBF24',
                    borderRadius: '50%',
                    animation: 'spin 0.9s linear infinite',
                    margin: '0 auto 1.25rem',
                }} role="status" aria-label="Loading" />
                <p style={{ fontSize: '1.0625rem', color: '#9CA3AF' }}>Loading Coaching Interface…</p>
            </div>
        </div>
    ),
});

/* ─── SVG Icon Components ─────────────────── */
function IconBrain({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9.5 2a2.5 2.5 0 0 1 5 0" />
            <path d="M9 3.5C6 3.5 4 6 4 8.5c0 1.5.7 2.8 1.7 3.7C4.7 13 4 14.2 4 15.5c0 2.5 2 4.5 4.5 4.5H12" />
            <path d="M15 3.5c3 0 5 2.5 5 5 0 1.5-.7 2.8-1.7 3.7 1 .8 1.7 2 1.7 3.3 0 2.5-2 4.5-4.5 4.5H12" />
            <path d="M12 2v20" />
        </svg>
    );
}

function IconMic({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="8" y1="22" x2="16" y2="22" />
        </svg>
    );
}

function IconBriefcase({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
    );
}

function IconHeart({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z" />
        </svg>
    );
}

function IconEye({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

function IconWaveform({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12h3M7 6v12M12 3v18M17 6v12M22 12h-3" />
        </svg>
    );
}

function IconBarChart({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
            <line x1="2" y1="20" x2="22" y2="20" />
        </svg>
    );
}

function IconChevronRight({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
        </svg>
    );
}

/* ─── Mode Card Definition ──────────────────── */
const MODES = [
    {
        id: 'tutoring',
        Icon: IconBrain,
        iconClass: styles.cardIconBlue,
        cardClass: styles.cardBlue,
        title: 'Socratic Tutoring',
        description: 'Master concepts through guided questioning and critical thinking.',
        ariaLabel: 'Start Socratic Tutoring session',
    },
    {
        id: 'public_speaking',
        Icon: IconMic,
        iconClass: styles.cardIconYellow,
        cardClass: styles.cardYellow,
        title: 'Public Speaking',
        description: 'Perfect your presentations with real-time delivery feedback.',
        ariaLabel: 'Start Public Speaking session',
    },
    {
        id: 'interview',
        Icon: IconBriefcase,
        iconClass: styles.cardIconGreen,
        cardClass: styles.cardGreen,
        title: 'Interview Mastery',
        description: 'Prepare for high-stakes interviews with AI evaluators.',
        ariaLabel: 'Start Interview Mastery session',
    },
];

/* ─── Feature Chip Definition ───────────────── */
const FEATURES = [
    { Icon: IconHeart,    label: 'rPPG Heart Rate', sub: 'Camera-based' },
    { Icon: IconEye,      label: 'Gaze Tracking',   sub: 'Eye contact' },
    { Icon: IconWaveform, label: 'Voice Analysis',  sub: 'Quality metrics' },
    { Icon: IconBarChart, label: 'Vibe Reports',    sub: 'Performance insights' },
];

/* ─── Page Component ─────────────────────────── */
export default function Home() {
    const [selectedMode, setSelectedMode] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleModeSelect = async (mode: string) => {
        if (isLoading) return;
        setIsLoading(true);
        setSelectedMode(mode);

        try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/session/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: 'user_' + Math.random().toString(36).substr(2, 9),
                    mode,
                }),
            });

            const session = await response.json();
            setSessionId(session.session_id);
        } catch (error) {
            console.error('Failed to create session:', error);
            alert('Backend connection failed.\n\nMake sure the FastAPI server is running on port 8000.');
            setIsLoading(false);
            setSelectedMode(null);
        }
    };

    if (sessionId && selectedMode) {
        return (
            <PermissionProvider>
                <CoachingSession
                    mode={selectedMode}
                    sessionId={sessionId}
                    onExit={() => {
                        setSessionId(null);
                        setSelectedMode(null);
                        setIsLoading(false);
                    }}
                />
            </PermissionProvider>
        );
    }

    return (
        <PermissionProvider>
            <a href="#main-content" className="skip-link">Skip to content</a>
            <NavBar />
            {/* Offset content below fixed NavBar */}
            <div style={{ height: '56px' }} aria-hidden="true" />

            <div className={styles.container} role="main" id="main-content">
                {/* Ambient background orbs */}
                <div className={styles.bgOrb1} aria-hidden="true" />
                <div className={styles.bgOrb2} aria-hidden="true" />
                <div className={styles.bgOrb3} aria-hidden="true" />

                <div className={styles.content}>
                    {/* Live badge */}
                    <div className={styles.badge} role="status">
                        <div className={styles.badgeDot} aria-hidden="true" />
                        Powered by Gemini 3 Flash Preview
                    </div>

                    {/* Title */}
                    <h1 className={styles.title}>
                        <span className={styles.gradientText}>Socratic Mirror</span>
                    </h1>

                    {/* Subtitle */}
                    <p className={styles.subtitle}>
                        AI-powered coaching with real-time biometric feedback
                    </p>

                    {/* Meta tags */}
                    <div className={styles.tags} aria-label="Platform details">
                        <div className={styles.tag}>
                            <svg className={styles.icon} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                            </svg>
                            University of Missouri
                        </div>
                        <span className={styles.dot} aria-hidden="true">·</span>
                        <div className={styles.tag}>
                            <svg className={styles.icon} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" />
                            </svg>
                            Real-Time Analysis
                        </div>
                    </div>

                    {/* Mode Selection */}
                    <div className={styles.grid} role="list" aria-label="Coaching modes">
                        {MODES.map(({ id, Icon, iconClass, cardClass, title, description, ariaLabel }) => {
                            const isThisLoading = isLoading && selectedMode === id;
                            return (
                                <div
                                    key={id}
                                    role="listitem"
                                    className={`${styles.card} ${cardClass} ${isThisLoading ? styles.cardLoading : ''}`}
                                    onClick={() => handleModeSelect(id)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            handleModeSelect(id);
                                        }
                                    }}
                                    tabIndex={isLoading ? -1 : 0}
                                    aria-label={ariaLabel}
                                    aria-busy={isThisLoading}
                                    aria-disabled={isLoading && !isThisLoading}
                                    style={{
                                        opacity: isLoading && !isThisLoading ? 0.45 : 1,
                                        cursor: isLoading ? (isThisLoading ? 'wait' : 'not-allowed') : 'pointer',
                                        pointerEvents: isLoading && !isThisLoading ? 'none' : undefined,
                                    }}
                                >
                                    <div className={`${styles.cardIconWrap} ${iconClass}`}>
                                        <Icon className={styles.cardIconSvg} />
                                    </div>
                                    <h3 className={styles.cardTitle}>{title}</h3>
                                    <p className={styles.cardDesc}>{description}</p>
                                    <div className={styles.cardArrow} aria-hidden="true">
                                        <span>{isThisLoading ? 'Starting…' : 'Start Session'}</span>
                                        <IconChevronRight />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Feature Chips */}
                    <div className={styles.features} aria-label="Platform capabilities">
                        {FEATURES.map(({ Icon, label, sub }) => (
                            <div key={label} className={styles.feature}>
                                <div className={styles.featureIconWrap} aria-hidden="true">
                                    <Icon className={styles.featureIconSvg} />
                                </div>
                                <div className={styles.featureLabel}>{label}</div>
                                <div className={styles.featureSub}>{sub}</div>
                            </div>
                        ))}
                    </div>

                    {/* Disclaimer */}
                    <aside className={styles.disclaimer} aria-label="Privacy notice">
                        <div className={styles.disclaimerHeader}>
                            <svg className={styles.disclaimerIcon} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                            Biometric monitoring requires webcam and microphone access
                        </div>
                        <p className={styles.disclaimerSub}>
                            Not medical-grade · For educational and coaching purposes only
                        </p>
                    </aside>
                </div>
            </div>
        </PermissionProvider>
    );
}

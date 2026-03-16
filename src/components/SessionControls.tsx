'use client';

import { CoachingMode } from '@/types';

interface SessionControlsProps {
    mode: CoachingMode;
}

const styles = {
    card: {
        background: 'rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid',
        borderRadius: '1rem',
        padding: '1rem',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column' as const,
        overflow: 'auto',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        marginBottom: '0.75rem',
    },
    icon: {
        fontSize: '1.5rem',
    },
    headerText: {
        flex: 1,
    },
    modeLabel: {
        fontSize: '0.6875rem',
        color: '#9CA3AF',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.06em',
        fontWeight: 600,
        marginBottom: '0.1rem',
    },
    modeTitle: {
        fontSize: '1rem',
        fontWeight: 700,
        color: '#fff',
        margin: 0,
    },
    divider: {
        height: '1px',
        background: 'rgba(255, 255, 255, 0.1)',
        marginBottom: '0.75rem',
    },
    tipsHeader: {
        fontSize: '0.75rem',
        fontWeight: 700,
        color: '#FBBF24',
        marginBottom: '0.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
    },
    tipsList: {
        listStyle: 'none',
        padding: 0,
        margin: '0 0 0.75rem 0',
    },
    tipItem: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.4rem',
        marginBottom: '0.4rem',
        fontSize: '0.8rem',
        color: '#D1D5DB',
        lineHeight: '1.4',
    },
    tipBullet: {
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: '#FBBF24',
        flexShrink: 0,
        marginTop: '0.5rem',
    },
    infoBox: {
        background: 'rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(24px)',
        border: '1px solid',
        borderRadius: '0.5rem',
        padding: '0.5rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.4rem',
        marginTop: 'auto',
    },
    infoText: {
        fontSize: '0.75rem',
        color: '#9CA3AF',
        lineHeight: 1.5,
        margin: 0,
    },
};

export default function SessionControls({ mode }: SessionControlsProps) {
    const modeConfig = {
        tutoring: {
            title: 'Socratic Tutoring',
            gradient: 'rgba(251, 191, 36, 0.05)',
            borderColor: 'rgba(251, 191, 36, 0.2)',
            tips: [
                'Answer with your best understanding, even if uncertain',
                'Ask clarifying questions when concepts are unclear',
                'Explain your reasoning process',
                'Embrace the journey of discovery',
            ],
        },
        public_speaking: {
            icon: '🎯',
            title: 'Public Speaking',
            gradient: 'rgba(251, 191, 36, 0.05)',
            borderColor: 'rgba(251, 191, 36, 0.2)',
            tips: [
                'Session length: 5–15 minutes total',
                'Flow: Warm-up → Topic → Main Speech → Follow-ups → Report',
                'Main speech target: 3–5 minutes (no interruptions)',
                'Follow-ups simulate real audience questions',
                'Say “done” or “thank you” to end early',
            ],
        },
        interview: {
            title: 'Interview Prep',
            gradient: 'rgba(251, 191, 36, 0.05)',
            borderColor: 'rgba(251, 191, 36, 0.2)',
            tips: [
                'Target length: 5–15 minutes (6–10 questions)',
                'Flow: Warm-up (1) → Background (1–2) → Technical (3–5) → Behavioral (2) → Wrap-up (1)',
                'Technical questions are capped at 90 seconds each',
                'Hints are given only once per question',
                'Type “end” to finish early and receive your report',
            ],
        },
    };

    const config = modeConfig[mode];

    return (
        <div
            style={{
                ...styles.card,
                background: config.gradient,
                borderColor: config.borderColor,
            }}
        >
            <div>
                <h4 style={styles.tipsHeader}>
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    Tips for Success
                </h4>
                <ul style={styles.tipsList}>
                    {config.tips.map((tip, index) => (
                        <li key={index} style={styles.tipItem}>
                            <div style={styles.tipBullet}></div>
                            <span>{tip}</span>
                        </li>
                    ))}
                </ul>
            </div>

            <div
                style={{
                    ...styles.infoBox,
                    borderColor: config.borderColor,
                }}
            >
                <svg width="20" height="20" fill="#FBBF24" viewBox="0 0 20 20" style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <p style={styles.infoText}>
                    Your biometric data is being monitored in real-time to provide personalized coaching feedback.
                </p>
            </div>
        </div>
    );
}

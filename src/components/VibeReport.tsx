'use client';

import { useEffect, useMemo, useState } from 'react';
import { VibeReport as VibeReportType } from '@/types';

interface VibeReportProps {
    sessionId: string;
    onClose: () => void;
    initialReport?: VibeReportType | null;
    whiteboardExport?: {
        mode: string;
        activeSteps: any[];
        archivedTopics: any[];
        currentStepId: number;
    };
}

const styles = {
    container: {
        minHeight: '100dvh',
        background: 'radial-gradient(ellipse 80% 40% at 50% -5%, rgba(251,191,36,0.04) 0%, transparent 55%), linear-gradient(180deg, #070707 0%, #050506 100%)',
        overflowY: 'auto' as const,
        padding: '3.5rem 1.5rem 5rem',
        color: '#F3F4F6',
        fontFamily: '"Inter", -apple-system, sans-serif',
    },
    content: {
        maxWidth: '860px',
        margin: '0 auto',
    },
    glassCard: {
        background: 'rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.07)',
        borderRadius: '1.5rem',
        padding: '2.25rem',
        marginBottom: '1.5rem',
        boxShadow: '0 8px 40px rgba(0, 0, 0, 0.35)',
    },
    header: {
        textAlign: 'center' as const,
        marginBottom: '3rem',
    },
    title: {
        fontFamily: '"DM Sans", "Inter", sans-serif',
        fontSize: 'clamp(2.5rem, 6vw, 3.5rem)',
        fontWeight: 800,
        margin: '0 0 0.5rem 0',
        background: 'linear-gradient(135deg, #FCD34D 0%, #FBBF24 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        letterSpacing: '-0.03em',
    },
    subtitle: {
        fontSize: '1rem',
        color: '#9CA3AF',
        fontWeight: 500,
        letterSpacing: '0.01em',
    },
    scoreSection: {
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        marginBottom: '2.25rem',
    },
    scoreRing: {
        position: 'relative' as const,
        width: '176px',
        height: '176px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '0.875rem',
    },
    scoreValue: {
        fontFamily: '"DM Sans", "Inter", sans-serif',
        fontSize: '3.25rem',
        fontWeight: 800,
        background: 'linear-gradient(135deg, #fff 0%, #FBBF24 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        letterSpacing: '-0.03em',
    },
    statsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '1rem',
        marginBottom: '2.5rem',
    },
    statCard: {
        background: 'rgba(255, 255, 255, 0.025)',
        border: '1px solid rgba(255, 255, 255, 0.07)',
        borderRadius: '1.125rem',
        padding: '1.25rem 1rem',
        textAlign: 'center' as const,
        transition: 'border-color 0.2s ease',
    },
    statLabel: {
        fontSize: '0.6875rem',
        color: '#9CA3AF',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.07em',
        fontWeight: 600,
        marginBottom: '0.5rem',
    },
    statValue: {
        fontFamily: '"DM Sans", "Inter", sans-serif',
        fontSize: '1.625rem',
        fontWeight: 700,
        color: '#F3F4F6',
        letterSpacing: '-0.02em',
    },
    sectionTitle: {
        fontFamily: '"DM Sans", "Inter", sans-serif',
        fontSize: '1.25rem',
        fontWeight: 700,
        marginBottom: '1.25rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        letterSpacing: '-0.01em',
        color: '#F3F4F6',
    },
    analysis: {
        fontSize: '1rem',
        lineHeight: 1.75,
        color: '#C4C8D0',
        whiteSpace: 'pre-wrap' as const,
    },
    summaryBox: {
        marginTop: '1.25rem',
        padding: '1.125rem 1.25rem',
        borderRadius: '1rem',
        background: 'rgba(251, 191, 36, 0.06)',
        border: '1px solid rgba(251, 191, 36, 0.18)',
    },
    summaryTitle: {
        fontSize: '0.6875rem',
        color: '#FCD34D',
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        marginBottom: '0.5rem',
        fontWeight: 700,
    },
    summaryText: {
        fontSize: '0.9375rem',
        color: '#E5E7EB',
        lineHeight: 1.65,
    },
    summaryList: {
        marginTop: '0.625rem',
        paddingLeft: '1.25rem',
        color: '#C4C8D0',
        fontSize: '0.9rem',
        lineHeight: 1.65,
    },
    badgeList: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '0.75rem',
    },
    badge: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.875rem',
        padding: '1rem 1.125rem',
        borderRadius: '1rem',
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        transition: 'background 0.2s ease',
    },
    buttonContainer: {
        display: 'flex',
        gap: '0.875rem',
        marginTop: '2.5rem',
        flexWrap: 'wrap' as const,
    },
    primaryButton: {
        flex: 2,
        minWidth: '190px',
        padding: '1rem 1.5rem',
        borderRadius: '1rem',
        background: 'linear-gradient(135deg, #FCD34D 0%, #FBBF24 50%, #F59E0B 100%)',
        color: '#0a0a0a',
        fontSize: '1rem',
        fontWeight: 700,
        fontFamily: '"DM Sans","Inter",sans-serif',
        border: 'none',
        cursor: 'pointer',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        minHeight: '52px',
        letterSpacing: '0.01em',
    },
    secondaryButton: {
        flex: 1,
        minWidth: '160px',
        padding: '1rem 1.25rem',
        borderRadius: '1rem',
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.09)',
        color: '#C4C8D0',
        fontSize: '0.9375rem',
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
        transition: 'background 0.2s ease, border-color 0.2s ease',
        minHeight: '52px',
    },
};

export default function VibeReport({ sessionId, onClose, initialReport = null, whiteboardExport }: VibeReportProps) {
    const [report, setReport] = useState<VibeReportType | null>(initialReport);
    const [loading, setLoading] = useState(!initialReport);

    useEffect(() => {
        if (!initialReport) {
            void fetchReport();
        }
    }, [sessionId]);

    const fetchReport = async () => {
        try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/session/${sessionId}/report`);
            if (!response.ok) throw new Error('Report not found');
            const data = await response.json();
            setReport(data);
        } catch (error) {
            console.error('Failed to fetch vibe report:', error);
        } finally {
            setLoading(false);
        }
    };

    const peakHeartRate = useMemo(() => {
        if (!report?.peak_confidence_frame) return null;
        const frame: any = report.peak_confidence_frame;
        const value = frame.heartRate ?? frame.heart_rate;
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    }, [report]);

    const downloadWhiteboardData = () => {
        if (!whiteboardExport) return;

        const payload = {
            sessionId,
            exportedAt: new Date().toISOString(),
            mode: whiteboardExport.mode,
            currentStepId: whiteboardExport.currentStepId,
            activeSteps: whiteboardExport.activeSteps || [],
            archivedTopics: whiteboardExport.archivedTopics || [],
            reportSummary: {
                overall_score: report?.overall_score ?? null,
                discussion_summary: report?.discussion_summary ?? '',
            },
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `whiteboard-${sessionId.slice(0, 8)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    if (loading) {
        return (
            <div style={styles.container}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '1.5rem' }}>
                    <div
                        role="status"
                        aria-label="Analyzing session"
                        style={{
                            width: '56px', height: '56px',
                            border: '3px solid rgba(252, 211, 77, 0.1)',
                            borderTopColor: '#FBBF24',
                            borderRadius: '50%',
                            animation: 'spin 0.9s linear infinite',
                        }}
                    />
                    <div style={{ textAlign: 'center' }}>
                        <p style={{ fontSize: '1.125rem', color: '#E5E7EB', fontWeight: 600, marginBottom: '0.375rem' }}>
                            Analyzing your session…
                        </p>
                        <p style={{ fontSize: '0.875rem', color: '#6B7280' }}>This usually takes a few seconds.</p>
                    </div>
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    if (!report) {
        return (
            <div style={styles.container}>
                <div style={{ textAlign: 'center', padding: '4rem' }}>
                    <h2 style={{ fontSize: '2rem', color: '#F87171', marginBottom: '1.5rem' }}>Report Generation Failed</h2>
                    <button onClick={onClose} style={styles.primaryButton}>Back To Home</button>
                </div>
            </div>
        );
    }

    return (
        <div style={styles.container}>
            <div style={styles.content}>
                <header style={styles.header}>
                    <h1 style={styles.title}>The Vibe Report</h1>
                    <p style={styles.subtitle}>Session analysis for {sessionId.slice(0, 8)}</p>
                </header>

                <div style={styles.glassCard}>
                    <div style={styles.scoreSection}>
                        <div style={styles.scoreRing}>
                            <svg width="180" height="180" viewBox="0 0 180 180" style={{ transform: 'rotate(-90deg)' }}>
                                <circle cx="90" cy="90" r="80" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
                                <circle
                                    cx="90"
                                    cy="90"
                                    r="80"
                                    fill="none"
                                    stroke="#FBBF24"
                                    strokeWidth="12"
                                    strokeDasharray={`${2 * Math.PI * 80}`}
                                    strokeDashoffset={`${2 * Math.PI * 80 * (1 - report.overall_score / 100)}`}
                                    strokeLinecap="round"
                                    style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                                />
                            </svg>
                            <div style={{ position: 'absolute' }}>
                                <span style={styles.scoreValue}>{report.overall_score}</span>
                            </div>
                        </div>
                        <h2 style={{ fontFamily: '"DM Sans","Inter",sans-serif', fontSize: '1.25rem', fontWeight: 700, margin: 0, color: '#F3F4F6', letterSpacing: '-0.01em' }}>Overall Performance</h2>
                    </div>

                    <div style={styles.statsGrid}>
                        <div style={styles.statCard}>
                            <div style={styles.statLabel}>Peak Heart Rate</div>
                            <div style={styles.statValue}>{peakHeartRate !== null ? peakHeartRate.toFixed(0) : '72'} <span style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>BPM</span></div>
                        </div>
                        <div style={styles.statCard}>
                            <div style={styles.statLabel}>Stress Events</div>
                            <div style={styles.statValue}>{report.stress_events}</div>
                        </div>
                        <div style={styles.statCard}>
                            <div style={styles.statLabel}>AI Corrections</div>
                            <div style={styles.statValue}>{report.barge_in_count}</div>
                        </div>
                    </div>
                </div>

                <div style={styles.glassCard}>
                    <h3 style={styles.sectionTitle}>
                        <span style={{ width: '28px', height: '28px', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: '0.625rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                        </span>
                        AI Insight
                    </h3>
                    <div style={styles.analysis}>{report.analysis}</div>
                    <div style={styles.summaryBox}>
                        <div style={styles.summaryTitle}>What You Discussed</div>
                        <div style={styles.summaryText}>{report.discussion_summary || 'Session summary is being prepared.'}</div>
                        {report.discussion_points && report.discussion_points.length > 0 && (
                            <ul style={styles.summaryList}>
                                {report.discussion_points.map((point, idx) => (
                                    <li key={idx}>{point}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
                    <div style={styles.glassCard}>
                        <h3 style={styles.sectionTitle}>
                            <span style={{ width: '28px', height: '28px', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: '0.625rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-hidden="true">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            </span>
                            Strengths
                        </h3>
                        <div style={styles.badgeList}>
                            {report.strengths.map((s, i) => (
                                <div key={i} style={styles.badge}>
                                    <div style={{ width: '28px', height: '28px', background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#34D399' }} aria-hidden="true">
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                    </div>
                                    <span style={{ fontSize: '0.9375rem', color: '#E5E7EB', lineHeight: 1.55, paddingTop: '0.125rem' }}>{s}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div style={styles.glassCard}>
                        <h3 style={styles.sectionTitle}>
                            <span style={{ width: '28px', height: '28px', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '0.625rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-hidden="true">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                            </span>
                            Improvements
                        </h3>
                        <div style={styles.badgeList}>
                            {report.improvements.map((s, i) => (
                                <div key={i} style={styles.badge}>
                                    <div style={{ width: '28px', height: '28px', background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FBBF24' }} aria-hidden="true">
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
                                    </div>
                                    <span style={{ fontSize: '0.9375rem', color: '#E5E7EB', lineHeight: 1.55, paddingTop: '0.125rem' }}>{s}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {report.futureVisualizationUrl && (
                    <div style={styles.glassCard}>
                        <h3 style={styles.sectionTitle}>
                            <span style={{ width: '28px', height: '28px', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '0.625rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-hidden="true">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            </span>
                            Future Visualization
                        </h3>
                        <div style={{ borderRadius: '1rem', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <img src={report.futureVisualizationUrl} alt="Future Visualization" style={{ width: '100%', display: 'block' }} />
                        </div>
                    </div>
                )}

                <div style={styles.buttonContainer}>
                    <button
                        style={styles.primaryButton}
                        onClick={onClose}
                        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = '0 0 20px rgba(251, 191, 36, 0.4)'; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
                    >
                        Back To Home
                    </button>
                    <button
                        style={{ ...styles.secondaryButton, opacity: whiteboardExport ? 1 : 0.55, cursor: whiteboardExport ? 'pointer' : 'not-allowed' }}
                        onClick={downloadWhiteboardData}
                        disabled={!whiteboardExport}
                    >
                        Download Whiteboard
                    </button>
                    <button
                        style={styles.secondaryButton}
                        onClick={() => window.print()}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                    >
                        Save PDF
                    </button>
                </div>
            </div>
        </div>
    );
}

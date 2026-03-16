'use client';

import { useEffect, useRef, useState } from 'react';
import 'katex/dist/katex.min.css';
import katex from 'katex';

export interface WhiteboardStep {
    id: number;
    subtopic_id?: string;
    narration: string;
    visual: {
        type: 'equation' | 'step_list' | 'diagram' | 'table' | 'none';
        content: any;
    };
}

interface WhiteboardProps {
    steps: WhiteboardStep[];
    archivedTopics: { id: string; steps: WhiteboardStep[] }[];
    currentStepId: number;
    title?: string;
    isArchivedMode?: boolean;
}

const AUTO_SCROLL_THRESHOLD = 40;
const DRAW_DIRECTIVE_REGEX = /^DRAW_[A-Z_]+$/;

const isDrawDirective = (line: string): boolean => DRAW_DIRECTIVE_REGEX.test((line || '').trim());

const normalizeTextLines = (input?: string): string[] => {
    if (!input) return [];

    const rawLines = input
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .filter(l => !isDrawDirective(l));

    const merged: string[] = [];
    for (let i = 0; i < rawLines.length; i += 1) {
        const current = rawLines[i];
        if (/^\d+$/.test(current) && i + 1 < rawLines.length && !/^\d+$/.test(rawLines[i + 1])) {
            merged.push(`${current}. ${rawLines[i + 1]}`);
            i += 1;
            continue;
        }
        merged.push(current);
    }

    const deduped: string[] = [];
    for (const line of merged) {
        if (!deduped.includes(line)) deduped.push(line);
    }
    return deduped;
};

const styles = {
    container: {
        flex: 1,
        minWidth: 0,
        background: 'rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '1.5rem',
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column' as const,
        overflow: 'hidden',
        height: '100%',
    },
    header: {
        fontSize: '0.75rem',
        color: '#FBBF24',
        fontWeight: 700,
        letterSpacing: '0.1em',
        marginBottom: '1rem',
        textTransform: 'uppercase' as const,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    scrollArea: {
        flex: 1,
        overflowY: 'auto' as const,
        overflowX: 'hidden' as const,
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '1rem',
        paddingRight: '0.5rem',
    },
    stepCard: {
        padding: '1rem',
        borderRadius: '1rem',
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        transition: 'all 0.25s ease',
        minWidth: 0,
        overflow: 'visible',
    },
    currentStep: {
        border: '1px solid rgba(251, 191, 36, 0.3)',
        background: 'rgba(251, 191, 36, 0.03)',
        boxShadow: '0 0 20px rgba(251, 191, 36, 0.1)',
    },
    dimmedStep: {
        opacity: 0.58,
    },
    visualContainer: {
        marginTop: '0.75rem',
        minWidth: 0,
        overflowX: 'auto' as const,
        overflowY: 'hidden' as const,
        paddingBottom: '0.25rem',
    },
    equation: {
        fontSize: '1rem',
        textAlign: 'left' as const,
        padding: '0.75rem',
        color: '#fff',
        overflowX: 'auto' as const,
        overflowY: 'hidden' as const,
        borderRadius: '0.65rem',
        background: 'rgba(0,0,0,0.22)',
    },
    stepList: {
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '0.5rem',
    },
    listItem: {
        display: 'flex',
        gap: '0.65rem',
        alignItems: 'flex-start',
        color: '#E5E7EB',
        fontSize: '0.92rem',
        lineHeight: 1.42,
    },
    listNumber: {
        width: '22px',
        height: '22px',
        borderRadius: '50%',
        background: 'rgba(251, 191, 36, 0.2)',
        color: '#FBBF24',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.72rem',
        fontWeight: 700,
        flexShrink: 0,
        marginTop: '0.1rem',
    },
    diagram: {
        width: '100%',
        minHeight: '120px',
        background: 'rgba(0,0,0,0.2)',
        borderRadius: '0.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflowX: 'auto' as const,
    },
    diagramHint: {
        color: '#9CA3AF',
        fontSize: '0.82rem',
        textAlign: 'center' as const,
        padding: '0.75rem',
    },
    keyPoints: {
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '0.4rem',
    },
    keyPoint: {
        color: '#E5E7EB',
        fontSize: '0.88rem',
        lineHeight: 1.45,
        wordBreak: 'break-word' as const,
        overflowWrap: 'anywhere' as const,
    },
    keyPointBullet: {
        color: '#FBBF24',
        marginRight: '0.45rem',
        fontWeight: 700,
    },
    longText: {
        marginTop: '0.6rem',
        whiteSpace: 'pre-wrap' as const,
        color: '#D1D5DB',
        fontSize: '0.82rem',
        lineHeight: 1.45,
        maxHeight: '220px',
        overflowY: 'auto' as const,
        borderTop: '1px solid rgba(255,255,255,0.08)',
        paddingTop: '0.6rem',
    },
    actionsRow: {
        marginTop: '0.65rem',
        display: 'flex',
        justifyContent: 'flex-end',
    },
    actionButton: {
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.06)',
        color: '#D1D5DB',
        fontSize: '0.75rem',
        padding: '0.375rem 0.75rem',
        borderRadius: '0.5rem',
        cursor: 'pointer',
        minHeight: '32px',
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: 'inherit',
    },
    jumpButton: {
        position: 'sticky' as const,
        bottom: '0.25rem',
        marginLeft: 'auto',
        padding: '0.5rem 0.875rem',
        borderRadius: '0.625rem',
        border: '1px solid rgba(251,191,36,0.35)',
        background: 'rgba(251,191,36,0.14)',
        color: '#FCD34D',
        fontSize: '0.75rem',
        cursor: 'pointer',
        zIndex: 5,
        minHeight: '36px',
        display: 'flex',
        alignItems: 'center',
        gap: '0.25rem',
        fontFamily: 'inherit',
        fontWeight: 600,
    },
};

export default function Whiteboard({ steps, archivedTopics, currentStepId, title = 'LEARNING SLATE' }: WhiteboardProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const shouldAutoScrollRef = useRef(true);

    const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
    const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
    const [showJumpToLatest, setShowJumpToLatest] = useState(false);

    useEffect(() => {
        if (scrollRef.current && shouldAutoScrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [steps, currentStepId]);

    const toggleTopic = (id: string) => {
        setExpandedTopics(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleStepExpansion = (id: number) => {
        setExpandedSteps(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleScroll = () => {
        const el = scrollRef.current;
        if (!el) return;

        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AUTO_SCROLL_THRESHOLD;
        shouldAutoScrollRef.current = nearBottom;
        setShowJumpToLatest(!nearBottom);
    };

    const jumpToLatest = () => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        shouldAutoScrollRef.current = true;
        setShowJumpToLatest(false);
    };

    const renderVisual = (visual: any) => {
        if (!visual || visual.type === 'none') return null;
        const parseDiagramContent = (content: any): { command: string; detail: string } => {
            if (!content) return { command: '', detail: '' };

            if (typeof content === 'string') {
                const trimmed = content.trim();
                if (!trimmed) return { command: '', detail: '' };
                const parts = trimmed.split(':', 2);
                const command = (parts[0] || '').trim();
                const detail = (parts[1] || '').trim();
                return { command, detail };
            }

            if (typeof content?.command === 'string') {
                return {
                    command: content.command.trim(),
                    detail: typeof content.detail === 'string' ? content.detail.trim() : '',
                };
            }

            return { command: '', detail: '' };
        };

        const { command: diagramCommand, detail: diagramDetail } = parseDiagramContent(visual.content);

        switch (visual.type) {
            case 'equation':
                try {
                    const html = katex.renderToString(visual.content, { throwOnError: false, displayMode: true });
                    return <div className="whiteboard-equation" style={styles.equation} dangerouslySetInnerHTML={{ __html: html }} />;
                } catch {
                    return <div style={styles.equation}>{String(visual.content ?? '')}</div>;
                }

            case 'step_list':
                {
                    const explicitSteps = Array.isArray(visual?.content?.steps)
                        ? visual.content.steps
                        : Array.isArray(visual?.steps)
                            ? visual.steps
                            : null;

                    const parsedFromText =
                        !explicitSteps && typeof visual?.content === 'string'
                            ? normalizeTextLines(visual.content)
                            : [];

                    const stepsToRender = (explicitSteps || parsedFromText)
                        .map((s: string) => String(s).trim())
                        .filter(Boolean)
                        .filter((s: string) => !isDrawDirective(s));

                    if (stepsToRender.length === 0) return null;

                    return (
                        <ul style={styles.stepList}>
                            {stepsToRender.map((step: string, i: number) => (
                                <li key={i} style={styles.listItem}>
                                    <div style={styles.listNumber}>{i + 1}</div>
                                    <span>{step}</span>
                                </li>
                            ))}
                        </ul>
                    );
                }

            case 'diagram':
                if (diagramCommand === 'DRAW_NUMBER_LINE') {
                    return (
                        <div>
                            <div style={styles.diagram}>
                                <svg width="100%" height="80" viewBox="0 0 400 80">
                                    <line x1="20" y1="40" x2="380" y2="40" stroke="#FBBF24" strokeWidth="2" markerEnd="url(#arrow)" />
                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                                        <g key={i}>
                                            <line x1={50 + i * 40} y1="35" x2={50 + i * 40} y2="45" stroke="#FBBF24" strokeWidth="1" />
                                            <text x={50 + i * 40} y="65" fill="#9CA3AF" fontSize="12" textAnchor="middle">{i}</text>
                                        </g>
                                    ))}
                                    <defs>
                                        <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                            <path d="M 0 0 L 10 5 L 0 10 z" fill="#FBBF24" />
                                        </marker>
                                    </defs>
                                </svg>
                            </div>
                            {diagramDetail && <div style={styles.diagramHint}>{diagramDetail}</div>}
                        </div>
                    );
                }
                if (diagramCommand === 'DRAW_COORDINATE_PLANE') {
                    return (
                        <div>
                            <div style={styles.diagram}>
                                <svg width="100%" height="180" viewBox="0 0 320 180">
                                    <line x1="20" y1="90" x2="300" y2="90" stroke="#6B7280" strokeWidth="1.5" />
                                    <line x1="160" y1="15" x2="160" y2="165" stroke="#6B7280" strokeWidth="1.5" />
                                    <line x1="300" y1="90" x2="292" y2="86" stroke="#6B7280" strokeWidth="1.5" />
                                    <line x1="300" y1="90" x2="292" y2="94" stroke="#6B7280" strokeWidth="1.5" />
                                    <line x1="160" y1="15" x2="156" y2="23" stroke="#6B7280" strokeWidth="1.5" />
                                    <line x1="160" y1="15" x2="164" y2="23" stroke="#6B7280" strokeWidth="1.5" />
                                    {[40, 80, 120, 200, 240, 280].map(x => (
                                        <line key={`x-${x}`} x1={x} y1="86" x2={x} y2="94" stroke="#9CA3AF" strokeWidth="1" />
                                    ))}
                                    {[30, 60, 120, 150].map(y => (
                                        <line key={`y-${y}`} x1="156" y1={y} x2="164" y2={y} stroke="#9CA3AF" strokeWidth="1" />
                                    ))}
                                </svg>
                            </div>
                            {diagramDetail && <div style={styles.diagramHint}>{diagramDetail}</div>}
                        </div>
                    );
                }
                if (diagramCommand === 'DRAW_BOXES_AND_ARROWS') {
                    const labels = (diagramDetail || '')
                        .split(',')
                        .map((s: string) => s.trim())
                        .filter(Boolean);

                    const steps = labels.map((label, i) => ({
                        label,
                        isLast: i === labels.length - 1
                    }));

                    return (
                        <div style={{ width: '100%' }}>
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 'clamp(0.25rem, 1.4vw, 0.4rem)',
                                padding: 'clamp(0.45rem, 2vw, 0.75rem)',
                                background: 'rgba(0,0,0,0.2)',
                                borderRadius: '0.5rem',
                                width: '100%',
                                boxSizing: 'border-box'
                            }}>
                                {steps.map((step, i) => (
                                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'clamp(0.2rem, 1vw, 0.3rem)', width: '100%' }}>
                                        <div style={{
                                            padding: 'clamp(0.35rem, 1.6vw, 0.55rem) clamp(0.5rem, 2vw, 0.8rem)',
                                            background: 'rgba(251,191,36,0.12)',
                                            border: '1px solid #FBBF24',
                                            borderRadius: '0.5rem',
                                            color: '#FDE68A',
                                            fontSize: 'clamp(0.62rem, 2.2vw, 0.82rem)',
                                            lineHeight: 1.3,
                                            textAlign: 'center',
                                            width: '100%',
                                            maxWidth: 'clamp(160px, 70vw, 260px)',
                                            wordBreak: 'break-word',
                                            overflowWrap: 'anywhere',
                                            boxSizing: 'border-box'
                                        }}>
                                            {step.label}
                                        </div>
                                        {!step.isLast && (
                                            <div style={{ color: '#FBBF24', fontSize: 'clamp(0.7rem, 2.4vw, 0.95rem)', fontWeight: 'bold' }}>↓</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                }

                return (
                    <div style={styles.diagram}>
                        <div style={styles.diagramHint}>{diagramDetail || 'Diagram rendered (details in text below).'}</div>
                    </div>
                );

            case 'table':
                if (!visual?.content?.headers || !visual?.content?.rows) return null;
                return (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ minWidth: '520px', width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
                            <thead>
                                <tr>
                                    {visual.content.headers.map((h: string, i: number) => (
                                        <th key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '0.5rem', textAlign: 'left', color: '#FBBF24', fontSize: '0.8rem' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {visual.content.rows.map((row: any[], i: number) => (
                                    <tr key={i}>
                                        {row.map((cell, j) => (
                                            <td key={j} style={{ padding: '0.5rem', color: '#E5E7EB', fontSize: '0.85rem' }}>{String(cell)}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );

            default:
                return null;
        }
    };

    const hasVisualContent = (visual: any): boolean => {
        if (!visual || visual.type === 'none') return false;
        if (visual.type === 'step_list') return Boolean(visual?.content?.steps?.length);
        if (visual.type === 'table') return Boolean(visual?.content?.headers?.length || visual?.content?.rows?.length);
        return true;
    };

    const extractKeyPoints = (text?: string): string[] => {
        if (!text) return [];

        const cleaned = text
            .replace(/\r/g, '')
            .replace(/```[\s\S]*?```/g, block => block.replace(/```/g, '').trim())
            .trim();

        if (!cleaned) return [];

        const lines = normalizeTextLines(cleaned);
        if (lines.length === 0) return [];

        const important = lines.filter(line => {
            const isBullet = /^[-*]|^\d+\./.test(line);
            const isFormula = /[=+\-*/^]|\\frac|\\sum|\\int|->|=>/.test(line);
            const isCode = /`|{|}|;|\b(def|function|const|let|class|if|for|while|return|SELECT|INSERT|UPDATE)\b/i.test(line);
            const isHeading = /^#{1,6}\s/.test(line);
            return isBullet || isFormula || isCode || isHeading;
        });

        const selected = (important.length > 0 ? important : lines).slice(0, 6);
        return selected.map(line => line.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s*/, '').trim());
    };

    const fallbackSummary = (text?: string): string => {
        if (!text) return '';
        const clean = text.replace(/\s+/g, ' ').trim();
        if (!clean) return '';
        const sentence = clean.split(/(?<=[.!?])\s+/)[0] || clean;
        return sentence.length > 180 ? `${sentence.slice(0, 177)}...` : sentence;
    };

    return (
        <div style={styles.container}>
            <style>{`
                .whiteboard-equation .katex-display {
                    margin: 0;
                    overflow-x: auto;
                    overflow-y: hidden;
                    padding-bottom: 0.2rem;
                }
                .whiteboard-equation .katex {
                    font-size: clamp(0.9rem, 1.6vw, 1.2rem);
                }
            `}</style>

            <div style={styles.header}>
                <span>{title}</span>
                {steps.length > 0 && (
                    <span style={{ opacity: 0.5, fontSize: '0.65rem' }}>{steps.length} STEPS</span>
                )}
            </div>

            <div ref={scrollRef} style={styles.scrollArea} onScroll={handleScroll}>
                {archivedTopics.length > 0 && (
                    <div style={{ marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.8rem' }}>
                        <div style={{ fontSize: '0.6875rem', color: '#9CA3AF', marginBottom: '0.65rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>Past Topics</div>
                        {archivedTopics.map((topic, idx) => (
                            <div key={idx} style={{ marginBottom: '0.45rem' }}>
                                <button
                                    onClick={() => toggleTopic(`topic-${idx}`)}
                                    aria-expanded={expandedTopics.has(`topic-${idx}`)}
                                    style={{
                                        width: '100%',
                                        padding: '0.55rem 0.85rem',
                                        background: 'rgba(255,255,255,0.03)',
                                        border: '1px solid rgba(255,255,255,0.05)',
                                        borderRadius: '0.5rem',
                                        color: '#9CA3AF',
                                        fontSize: '0.8rem',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        minHeight: '36px',
                                        fontFamily: 'inherit',
                                    }}
                                >
                                    <span>{topic.id}</span>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transition: 'transform 0.2s ease', transform: expandedTopics.has(`topic-${idx}`) ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}><path d="M9 18l6-6-6-6"/></svg>
                                </button>
                                {expandedTopics.has(`topic-${idx}`) && (
                                    <div style={{ marginTop: '0.5rem', paddingLeft: '0.5rem', borderLeft: '2px solid rgba(255,255,255,0.05)' }}>
                                        {topic.steps.map(s => (
                                            <div key={s.id} style={{ ...styles.stepCard, opacity: 0.6 }}>
                                                <div style={{ fontSize: '0.85rem', color: '#fff' }}>{s.narration}</div>
                                                <div style={{ ...styles.visualContainer }}>{renderVisual(s.visual)}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {steps.length === 0 ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280', fontSize: '0.9rem' }}>
                        Waiting for tutor instructions...
                    </div>
                ) : (
                    steps.map(step => {
                        const isCurrent = step.id === currentStepId;
                        const isPrevious = step.id < currentStepId;
                        const visualPresent = hasVisualContent(step.visual);
                        const keyPoints = extractKeyPoints(step.narration);
                        const showKeyPoints = !visualPresent && keyPoints.length > 0;
                        const summary = !visualPresent && keyPoints.length === 0 ? fallbackSummary(step.narration) : '';
                        const isExpanded = expandedSteps.has(step.id);

                        return (
                            <div
                                key={step.id}
                                style={{
                                    ...styles.stepCard,
                                    ...(isCurrent ? styles.currentStep : {}),
                                    ...(isPrevious ? styles.dimmedStep : {}),
                                }}
                            >
                                {showKeyPoints && (
                                    <ul style={styles.keyPoints}>
                                        {keyPoints.map((point, idx) => (
                                            <li key={idx} style={styles.keyPoint}>
                                                <span style={styles.keyPointBullet} aria-hidden="true">·</span>
                                                {point}
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                {!visualPresent && !showKeyPoints && summary && (
                                    <div style={styles.keyPoint}>{summary}</div>
                                )}

                                {visualPresent && (
                                    <div style={styles.visualContainer}>{renderVisual(step.visual)}</div>
                                )}

                                {!visualPresent && step.narration && (
                                    <div style={styles.actionsRow}>
                                        <button
                                            type="button"
                                            style={styles.actionButton}
                                            onClick={() => toggleStepExpansion(step.id)}
                                        >
                                            {isExpanded ? 'Hide Details' : 'Show Details'}
                                        </button>
                                    </div>
                                )}

                                {!visualPresent && isExpanded && <div style={styles.longText}>{step.narration}</div>}
                            </div>
                        );
                    })
                )}

                {showJumpToLatest && (
                    <button type="button" onClick={jumpToLatest} style={styles.jumpButton}>
                        Jump To Latest
                    </button>
                )}
            </div>
        </div>
    );
}

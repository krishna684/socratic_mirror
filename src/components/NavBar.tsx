'use client';

import { useState, useEffect, useRef } from 'react';
import { usePermissions, type PermissionChoice } from '@/context/PermissionContext';

interface NavBarProps {
    /** When provided, renders a Back button instead of the home logo. */
    onBack?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function permissionLabel(choice: PermissionChoice): string {
    switch (choice) {
        case 'granted':  return 'Enabled';
        case 'denied':   return 'Blocked by browser';
        case 'skipped':  return 'Skipped';
        default:         return 'Not set';
    }
}

function permissionColor(choice: PermissionChoice): string {
    switch (choice) {
        case 'granted':  return '#4ADE80';
        case 'denied':   return '#F87171';
        case 'skipped':  return '#9CA3AF';
        default:         return '#FBBF24';
    }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NavBar({ onBack }: NavBarProps) {
    const { mic, camera, requestMic, requestCamera, skipMic, skipCamera, resetPermissions } =
        usePermissions();
    const [panelOpen, setPanelOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const gearBtnRef = useRef<HTMLButtonElement>(null);

    // Close panel on ESC
    useEffect(() => {
        if (!panelOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setPanelOpen(false);
                gearBtnRef.current?.focus();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [panelOpen]);

    // Trap focus inside panel
    useEffect(() => {
        if (panelOpen) {
            const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            firstFocusable?.focus();
        }
    }, [panelOpen]);

    return (
        <>
            {/* ─── Top Bar ─── */}
            <nav
                role="navigation"
                aria-label="Main navigation"
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 200,
                    height: '56px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 1.25rem',
                    background: 'rgba(5, 5, 6, 0.85)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
            >
                {/* Left — Logo or Back */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {onBack ? (
                        <button
                            onClick={onBack}
                            aria-label="Go back to home"
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                background: 'transparent', border: 'none', cursor: 'pointer',
                                color: '#9CA3AF', fontSize: '0.875rem', fontFamily: 'inherit',
                                padding: '0.375rem 0.625rem',
                                borderRadius: '0.5rem',
                                transition: 'color 0.15s, background 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#E5E7EB'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = '#9CA3AF'; e.currentTarget.style.background = 'transparent'; }}
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M15 18l-6-6 6-6" />
                            </svg>
                            Home
                        </button>
                    ) : (
                        <a
                            href="/"
                            aria-label="Socratic Mirror — home"
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.625rem',
                                textDecoration: 'none', color: 'inherit',
                            }}
                        >
                            {/* Mirror icon */}
                            <div style={{
                                width: '28px', height: '28px',
                                borderRadius: '0.5rem',
                                background: 'rgba(251, 191, 36, 0.12)',
                                border: '1px solid rgba(251, 191, 36, 0.25)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0,
                            }} aria-hidden="true">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="8" r="6" />
                                    <path d="M8 14v8M16 14v8M5 22h14" />
                                </svg>
                            </div>
                            <span style={{
                                fontSize: '0.9375rem',
                                fontWeight: 700,
                                fontFamily: '"DM Sans", "Inter", sans-serif',
                                letterSpacing: '-0.01em',
                                color: '#F3F4F6',
                            }}>
                                Socratic Mirror
                            </span>
                        </a>
                    )}
                </div>

                {/* Right — Settings gear */}
                <button
                    ref={gearBtnRef}
                    onClick={() => setPanelOpen(v => !v)}
                    aria-label="Open permissions settings"
                    aria-expanded={panelOpen}
                    aria-haspopup="dialog"
                    style={{
                        width: '36px', height: '36px',
                        borderRadius: '0.625rem',
                        border: '1px solid rgba(255,255,255,0.08)',
                        background: panelOpen ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.04)',
                        color: panelOpen ? '#FBBF24' : '#9CA3AF',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.15s ease',
                        flexShrink: 0,
                    }}
                    onMouseEnter={e => { if (!panelOpen) { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#E5E7EB'; } }}
                    onMouseLeave={e => { if (!panelOpen) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#9CA3AF'; } }}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                    </svg>
                </button>
            </nav>

            {/* ─── Settings Panel ─── */}
            {panelOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        aria-hidden="true"
                        onClick={() => setPanelOpen(false)}
                        style={{
                            position: 'fixed', inset: 0,
                            background: 'rgba(5,5,6,0.5)',
                            backdropFilter: 'blur(4px)',
                            zIndex: 299,
                        }}
                    />

                    {/* Panel */}
                    <div
                        ref={panelRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="settings-panel-title"
                        style={{
                            position: 'fixed',
                            top: '64px',
                            right: '1rem',
                            width: 'min(360px, calc(100vw - 2rem))',
                            background: 'rgba(14, 14, 16, 0.96)',
                            backdropFilter: 'blur(24px)',
                            WebkitBackdropFilter: 'blur(24px)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '1.25rem',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
                            zIndex: 300,
                            overflow: 'hidden',
                        }}
                    >
                        {/* Panel header */}
                        <div style={{
                            padding: '1.125rem 1.25rem 0.875rem',
                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }}>
                            <h2 id="settings-panel-title" style={{
                                fontSize: '0.9375rem', fontWeight: 700,
                                fontFamily: '"DM Sans","Inter",sans-serif',
                                color: '#F3F4F6', letterSpacing: '-0.01em',
                                margin: 0,
                            }}>
                                Permissions
                            </h2>
                            <button
                                onClick={() => { setPanelOpen(false); gearBtnRef.current?.focus(); }}
                                aria-label="Close settings panel"
                                style={{
                                    width: '30px', height: '30px', borderRadius: '0.5rem',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    background: 'transparent', cursor: 'pointer',
                                    color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'all 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.color = '#E5E7EB'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                                onMouseLeave={e => { e.currentTarget.style.color = '#6B7280'; e.currentTarget.style.background = 'transparent'; }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                    <path d="M18 6 6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Permission rows */}
                        <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                            <PermissionRow
                                icon={<MicIcon />}
                                title="Microphone"
                                description="Enables voice interaction with your AI coach."
                                status={mic}
                                onAllow={requestMic}
                                onSkip={skipMic}
                            />
                            <PermissionRow
                                icon={<CameraIcon />}
                                title="Camera"
                                description="Optional — powers heart-rate and posture analysis."
                                status={camera}
                                onAllow={requestCamera}
                                onSkip={skipCamera}
                            />
                        </div>

                        {/* Reset link */}
                        <div style={{
                            padding: '0.625rem 1.25rem 1rem',
                            borderTop: '1px solid rgba(255,255,255,0.05)',
                        }}>
                            <button
                                onClick={resetPermissions}
                                style={{
                                    background: 'transparent', border: 'none', cursor: 'pointer',
                                    color: '#6B7280', fontSize: '0.8125rem',
                                    fontFamily: 'inherit', padding: '0.25rem 0',
                                    textDecoration: 'underline', textUnderlineOffset: '3px',
                                    transition: 'color 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.color = '#9CA3AF'; }}
                                onMouseLeave={e => { e.currentTarget.style.color = '#6B7280'; }}
                            >
                                Reset to defaults
                            </button>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// Permission Row sub-component
// ---------------------------------------------------------------------------

interface PermissionRowProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    status: PermissionChoice;
    onAllow: () => void | Promise<void>;
    onSkip: () => void;
}

function PermissionRow({ icon, title, description, status, onAllow, onSkip }: PermissionRowProps) {
    const [loading, setLoading] = useState(false);

    const handleAllow = async () => {
        setLoading(true);
        await onAllow();
        setLoading(false);
    };

    const isDone = status === 'granted' || status === 'denied';

    return (
        <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid',
            borderColor: status === 'granted'
                ? 'rgba(74,222,128,0.2)'
                : status === 'denied'
                    ? 'rgba(248,113,113,0.2)'
                    : 'rgba(255,255,255,0.07)',
            borderRadius: '0.875rem',
            padding: '0.875rem',
        }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.625rem' }}>
                <div style={{
                    width: '34px', height: '34px', borderRadius: '0.625rem',
                    background: 'rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                }} aria-hidden="true">
                    {icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.1rem' }}>
                        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#F3F4F6', fontFamily: '"DM Sans","Inter",sans-serif' }}>
                            {title}
                        </span>
                        <span style={{
                            fontSize: '0.6875rem', fontWeight: 600,
                            color: permissionColor(status),
                            textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>
                            {permissionLabel(status)}
                        </span>
                    </div>
                    <p style={{ fontSize: '0.8125rem', color: '#6B7280', margin: 0, lineHeight: 1.4 }}>
                        {description}
                    </p>
                </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                    onClick={handleAllow}
                    disabled={loading || status === 'granted'}
                    aria-label={`Allow ${title}`}
                    style={{
                        flex: 1, padding: '0.5rem 0.75rem',
                        borderRadius: '0.625rem',
                        border: '1px solid',
                        borderColor: status === 'granted' ? 'rgba(74,222,128,0.3)' : 'rgba(251,191,36,0.3)',
                        background: status === 'granted' ? 'rgba(74,222,128,0.08)' : 'rgba(251,191,36,0.08)',
                        color: status === 'granted' ? '#4ADE80' : '#FBBF24',
                        fontSize: '0.8125rem', fontWeight: 600,
                        cursor: status === 'granted' ? 'default' : 'pointer',
                        fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                        transition: 'all 0.15s',
                        opacity: loading ? 0.6 : 1,
                        minHeight: '36px',
                    }}
                    onMouseEnter={e => { if (status !== 'granted') { e.currentTarget.style.background = 'rgba(251,191,36,0.14)'; } }}
                    onMouseLeave={e => { if (status !== 'granted') { e.currentTarget.style.background = 'rgba(251,191,36,0.08)'; } }}
                >
                    {status === 'granted' ? (
                        <><CheckIcon />Enabled</>
                    ) : loading ? (
                        'Requesting…'
                    ) : (
                        'Allow'
                    )}
                </button>
                {status !== 'granted' && (
                    <button
                        onClick={onSkip}
                        aria-label={`Skip ${title}`}
                        style={{
                            flex: 1, padding: '0.5rem 0.75rem',
                            borderRadius: '0.625rem',
                            border: '1px solid rgba(255,255,255,0.07)',
                            background: status === 'skipped' ? 'rgba(255,255,255,0.06)' : 'transparent',
                            color: status === 'skipped' ? '#9CA3AF' : '#6B7280',
                            fontSize: '0.8125rem', fontWeight: 500,
                            cursor: 'pointer', fontFamily: 'inherit',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.15s',
                            minHeight: '36px',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#9CA3AF'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = status === 'skipped' ? 'rgba(255,255,255,0.06)' : 'transparent'; e.currentTarget.style.color = status === 'skipped' ? '#9CA3AF' : '#6B7280'; }}
                    >
                        {status === 'skipped' ? 'Skipped' : 'Skip'}
                    </button>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function MicIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="8" y1="22" x2="16" y2="22" />
        </svg>
    );
}

function CameraIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
    );
}

function CheckIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}

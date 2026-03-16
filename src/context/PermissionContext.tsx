'use client';

/**
 * PermissionContext — centralized mic + camera permission state.
 *
 * Persists choices to localStorage under key 'sm_permissions' so users
 * don't see the permission dialog on every visit.
 *
 * Usage:
 *   <PermissionProvider>...</PermissionProvider>
 *   const { mic, requestMic, skipMic } = usePermissions();
 */

import {
    createContext,
    useContext,
    useState,
    useEffect,
    type ReactNode,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionChoice = 'unknown' | 'granted' | 'denied' | 'skipped';

export interface PermissionState {
    mic: PermissionChoice;
    camera: PermissionChoice;
    /** Manually set a choice (e.g. after re-querying browser permission). */
    setMic: (c: PermissionChoice) => void;
    setCamera: (c: PermissionChoice) => void;
    /** Request mic via getUserMedia and update state accordingly. */
    requestMic: () => Promise<void>;
    /** Request camera via getUserMedia and update state accordingly. */
    requestCamera: () => Promise<void>;
    /** Mark mic as intentionally skipped. */
    skipMic: () => void;
    /** Mark camera as intentionally skipped. */
    skipCamera: () => void;
    /** Reset both choices back to 'unknown' (shows dialog again next time). */
    resetPermissions: () => void;
    /** True when the user has made a choice (grant OR skip) for mic. */
    hasDecidedMic: boolean;
    /** True when the user has made a choice (grant OR skip) for camera. */
    hasDecidedCamera: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const PermissionContext = createContext<PermissionState | null>(null);

const STORAGE_KEY = 'sm_permissions';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PermissionProvider({ children }: { children: ReactNode }) {
    const [mic, setMicState] = useState<PermissionChoice>('unknown');
    const [camera, setCameraState] = useState<PermissionChoice>('unknown');

    // Load persisted choices on first mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return;
            const { mic: m, camera: c } = JSON.parse(stored) as {
                mic?: PermissionChoice;
                camera?: PermissionChoice;
            };
            const valid: PermissionChoice[] = ['unknown', 'granted', 'denied', 'skipped'];
            if (m && valid.includes(m)) setMicState(m);
            if (c && valid.includes(c)) setCameraState(c);
        } catch {
            // Ignore parse errors — start fresh
        }
    }, []);

    // Persist to localStorage whenever choices change
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ mic, camera }));
        } catch {
            // Storage may be blocked — not fatal
        }
    }, [mic, camera]);

    // ---------------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------------

    const setMic = (c: PermissionChoice) => setMicState(c);
    const setCamera = (c: PermissionChoice) => setCameraState(c);

    const requestMic = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
            setMicState('granted');
        } catch {
            setMicState('denied');
        }
    };

    const requestCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(t => t.stop());
            setCameraState('granted');
        } catch {
            setCameraState('denied');
        }
    };

    const skipMic = () => setMicState('skipped');
    const skipCamera = () => setCameraState('skipped');

    const resetPermissions = () => {
        setMicState('unknown');
        setCameraState('unknown');
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch { /* ignore */ }
    };

    return (
        <PermissionContext.Provider
            value={{
                mic,
                camera,
                setMic,
                setCamera,
                requestMic,
                requestCamera,
                skipMic,
                skipCamera,
                resetPermissions,
                hasDecidedMic: mic !== 'unknown',
                hasDecidedCamera: camera !== 'unknown',
            }}
        >
            {children}
        </PermissionContext.Provider>
    );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePermissions(): PermissionState {
    const ctx = useContext(PermissionContext);
    if (!ctx) {
        throw new Error('usePermissions must be used inside <PermissionProvider>');
    }
    return ctx;
}

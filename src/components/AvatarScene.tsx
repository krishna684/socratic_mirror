'use client';

import { Suspense, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';
import AvatarModel from './AvatarModel';

interface AvatarSceneProps {
    expression?: 'neutral' | 'happy' | 'thinking' | 'concerned' | 'excited' | 'explaining';
    gesture?: 'idle' | 'greeting' | 'explaining' | 'pointing' | 'listening';
    isSpeaking?: boolean;
    speechEnergy?: number;
}

const styles = {
    container: {
        width: '100%',
        height: '100%',
        minHeight: 0,
        position: 'relative' as const,
        background:
            'radial-gradient(120% 120% at 50% 0%, rgba(29, 29, 29, 1) 0%, rgba(6, 6, 6, 1) 60%, rgba(0, 0, 0, 1) 100%)',
        borderRadius: '1.5rem',
        overflow: 'hidden',
    },
    canvas: {
        width: '100%',
        height: '100%',
    },
    statusIndicator: {
        position: 'absolute' as const,
        top: '1.2rem',
        left: '1.2rem',
        background: 'rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '0.75rem',
        padding: '0.6rem 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.7rem',
        zIndex: 2,
    },
    statusDot: {
        width: '10px',
        height: '10px',
        borderRadius: '50%',
    },
    statusText: {
        fontSize: '0.82rem',
        fontWeight: 600,
        color: '#fff',
    },
    expressionTag: {
        position: 'absolute' as const,
        bottom: '1.2rem',
        right: '1.2rem',
        background: 'rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '2rem',
        padding: '0.45rem 0.95rem',
        fontSize: '0.75rem',
        color: '#D1D5DB',
        textTransform: 'capitalize' as const,
        zIndex: 2,
    },
    fallback: {
        position: 'absolute' as const,
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#9CA3AF',
        fontSize: '0.9rem',
    },
};

export default function AvatarScene({ expression = 'neutral', gesture = 'idle', isSpeaking = false, speechEnergy }: AvatarSceneProps) {
    const derivedSpeaking = typeof speechEnergy === 'number' ? speechEnergy > 0.08 : isSpeaking;

    return (
        <div style={styles.container}>
            <div style={styles.statusIndicator}>
                <div
                    style={{
                        ...styles.statusDot,
                        background: derivedSpeaking ? '#34D399' : '#6B7280',
                        boxShadow: derivedSpeaking ? '0 0 12px rgba(52, 211, 153, 0.9)' : 'none',
                    }}
                />
                <span style={styles.statusText}>{derivedSpeaking ? 'Speaking' : 'Listening'}</span>
            </div>

            <div style={styles.expressionTag}>{expression}</div>

            <Canvas
                style={styles.canvas}
                camera={{ position: [0, 1.1, 1.75], fov: 24 }}
                gl={{ antialias: true, alpha: true }}
                dpr={[1, 1.8]}
            >
                <CameraAim />
                <ambientLight intensity={0.65} />
                <directionalLight position={[1.5, 2.5, 2.2]} intensity={1.2} color="#fff4d8" />
                <directionalLight position={[-1.2, 1.6, 1.2]} intensity={0.55} color="#dbeafe" />
                <Suspense fallback={null}>
                    <AvatarModel expression={expression} gesture={gesture} isSpeaking={derivedSpeaking} speechEnergy={speechEnergy} />
                    <Environment preset="city" />
                </Suspense>
            </Canvas>

            <noscript>
                <div style={styles.fallback}>Avatar requires JavaScript enabled.</div>
            </noscript>
        </div>
    );
}

function CameraAim() {
    const { camera, size } = useThree();

    useEffect(() => {
        const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 1;
        if (aspect < 1) {
            camera.position.set(0, 1.05, 1.55);
        } else {
            camera.position.set(0, 1.1, 1.75);
        }
        camera.lookAt(0, 0.95, 0);

        if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
            const persp = camera as THREE.PerspectiveCamera;
            persp.fov = aspect < 1 ? 26 : 23;
        }
        camera.updateProjectionMatrix();
    }, [camera, size.height, size.width]);

    return null;
}

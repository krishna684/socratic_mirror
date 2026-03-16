'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Viseme types & module-level channel
// ---------------------------------------------------------------------------

/** The five mouth shapes used in the viseme system. */
export type VisemeLabel = 'A' | 'O' | 'M' | 'FV' | 'L';

/** A single timed viseme event in an audio-aligned timeline. */
export interface VisemeEvent {
    /** Seconds from the start of the TTS audio clip. */
    time: number;
    viseme: VisemeLabel;
}

// Module-level state — lives outside React so any component can write to it
// without props drilling or context changes to AvatarScene.tsx.
let _visemeTimeline: VisemeEvent[] = [];
let _visemeStartTime = 0;   // performance.now() snapshot when timeline was loaded
let _lastVisemeIndex = 0;   // scan-cache: avoids scanning from index 0 every frame

/**
 * Load a new viseme timeline and start playing it immediately.
 * Call this at the moment TTS audio begins playing.
 *
 * @param timeline Array of {time, viseme} events — need not be pre-sorted.
 */
export function setVisemeTimeline(timeline: VisemeEvent[]): void {
    _visemeTimeline = timeline.slice().sort((a, b) => a.time - b.time);
    _visemeStartTime = typeof performance !== 'undefined' ? performance.now() : 0;
    _lastVisemeIndex = 0;
}

/**
 * Clear the active timeline (e.g. when speech ends or is interrupted).
 * The avatar falls back to energy-based lip sync automatically.
 */
export function clearVisemeTimeline(): void {
    _visemeTimeline = [];
    _visemeStartTime = 0;
    _lastVisemeIndex = 0;
}

// ---------------------------------------------------------------------------
// Viseme → RPM morph target mapping  (module-level constant — zero allocations)
// ---------------------------------------------------------------------------

type VisemeMorphEntry = { names: string[]; value: number };
type VisemeMorphMap = Record<VisemeLabel, VisemeMorphEntry[]>;

/**
 * Maps each viseme label to the ARKit morph target names it drives and their
 * peak influence values.  Both camelCase and lowercase aliases are listed so
 * normalizedMorphDictionary lookups succeed regardless of RPM export variant.
 */
const VISEME_MORPHS: VisemeMorphMap = {
    // A  — open vowel (ah / ay / æ)
    A: [
        { names: ['jawOpen',    'jawopen'],    value: 0.70 },
        { names: ['mouthOpen',  'mouthopen'],  value: 0.50 },
    ],
    // O  — rounded vowel (oh / oo / uw)
    O: [
        { names: ['mouthFunnel', 'mouthfunnel'], value: 0.60 },
        { names: ['mouthPucker', 'mouthpucker'], value: 0.40 },
    ],
    // M  — bilabial close (m / b / p)
    M: [
        { names: ['mouthClose', 'mouthclose'], value: 0.80 },
    ],
    // FV — labiodental (f / v)
    FV: [
        { names: ['mouthPressLeft',  'mouthpressleft'],  value: 0.50 },
        { names: ['mouthPressRight', 'mouthpressright'], value: 0.50 },
    ],
    // L  — alveolar / dental (l / d / t / n)
    L: [
        { names: ['mouthSmileLeft',  'mouthsmileleft'],  value: 0.40 },
        { names: ['mouthSmileRight', 'mouthsmileright'], value: 0.40 },
    ],
};

// ---------------------------------------------------------------------------
// AvatarModel types
// ---------------------------------------------------------------------------

interface AvatarModelProps {
    expression: 'neutral' | 'happy' | 'thinking' | 'concerned' | 'excited' | 'explaining';
    gesture: 'idle' | 'greeting' | 'explaining' | 'pointing' | 'listening';
    isSpeaking: boolean;
    speechEnergy?: number;
}

type MorphMesh = THREE.Mesh & {
    morphTargetDictionary?: { [key: string]: number };
    morphTargetInfluences?: number[];
};

type MorphTargetMap = {
    [name: string]: number;
};

type RigBone = {
    bone: THREE.Bone;
    rest: THREE.Quaternion;
};

type ArmRig = {
    upper?: RigBone;
    lower?: RigBone;
    hand?: RigBone;
};

type AvatarRig = {
    head?: RigBone;
    neck?: RigBone;
    spine?: RigBone;
    chest?: RigBone;
    left: ArmRig;
    right: ArmRig;
};

const RPM_AVATAR_URL =
    process.env.NEXT_PUBLIC_RPM_AVATAR_URL ||
    '/avatars/6986dfdd47a75ab0c820deb2.glb';
const RPM_MORPH_TARGETS = process.env.NEXT_PUBLIC_RPM_MORPH_TARGETS || 'ARKit';

const _tmpEuler = new THREE.Euler();
const _tmpQuat = new THREE.Quaternion();
const _targetQuat = new THREE.Quaternion();

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AvatarModel({ expression, gesture, isSpeaking, speechEnergy }: AvatarModelProps) {
    const groupRef = useRef<THREE.Group>(null);
    const mixerRef = useRef<THREE.AnimationMixer | null>(null);
    const animationActionsRef = useRef<THREE.AnimationAction[]>([]);
    const rigRef = useRef<AvatarRig | null>(null);
    const speechEnergyRef = useRef(0);
    const visemePhaseRef = useRef(Math.random() * Math.PI * 2);

    // Eye motion state — persists across frames
    const eyeOffsetRef = useRef({ x: 0, y: 0 });
    const saccadeTargetRef = useRef({ x: 0, y: 0 });
    const lastSaccadeTimeRef = useRef(0);

    const avatarUrl = useMemo(() => buildAvatarUrl(RPM_AVATAR_URL), []);
    const gltf = useLoader(GLTFLoader, avatarUrl);

    const morphMeshes = useMemo<MorphMesh[]>(() => {
        if (!gltf?.scene) return [];
        const meshes: MorphMesh[] = [];
        gltf.scene.traverse((child) => {
            const mesh = child as MorphMesh;
            if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
                meshes.push(mesh);
            }
        });
        return meshes;
    }, [gltf]);

    useEffect(() => {
        if (!gltf?.scene) return;
        rigRef.current = buildAvatarRig(gltf.scene);
    }, [gltf]);

    useEffect(() => {
        if (!gltf?.scene || !gltf?.animations?.length) return;
        const mixer = new THREE.AnimationMixer(gltf.scene);
        mixerRef.current = mixer;

        const idleLikeClips = gltf.animations.filter((clip) =>
            /(idle|breath|breathe|standing|talk|listen)/i.test(clip.name || '')
        );

        animationActionsRef.current = idleLikeClips.map((clip) => {
            const action = mixer.clipAction(clip);
            action.play();
            action.setEffectiveWeight(0.22);
            return action;
        });

        return () => {
            animationActionsRef.current.forEach((action) => action.stop());
            mixer.stopAllAction();
            mixerRef.current = null;
        };
    }, [gltf]);

    useFrame((state, delta) => {
        if (!groupRef.current) return;
        if (mixerRef.current) mixerRef.current.update(delta);

        const t = state.clock.elapsedTime;

        // Smooth speech energy with damping
        const targetEnergy = typeof speechEnergy === 'number'
            ? THREE.MathUtils.clamp(speechEnergy, 0, 1)
            : (isSpeaking ? 1 : 0);
        speechEnergyRef.current = THREE.MathUtils.damp(
            speechEnergyRef.current,
            targetEnergy,
            6,
            delta,
        );
        const e = speechEnergyRef.current;

        // Auto-upgrade gesture to explaining when actively speaking above threshold
        const effectiveGesture = gesture === 'idle' && e > 0.45 ? 'explaining' : gesture;

        // Viseme phase advances faster during speech (used by energy-based fallback)
        visemePhaseRef.current += delta * (6 + e * 9);

        // Dynamic lerp alpha — faster blending for expressive and speaking states
        const isExpressive = expression === 'happy' || expression === 'excited' || expression === 'concerned';
        const lerpAlpha = isExpressive ? 0.3 : e > 0.1 ? 0.22 : 0.15;

        // Breathing — subtle scale pulse
        const breathe = 1 + 0.015 * Math.sin(t * 1.6);
        groupRef.current.scale.set(1, breathe, 1);

        applyHeadAndTorsoMotion(groupRef.current, effectiveGesture, expression, t, e);
        applyRigGesture(rigRef.current, effectiveGesture, t, e);
        applyChestMotion(rigRef.current, t, e);
        applyExpressionMorphs(morphMeshes, expression, t, e, lerpAlpha);
        applyLipSync(morphMeshes, e, visemePhaseRef.current, t);
        applyEyeMotion(
            morphMeshes, expression, e, t,
            eyeOffsetRef, lastSaccadeTimeRef, saccadeTargetRef,
        );
    });

    useEffect(() => {
        if (groupRef.current) {
            groupRef.current.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                    const mesh = child as THREE.Mesh;
                    mesh.frustumCulled = false;
                    mesh.renderOrder = 0;

                    if (mesh.material) {
                        const mat = mesh.material as THREE.MeshStandardMaterial;
                        mat.transparent = false;
                        mat.opacity = 1.0;
                        mat.depthWrite = true;
                        mat.depthTest = true;
                        mat.side = THREE.FrontSide;
                        mat.color.setHex(0xffffff);
                        mat.needsUpdate = true;
                    }
                }
            });
        }
    }, [gltf]);

    return (
        <group ref={groupRef}>
            <primitive object={gltf.scene} position={[0, -0.9, 0]} scale={1.2} />
        </group>
    );
}

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

function buildAvatarUrl(url: string): string {
    if (typeof window === 'undefined') return url;
    try {
        const absolute = url.startsWith('http')
            ? url
            : `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
        const parsed = new URL(absolute);
        if (!parsed.searchParams.has('morphTargets')) {
            parsed.searchParams.set('morphTargets', RPM_MORPH_TARGETS);
        }
        return parsed.toString();
    } catch {
        return url;
    }
}

// ---------------------------------------------------------------------------
// Head & torso procedural motion
// ---------------------------------------------------------------------------

function applyHeadAndTorsoMotion(
    group: THREE.Group,
    gesture: string,
    expression: string,
    t: number,
    speechEnergy: number,
) {
    const exciteAmp = expression === 'excited' ? 1.5 : 1.0;

    const idleYaw = Math.sin(t * 0.35) * 0.035;
    const speechNod = speechEnergy * Math.sin(t * 5.5) * 0.02;

    let rotX = speechNod;
    let rotY = idleYaw * exciteAmp;
    let rotZ = 0;

    switch (gesture) {
        case 'explaining':
            rotX += Math.sin(t * 1.5) * 0.04 + speechEnergy * Math.sin(t * 4.0) * 0.025;
            rotY += Math.sin(t * 0.6) * 0.025 * exciteAmp;
            break;
        case 'thinking':
            rotZ = Math.sin(t * 0.4) * 0.07;
            rotX += 0.02;
            break;
        case 'listening':
            rotX += -0.02 + speechEnergy * Math.sin(t * 3.5) * 0.015;
            break;
        case 'pointing':
            rotY += 0.1;
            break;
        case 'greeting':
            rotY += Math.sin(t * 1.7) * 0.06 * exciteAmp;
            break;
    }

    if (expression === 'thinking' && gesture !== 'thinking') {
        rotZ += Math.sin(t * 0.4) * 0.04;
    }
    if (expression === 'excited' && (gesture === 'idle' || gesture === 'explaining')) {
        rotX += Math.sin(t * 2.5) * 0.02;
    }

    group.rotation.x = rotX;
    group.rotation.y = rotY;
    group.rotation.z = rotZ;
}

// ---------------------------------------------------------------------------
// Rig gesture (hand gestures disabled per user request)
// ---------------------------------------------------------------------------

function applyRigGesture(
    rig: AvatarRig | null,
    gesture: string,
    t: number,
    speechEnergy: number,
) {
    if (!rig) return;
    return;
}

// ---------------------------------------------------------------------------
// Chest bone motion (breathing + speech expansion)
// ---------------------------------------------------------------------------

function applyChestMotion(rig: AvatarRig | null, t: number, speechEnergy: number) {
    if (!rig?.chest) return;
    const breatheX = 0.012 * Math.sin(t * 1.6);
    const speechShift = speechEnergy * 0.018 * Math.sin(t * 2.2);
    applyBoneOffset(rig.chest, breatheX + speechShift, 0, 0, 0.08);
}

// ---------------------------------------------------------------------------
// Facial expression morphs
// ---------------------------------------------------------------------------

function applyExpressionMorphs(
    meshes: MorphMesh[],
    expression: string,
    t: number,
    speechEnergy: number,
    lerpAlpha: number,
) {
    const blinkPulse = Math.max(0, Math.sin(t * 0.9 + 1.7));
    const blinkValue = blinkPulse > 0.985
        ? THREE.MathUtils.mapLinear(blinkPulse, 0.985, 1, 0, 1)
        : 0;

    for (const mesh of meshes) {
        const dict = normalizedMorphDictionary(mesh);
        const influences = mesh.morphTargetInfluences;
        if (!dict || !influences) continue;

        relaxAll(influences, 0.15);

        setIfExists(influences, dict, ['eyeBlinkLeft',  'eyeblinkleft',  'blinkleft'],  blinkValue, 0.45);
        setIfExists(influences, dict, ['eyeBlinkRight', 'eyeblinkright', 'blinkright'], blinkValue, 0.45);

        const speakSmile = speechEnergy * 0.12;
        setIfExists(influences, dict, ['mouthSmile',      'mouthsmileleft'],  speakSmile, lerpAlpha);
        setIfExists(influences, dict, ['mouthSmileRight', 'mouthsmileright'], speakSmile, lerpAlpha);

        switch (expression) {
            case 'happy':
                setIfExists(influences, dict, ['mouthSmile',      'mouthsmileleft'],    0.65, lerpAlpha);
                setIfExists(influences, dict, ['mouthSmileRight', 'mouthsmileright'],   0.65, lerpAlpha);
                setIfExists(influences, dict, ['cheekSquintLeft',  'cheeksquintleft'],  0.35, lerpAlpha);
                setIfExists(influences, dict, ['cheekSquintRight', 'cheeksquintright'], 0.35, lerpAlpha);
                setIfExists(influences, dict, ['eyeWideLeft',  'eyewideleft'],  0.08, lerpAlpha);
                setIfExists(influences, dict, ['eyeWideRight', 'eyewideright'], 0.08, lerpAlpha);
                break;

            case 'excited':
                setIfExists(influences, dict, ['mouthSmile',      'mouthsmileleft'],    0.75, lerpAlpha);
                setIfExists(influences, dict, ['mouthSmileRight', 'mouthsmileright'],   0.75, lerpAlpha);
                setIfExists(influences, dict, ['cheekSquintLeft',  'cheeksquintleft'],  0.45, lerpAlpha);
                setIfExists(influences, dict, ['cheekSquintRight', 'cheeksquintright'], 0.45, lerpAlpha);
                setIfExists(influences, dict, ['eyeWideLeft',  'eyewideleft'],  0.28, lerpAlpha);
                setIfExists(influences, dict, ['eyeWideRight', 'eyewideright'], 0.28, lerpAlpha);
                setIfExists(influences, dict, ['browInnerUp',  'browinnerup'],  0.28, lerpAlpha);
                break;

            case 'thinking':
                setIfExists(influences, dict, ['browInnerUp',      'browinnerup'],       0.45, lerpAlpha);
                setIfExists(influences, dict, ['mouthPressLeft',  'mouthpressleft'],  0.32, lerpAlpha);
                setIfExists(influences, dict, ['mouthPressRight', 'mouthpressright'], 0.32, lerpAlpha);
                break;

            case 'concerned':
                setIfExists(influences, dict, ['browDownLeft',   'browdownleft'],    0.55, lerpAlpha);
                setIfExists(influences, dict, ['browDownRight',  'browdownright'],   0.55, lerpAlpha);
                setIfExists(influences, dict, ['mouthFrownLeft',  'mouthfrownleft'],  0.42, lerpAlpha);
                setIfExists(influences, dict, ['mouthFrownRight', 'mouthfrownright'], 0.42, lerpAlpha);
                break;

            case 'explaining':
                setIfExists(influences, dict, ['browInnerUp',     'browinnerup'],        0.25, lerpAlpha);
                setIfExists(influences, dict, ['mouthSmile',      'mouthsmileleft'],     0.22, lerpAlpha);
                setIfExists(influences, dict, ['mouthSmileRight', 'mouthsmileright'],    0.22, lerpAlpha);
                setIfExists(influences, dict, ['eyeWideLeft',  'eyewideleft'],  0.12, lerpAlpha);
                setIfExists(influences, dict, ['eyeWideRight', 'eyewideright'], 0.12, lerpAlpha);
                break;

            case 'neutral':
            default:
                break;
        }
    }
}

// ---------------------------------------------------------------------------
// Lip sync — viseme-based with energy-based fallback
// ---------------------------------------------------------------------------

/**
 * Main lip sync dispatcher.
 *
 * Path A (viseme): when a timeline has been loaded via setVisemeTimeline() and
 *   speech energy is above threshold, drives morph targets from the timeline.
 *
 * Path B (energy fallback): when no timeline is present, uses the original
 *   three-oscillator procedural system so the avatar still animates for
 *   energy-only sources (WebRTC mic level, etc.).
 */
function applyLipSync(
    meshes: MorphMesh[],
    speechEnergy: number,
    visemePhase: number,
    t: number,
) {
    const hasTimeline = _visemeTimeline.length > 0 && speechEnergy > 0.05;

    if (hasTimeline) {
        applyVisemeLipSync(meshes, speechEnergy);
    } else {
        applyEnergyLipSync(meshes, speechEnergy, visemePhase, t);
    }
}

/** Viseme path — reads the module-level timeline and drives morph targets. */
function applyVisemeLipSync(meshes: MorphMesh[], speechEnergy: number) {
    const playbackTime = _visemeStartTime > 0
        ? (performance.now() - _visemeStartTime) / 1000
        : 0;

    const activeViseme = findActiveViseme(playbackTime);

    for (const mesh of meshes) {
        const dict = normalizedMorphDictionary(mesh);
        const influences = mesh.morphTargetInfluences;
        if (!dict || !influences) continue;

        if (activeViseme !== null) {
            applyVisemeMorphs(influences, dict, activeViseme, speechEnergy);
        }
        // When activeViseme is null (between events / after end) the morph
        // targets relax naturally via the relaxAll() call in applyExpressionMorphs.
    }
}

/**
 * Energy-based fallback — identical to the original procedural system.
 * Used when no viseme timeline has been loaded.
 */
function applyEnergyLipSync(
    meshes: MorphMesh[],
    speechEnergy: number,
    visemePhase: number,
    t: number,
) {
    const cadence    = 0.5 + 0.5 * Math.sin(visemePhase);
    const altCadence = 0.5 + 0.5 * Math.sin(visemePhase * 0.83 + 0.9);
    const closedBeat = 0.5 + 0.5 * Math.sin(t * 8.4 + 2.2);

    const jawTarget    = speechEnergy * (0.15 + cadence    * 0.55);
    const openTarget   = speechEnergy * (0.12 + altCadence * 0.45);
    const funnelTarget = speechEnergy * (0.05 + (1 - cadence)    * 0.35);
    const puckerTarget = speechEnergy * (0.04 + (1 - altCadence) * 0.30);
    const closeTarget  = (1 - speechEnergy) * 0.1 + speechEnergy * closedBeat * 0.05;

    for (const mesh of meshes) {
        const dict = normalizedMorphDictionary(mesh);
        const influences = mesh.morphTargetInfluences;
        if (!dict || !influences) continue;

        setIfExists(influences, dict, ['jawOpen',    'jawopen'],    jawTarget,    0.35);
        setIfExists(influences, dict, ['mouthOpen',  'mouthopen'],  openTarget,   0.32);
        setIfExists(influences, dict, ['mouthFunnel','mouthfunnel'], funnelTarget, 0.28);
        setIfExists(influences, dict, ['mouthPucker','mouthpucker'], puckerTarget, 0.26);
        setIfExists(influences, dict, ['mouthClose', 'mouthclose'],  closeTarget,  0.24);
    }
}

// ---------------------------------------------------------------------------
// Viseme helpers
// ---------------------------------------------------------------------------

/**
 * Returns the currently active viseme label for the given playback time.
 *
 * Uses a forward-only scan cache (_lastVisemeIndex) so most frames cost O(1).
 * Returns null before the first event, between events after a 0.3 s hold, and
 * after the last event + hold.
 */
function findActiveViseme(playbackTime: number): VisemeLabel | null {
    const timeline = _visemeTimeline;
    if (timeline.length === 0) return null;

    // Guard against timeline reset (index out of range)
    if (_lastVisemeIndex >= timeline.length) _lastVisemeIndex = 0;

    // Advance cached index forward while the next event has arrived
    while (
        _lastVisemeIndex + 1 < timeline.length &&
        timeline[_lastVisemeIndex + 1].time <= playbackTime
    ) {
        _lastVisemeIndex++;
    }

    const event = timeline[_lastVisemeIndex];

    // Haven't reached the first event yet
    if (event.time > playbackTime) return null;

    // Hold the last viseme for 0.3 s after its timestamp, then relax
    const isLast = _lastVisemeIndex === timeline.length - 1;
    if (isLast && playbackTime > event.time + 0.3) return null;

    return event.viseme;
}

/**
 * Drives the morph targets for a single viseme label on one mesh.
 * All target values are scaled by speechEnergy so intensity tracks loudness.
 * Lerp alpha 0.35 matches the jaw responsiveness of the energy-based path.
 */
function applyVisemeMorphs(
    influences: number[],
    dict: MorphTargetMap,
    viseme: VisemeLabel,
    speechEnergy: number,
) {
    const entries = VISEME_MORPHS[viseme];
    for (let i = 0; i < entries.length; i++) {
        const { names, value } = entries[i];
        setIfExists(influences, dict, names, value * speechEnergy, 0.35);
    }
}

// ---------------------------------------------------------------------------
// Eye motion — micro saccades, speaking focus, thinking drift
// ---------------------------------------------------------------------------

function applyEyeMotion(
    meshes: MorphMesh[],
    expression: string,
    speechEnergy: number,
    t: number,
    eyeOffsetRef: { current: { x: number; y: number } },
    lastSaccadeTimeRef: { current: number },
    saccadeTargetRef: { current: { x: number; y: number } },
) {
    if (speechEnergy < 0.15 && t - lastSaccadeTimeRef.current > 2.0) {
        lastSaccadeTimeRef.current = t;
        saccadeTargetRef.current = {
            x: (Math.random() - 0.5) * 0.25,
            y: (Math.random() - 0.5) * 0.12,
        };
    }

    if (speechEnergy > 0.3) {
        saccadeTargetRef.current.x = THREE.MathUtils.lerp(saccadeTargetRef.current.x, 0, 0.05);
        saccadeTargetRef.current.y = THREE.MathUtils.lerp(saccadeTargetRef.current.y, 0, 0.05);
    }

    if (expression === 'thinking') {
        saccadeTargetRef.current.y = THREE.MathUtils.lerp(saccadeTargetRef.current.y, 0.18, 0.02);
    }

    eyeOffsetRef.current.x = THREE.MathUtils.lerp(eyeOffsetRef.current.x, saccadeTargetRef.current.x, 0.08);
    eyeOffsetRef.current.y = THREE.MathUtils.lerp(eyeOffsetRef.current.y, saccadeTargetRef.current.y, 0.08);

    const ox = eyeOffsetRef.current.x;
    const oy = eyeOffsetRef.current.y;

    for (const mesh of meshes) {
        const dict = normalizedMorphDictionary(mesh);
        const influences = mesh.morphTargetInfluences;
        if (!dict || !influences) continue;

        if (ox >= 0) {
            setIfExists(influences, dict, ['eyeLookInLeft',   'eyelookinleft'],   ox * 0.6, 0.12);
            setIfExists(influences, dict, ['eyeLookOutRight',  'eyelookoutright'], ox * 0.6, 0.12);
            setIfExists(influences, dict, ['eyeLookOutLeft',   'eyelookoutleft'],  0,        0.12);
            setIfExists(influences, dict, ['eyeLookInRight',   'eyelookinright'],  0,        0.12);
        } else {
            const ax = -ox;
            setIfExists(influences, dict, ['eyeLookOutLeft',  'eyelookoutleft'],  ax * 0.6, 0.12);
            setIfExists(influences, dict, ['eyeLookInRight',  'eyelookinright'],  ax * 0.6, 0.12);
            setIfExists(influences, dict, ['eyeLookInLeft',   'eyelookinleft'],   0,        0.12);
            setIfExists(influences, dict, ['eyeLookOutRight', 'eyelookoutright'], 0,        0.12);
        }

        if (oy >= 0) {
            setIfExists(influences, dict, ['eyeLookUpLeft',    'eyelookupleft'],    oy * 0.8, 0.12);
            setIfExists(influences, dict, ['eyeLookUpRight',   'eyelookupright'],   oy * 0.8, 0.12);
            setIfExists(influences, dict, ['eyeLookDownLeft',  'eyelookdownleft'],  0,        0.12);
            setIfExists(influences, dict, ['eyeLookDownRight', 'eyelookdownright'], 0,        0.12);
        } else {
            const ay = -oy;
            setIfExists(influences, dict, ['eyeLookDownLeft',  'eyelookdownleft'],  ay * 0.8, 0.12);
            setIfExists(influences, dict, ['eyeLookDownRight', 'eyelookdownright'], ay * 0.8, 0.12);
            setIfExists(influences, dict, ['eyeLookUpLeft',    'eyelookupleft'],    0,        0.12);
            setIfExists(influences, dict, ['eyeLookUpRight',   'eyelookupright'],   0,        0.12);
        }
    }
}

// ---------------------------------------------------------------------------
// Rig builder
// ---------------------------------------------------------------------------

function buildAvatarRig(scene: THREE.Object3D): AvatarRig | null {
    const bones: THREE.Bone[] = [];
    scene.traverse((obj) => {
        if (obj instanceof THREE.Bone) bones.push(obj);
    });
    if (bones.length === 0) return null;

    const used = new Set<THREE.Bone>();
    const pick = (...aliases: string[]): RigBone | undefined => {
        for (const alias of aliases) {
            const aliasLower = alias.toLowerCase();
            const bone = bones.find((b) => !used.has(b) && b.name.toLowerCase().includes(aliasLower));
            if (bone) {
                used.add(bone);
                return { bone, rest: bone.quaternion.clone() };
            }
        }
        return undefined;
    };

    return {
        head:  pick('head'),
        neck:  pick('neck'),
        chest: pick('upperchest', 'chest', 'spine2', 'spine_03', 'spine003'),
        spine: pick('spine1', 'spine', 'spine_02', 'spine002'),
        left: {
            upper: pick('leftupperarm', 'leftarm'),
            lower: pick('leftforearm', 'leftlowerarm'),
            hand:  pick('lefthand'),
        },
        right: {
            upper: pick('rightupperarm', 'rightarm'),
            lower: pick('rightforearm', 'rightlowerarm'),
            hand:  pick('righthand'),
        },
    };
}

// ---------------------------------------------------------------------------
// Bone offset helper (quaternion slerp)
// ---------------------------------------------------------------------------

function applyBoneOffset(
    rigBone: RigBone | undefined,
    x: number,
    y: number,
    z: number,
    blend: number,
) {
    if (!rigBone) return;
    _tmpEuler.set(x, y, z, 'XYZ');
    _tmpQuat.setFromEuler(_tmpEuler);
    _targetQuat.copy(rigBone.rest).multiply(_tmpQuat);
    rigBone.bone.quaternion.slerp(_targetQuat, blend);
}

// ---------------------------------------------------------------------------
// Morph target helpers
// ---------------------------------------------------------------------------

function normalizedMorphDictionary(mesh: MorphMesh): MorphTargetMap | null {
    const source = mesh.morphTargetDictionary;
    if (!source) return null;
    const out: MorphTargetMap = {};
    for (const [name, idx] of Object.entries(source)) {
        out[name] = idx;
        out[name.toLowerCase()] = idx;
    }
    return out;
}

function relaxAll(influences: number[], alpha: number) {
    for (let i = 0; i < influences.length; i++) {
        influences[i] = THREE.MathUtils.lerp(influences[i], 0, alpha);
    }
}

function setIfExists(
    influences: number[],
    dict: MorphTargetMap,
    names: string[],
    value: number,
    alpha: number,
) {
    for (const name of names) {
        const idx = dict[name];
        if (idx !== undefined) {
            influences[idx] = THREE.MathUtils.lerp(influences[idx], value, alpha);
            return;
        }
    }
}

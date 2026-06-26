// === js/audio/audio-controller.js ===
// =========================================================
// CENTRAL WEB AUDIO ENGINE & WORKLET CONTROLLER
// Pure ES6 Module - With Master Limiter and Analog Routing
// =========================================================

import { createKickSample, createBassSample, createChordSample, createSnareSample, createLeadSample } from '../utils/amiga-helper.js';

let audioCtx = null;
let ymNode = null;
let paulaNode = null;
let sidNode = null;
let masterGain = null;
let analyserNode = null;
let amigaFilter = null;
let masterLimiter = null; // Master Studio Limiter

export function getAudioContext() { return audioCtx; }
export function getAnalyserNode() { return analyserNode; }
export function getMasterGain() { return masterGain; }
export function getYmNode() { return ymNode; }
export function getPaulaNode() { return paulaNode; }
export function getSidNode() { return sidNode; }

export async function initAudioEngine() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try {
        // Statischer Rekonstruktions-Tiefpassfilter für den Amiga-Soundboard-Weg
        amigaFilter = audioCtx.createBiquadFilter();
        amigaFilter.type = 'lowpass';
        amigaFilter.frequency.value = 6000; 

        // Master Spectrum Analyzer
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 4096; 

        // Master Lautstärkeregler (Gain)
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.5; 
        
        // === MASTER DYNAMICS LIMITER (Studio Soft-Limiter) ===
        // Fängt Resonanzpeaks warm ab und verhindert digitales Clipping
        masterLimiter = audioCtx.createDynamicsCompressor();
        masterLimiter.threshold.value = -1.5; // Limitierung startet bei -1.5 dBFS
        masterLimiter.knee.value = 4.0;       // Weicher Knie-Übergang
        masterLimiter.ratio.value = 12.0;     // Kompressions-Verhältnis für Limiting
        masterLimiter.attack.value = 0.003;   // Extrem schnelle Ansprechzeit (3ms)
        masterLimiter.release.value = 0.08;   // Release-Zeit (80ms)
        
        // Signalweg verbinden: Cores -> masterGain -> masterLimiter -> analyserNode -> destination
        masterGain.connect(masterLimiter);
        masterLimiter.connect(analyserNode);
        analyserNode.connect(audioCtx.destination);
    } catch (e) {
        console.error("[AUDIO ENGINE] Initialisierung fehlgeschlagen:", e);
        throw e;
    }
}

export async function loadEmuCore(system, coreConfig, onMessageCallback) {
    if (!audioCtx) return;

    try {
        await audioCtx.audioWorklet.addModule(coreConfig.file, { type: 'module' });
        
        if (system === 'atari' && ymNode) { ymNode.disconnect(); ymNode = null; }
        if (system === 'c64' && sidNode) { sidNode.disconnect(); sidNode = null; }
        if (system === 'amiga' && paulaNode) { paulaNode.disconnect(); paulaNode = null; }

        const newNode = new AudioWorkletNode(audioCtx, coreConfig.processor);
        
        if (system === 'amiga') {
            newNode.connect(amigaFilter).connect(masterGain);
        } else {
            newNode.connect(masterGain);
        }

        newNode.port.onmessage = onMessageCallback;

        if (system === 'atari') ymNode = newNode;
        if (system === 'c64') sidNode = newNode;
        if (system === 'amiga') {
            paulaNode = newNode;
            uploadAmigaSamples(); 
        }

        console.log(`[AUDIO ENGINE] Soundprozessor erfolgreich getauscht: ${system.toUpperCase()} -> ${coreConfig.name}`);
    } catch (e) {
        console.error(`[AUDIO ENGINE] Fehler beim Einhängen des Cores ${coreConfig.name}:`, e);
        throw e;
    }
}

export function uploadAmigaSamples() {
    if (!paulaNode) return;
    paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'kick', data: createKickSample() });
    paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'bass', data: createBassSample() });
    paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'chord', data: createChordSample() });
    paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'snare', data: createSnareSample() }); 
    paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'lead', data: createLeadSample() });   
}

export async function resumeAudioContext() {
    if (audioCtx && audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
}
// =========================================================
// CENTRAL WEB AUDIO ENGINE & WORKLET CONTROLLER
// Pure ES6 Module - No Global Leakage
// =========================================================

import { createKickSample, createBassSample, createChordSample, createSnareSample, createLeadSample } from '../utils/amiga-helper.js';

// Private Modul-Variablen (von außen nicht manipulierbar!)
let audioCtx = null;
let ymNode = null;
let paulaNode = null;
let sidNode = null;
let masterGain = null;
let analyserNode = null;
let amigaFilter = null;

// Saubere Getter für externe Module (z.B. für die Grafik-Schnittstelle)
export function getAudioContext() { return audioCtx; }
export function getAnalyserNode() { return analyserNode; }
export function getMasterGain() { return masterGain; }
export function getYmNode() { return ymNode; }
export function getPaulaNode() { return paulaNode; }
export function getSidNode() { return sidNode; }

/**
 * Initialisiert den zentralen Web Audio Context, setzt das Master-Gain auf
 * 50% und bereitet den analogen Amiga-Tiefpassfilter vor.
 */
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
        
        // Signalweg verbinden
        masterGain.connect(analyserNode);
        analyserNode.connect(audioCtx.destination);
    } catch (e) {
        console.error("[AUDIO ENGINE] Initialisierung fehlgeschlagen:", e);
        throw e;
    }
}

/**
 * Lötet einen neuen Soundprozessor auf dem Mainboard ein und koppelt
 * den asynchronen Nachrichten-Port an das Hauptsystem.
 * 
 * @param {string} system - Ziel-Computersystem ('atari', 'c64', 'amiga')
 * @param {Object} coreConfig - Konfiguration des Cores aus der registry.js
 * @param {Function} onMessageCallback - Event-Broker zur Weitergabe von Worklet-Nachrichten an app.js
 */
export async function loadEmuCore(system, coreConfig, onMessageCallback) {
    if (!audioCtx) return;

    try {
        // Lädt das Worklet als asynchrones ES6-Modul
        await audioCtx.audioWorklet.addModule(coreConfig.file, { type: 'module' });
        
        // Alten Chip trennen und entsorgen, um Speicherlecks zu verhindern
        if (system === 'atari' && ymNode) { ymNode.disconnect(); ymNode = null; }
        if (system === 'c64' && sidNode) { sidNode.disconnect(); sidNode = null; }
        if (system === 'amiga' && paulaNode) { paulaNode.disconnect(); paulaNode = null; }

        // Neuen virtuellen Soundprozessor instanziieren
        const newNode = new AudioWorkletNode(audioCtx, coreConfig.processor);
        
        // Signal-Routing anlegen
        if (system === 'amiga') {
            newNode.connect(amigaFilter).connect(masterGain);
        } else {
            newNode.connect(masterGain);
        }

        // Nachrichten-Port an den Event-Broker binden
        newNode.port.onmessage = onMessageCallback;

        // Modulinterne Referenzen aktualisieren
        if (system === 'atari') ymNode = newNode;
        if (system === 'c64') sidNode = newNode;
        if (system === 'amiga') {
            paulaNode = newNode;
            // Hochladen der Original-Wellenformen in den virtuellen Paula-RAM
            uploadAmigaSamples(); 
        }

        console.log(`[AUDIO ENGINE] Soundprozessor erfolgreich getauscht: ${system.toUpperCase()} -> ${coreConfig.name}`);
    } catch (e) {
        console.error(`[AUDIO ENGINE] Fehler beim Einhängen des Cores ${coreConfig.name}:`, e);
        throw e;
    }
}

/**
 * Lädt die standardmäßigen, synthetisierten Amiga-Wellenformen in den Paula-RAM.
 * Wird exklusiv für prozedurale Generatoren wie jesters Elysium-Track benötigt.
 */
export function uploadAmigaSamples() {
    if (!paulaNode) return;
    paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'kick', data: createKickSample() });
    paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'bass', data: createBassSample() });
    paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'chord', data: createChordSample() });
    paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'snare', data: createSnareSample() }); 
    paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'lead', data: createLeadSample() });   
}

/**
 * Weckt den AudioContext auf (notwendig für die Einhaltung der Klick-to-Play-Richtlinien).
 */
export async function resumeAudioContext() {
    if (audioCtx && audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
}
// === js/worklets/lib/sid-waveforms.js ===
// =========================================================
// MOS 6581 WAVEFORM GENERATOR & BIT-LOGIC
// Phase 3 (Dark Magic): Illegal Opcodes & Analog Wire-Shorts Matrix
// =========================================================

import { PWM_LUT } from './sid-luts.js';

export function calculateWaveform8Bit(ch, ctrl, phase24, pw12, lfsr23, ringMSB) {
    let out = 0xFF; 
    let hasWave = false;

    // 1. Die vier Basis-Wellenformen (Hardware-Quantisiert)
    if (ctrl & 16) { 
        let bit23 = (phase24 >> 23) & 1;
        if (ctrl & 4) bit23 ^= ringMSB;

        let tri12 = (phase24 >> 11) & 0xFFF;
        if (bit23) tri12 = (~tri12) & 0xFFF;
        
        out &= (tri12 >> 4);
        hasWave = true;
    }

    if (ctrl & 32) { 
        out &= (phase24 >> 16) & 0xFF;
        hasWave = true;
    }

    if (ctrl & 64) { 
        let testPhase = (phase24 >> 12) & 0xFFF;
        let effectivePw = PWM_LUT[pw12];
        out &= (testPhase <= effectivePw) ? 0xFF : 0x00;
        hasWave = true;
    }

    if (ctrl & 128) { 
        let noiseOut = ((lfsr23 & 0x400000) >> 15) | 
                       ((lfsr23 & 0x100000) >> 14) | 
                       ((lfsr23 & 0x010000) >> 11) | 
                       ((lfsr23 & 0x002000) >>  9) | 
                       ((lfsr23 & 0x000800) >>  8) | 
                       ((lfsr23 & 0x000080) >>  5) | 
                       ((lfsr23 & 0x000010) >>  3) | 
                       ((lfsr23 & 0x000004) >>  2);  
        out &= noiseOut;
        hasWave = true;
    }

    // --- PHASE 3: ILLEGAL OPCODES (ANALOG DIE SHORTS) ---
    // Wenn mehrere Wellen kombiniert werden, entsteht ein physischer Kurzschluss.
    // Die schwächeren Pull-Up-Widerstände kollabieren, die Amplitude bricht ein
    // und erzeugt einen spezifischen Gleichspannungs-Sprung (DC-Offset).
    if (hasWave) {
        let waveCombine = ctrl & 0x70; // Filtert Tri (16), Saw (32), Pulse (64)
        
        if (waveCombine === 0x30) { // Tri + Saw
            // Amplitude bricht stark ein, Signal driftet nach oben
            out = (out >> 1) + 0x18; 
        } 
        else if (waveCombine === 0x50) { // Tri + Pulse
            // Dreieck wird vom Puls massiv verzerrt und gestaucht
            out = (out >> 1) + 0x20;
        } 
        else if (waveCombine === 0x60) { // Saw + Pulse
            out = (out >> 1) + 0x10;
        } 
        else if (waveCombine === 0x70) { // Tri + Saw + Pulse
            // Totaler Kurzschluss: Signal flacht fast komplett ab (extrem leise)
            out = (out >> 2) + 0x28;
        }

        ch.floatingLevel = out;
    } else {
        // Floating DAC: Zieht sich langsam in Richtung 0x18 Leckstrom
        ch.floatingLevel += (0x18 - ch.floatingLevel) * 0.0002;
        out = Math.round(ch.floatingLevel);
    }

    return out;
}
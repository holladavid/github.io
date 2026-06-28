// === js/worklets/lib/sid-waveforms.js ===
// =========================================================
// MOS 6581 WAVEFORM GENERATOR & BIT-LOGIC
// Hardware-accurate 8-Bit DAC quantization, Wire-AND & PWM Asymmetry
// =========================================================

import { PWM_LUT } from './sid-luts.js';

export function calculateWaveform8Bit(ch, ctrl, phase24, pw12, lfsr23, ringMSB) {
    let out = 0xFF; 
    let hasWave = false;

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
        
        // --- ETAPPE 2: Asymmetrischer PWM Komparator ---
        // Nutzt die LUT, um den DC-Offset des originalen 6581 Komparators abzubilden
        let effectivePw = PWM_LUT[pw12];
        let pulseOut = (testPhase <= effectivePw) ? 0xFF : 0x00;
        
        out &= pulseOut;
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

    if (hasWave) {
        ch.floatingLevel = out;
    } else {
        ch.floatingLevel += (0 - ch.floatingLevel) * 0.0002;
        out = Math.round(ch.floatingLevel);
    }

    return out;
}
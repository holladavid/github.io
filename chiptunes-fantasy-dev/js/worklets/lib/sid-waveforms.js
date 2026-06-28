// === js/worklets/lib/sid-waveforms.js ===
// =========================================================
// MOS 6581 WAVEFORM GENERATOR & BIT-LOGIC
// Hardware-accurate 8-Bit DAC quantization & Wire-AND logic
// =========================================================

/**
 * Berechnet die bitgenaue 8-Bit Wellenform des MOS 6581.
 * Simuliert echte Transistor-Kurzschlüsse (Wire-AND) für kombinierte Wellenformen.
 * 
 * @param {number} ctrl - 8-Bit Control Register (Gate, Sync, Ring, Test, Tri, Saw, Pulse, Noise)
 * @param {number} phase24 - 24-Bit Phasen-Akkumulator (0 bis 0xFFFFFF)
 * @param {number} pw12 - 12-Bit Pulse Width Register (0 bis 4095)
 * @param {number} lfsr23 - 23-Bit Noise Linear Feedback Shift Register
 * @param {number} ringMSB - MSB für Ringmodulation (XOR-Bit der Trägerwelle)
 * @returns {number} 8-Bit DAC Output (0 bis 255)
 */
export function calculateWaveform8Bit(ctrl, phase24, pw12, lfsr23, ringMSB) {
    let out = 0xFF; // DAC startet auf HIGH (alle Leiter unter Spannung)
    let hasWave = false;

    // 1. Dreieckswelle (Triangle - Bit 4)
    if (ctrl & 16) {
        // Das Dreieck nutzt Bit 11-22. Das MSB (Bit 23) invertiert die Zählrichtung.
        let tri12 = (phase24 >> 11) & 0xFFF;
        
        // Ringmodulation: XOR-Verknüpfung der Träger-MSB mit der Zählrichtung
        if (ringMSB) {
            tri12 = (~tri12) & 0xFFF;
        }
        
        // 12-Bit auf 8-Bit quantisieren
        out &= (tri12 >> 4);
        hasWave = true;
    }

    // 2. Sägezahnwelle (Sawtooth - Bit 5)
    if (ctrl & 32) {
        // Direkter Abgriff der oberen 8 Bits des Phasenakkumulators
        out &= (phase24 >> 16) & 0xFF;
        hasWave = true;
    }

    // 3. Rechteckwelle (Pulse / PWM - Bit 6)
    if (ctrl & 64) {
        // Echter 12-Bit-Komparator gegen das Pulsweiten-Register (inkl. DC-Bias)
        let testPhase = (phase24 >> 12) & 0xFFF;
        let pulseOut = (testPhase <= pw12) ? 0xFF : 0x00;
        out &= pulseOut;
        hasWave = true;
    }

    // 4. Rauschen (Noise - Bit 7)
    // --- PHASE 3: Exakte physische LFSR-zu-DAC Matrix-Abgriffe ---
    if (ctrl & 128) {
        let noiseOut = ((lfsr23 & 0x400000) >> 15) | // Bit 22 -> 7
                       ((lfsr23 & 0x100000) >> 14) | // Bit 20 -> 6
                       ((lfsr23 & 0x010000) >> 11) | // Bit 16 -> 5
                       ((lfsr23 & 0x002000) >>  9) | // Bit 13 -> 4
                       ((lfsr23 & 0x000800) >>  8) | // Bit 11 -> 3
                       ((lfsr23 & 0x000080) >>  5) | // Bit  7 -> 2
                       ((lfsr23 & 0x000010) >>  3) | // Bit  4 -> 1
                       ((lfsr23 & 0x000004) >>  2);  // Bit  2 -> 0
        
        // Wire-AND Kurzschluss: Noise zieht andere aktive Wellenformen nach unten
        out &= noiseOut;
        hasWave = true;
    }

    // Floating DAC Fallback: Wenn keine Welle aktiv ist, driftet die Spannung auf Null
    if (!hasWave) {
        return 0x00; 
    }

    return out;
}
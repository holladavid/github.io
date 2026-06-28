// === js/worklets/lib/sid-waveforms.js ===
// =========================================================
// MOS 6581 WAVEFORM GENERATOR & BIT-LOGIC
// Hardware-accurate 8-Bit DAC quantization & Wire-AND logic
// =========================================================

/**
 * Berechnet die bitgenaue 8-Bit Wellenform des MOS 6581.
 * Ersetzt ungenaue Fließkomma-Multiplikationen durch echte Transistor-Kurzschluss-Logik (Wire-AND).
 * 
 * @param {number} ctrl - 8-Bit Control Register (Gate, Sync, Ring, Test, Tri, Saw, Pulse, Noise)
 * @param {number} phase24 - 24-Bit Phasen-Akkumulator (0 bis 0xFFFFFF)
 * @param {number} pw12 - 12-Bit Pulse Width Register (0 bis 4095)
 * @param {number} lfsr23 - 23-Bit Noise Linear Feedback Shift Register
 * @param {number} ringMSB - MSB für Ringmodulation (XOR-Bit der Trägerwelle)
 * @returns {number} 8-Bit DAC Output (0 bis 255)
 */
export function calculateWaveform8Bit(ctrl, phase24, pw12, lfsr23, ringMSB) {
    let out = 0xFF; // Startet auf HIGH (alle Bits 1)
    let hasWave = false;

    // 1. Dreieckswelle (Triangle - Bit 4)
    if (ctrl & 16) {
        // Das Dreieck wird aus Bit 11-22 generiert. Das MSB (Bit 23) invertiert die Zählrichtung.
        let tri12 = (phase24 >> 11) & 0xFFF;
        
        // Ringmodulation: XOR-Verknüpfung der Träger-MSB mit der Zählrichtung
        if (ringMSB) {
            tri12 = (~tri12) & 0xFFF;
        }
        
        // 12-Bit zu 8-Bit Shift
        out &= (tri12 >> 4);
        hasWave = true;
    }

    // 2. Sägezahnwelle (Sawtooth - Bit 5)
    if (ctrl & 32) {
        // Einfach die oberen 8 Bits des 24-Bit-Akkumulators
        out &= (phase24 >> 16) & 0xFF;
        hasWave = true;
    }

    // 3. Rechteckwelle (Pulse / PWM - Bit 6)
    if (ctrl & 64) {
        // Echter 12-Bit-Komparator: Vergleicht die Bits 12-23 mit dem PW-Register
        let testPhase = (phase24 >> 12) & 0xFFF;
        let pulseOut = (testPhase <= pw12) ? 0xFF : 0x00;
        out &= pulseOut;
        hasWave = true;
    }

    // 4. Rauschen (Noise - Bit 7)
    if (ctrl & 128) {
        // Bit 15 bis 22 des LFSR-Registers stellen den 8-Bit Noise-Output dar
        let noiseOut = (lfsr23 >> 15) & 0xFF;
        out &= noiseOut;
        hasWave = true;
    }

    // Floating DAC Fallback: Wenn keine Welle aktiv ist, sinkt die Spannung auf 0
    if (!hasWave) {
        return 0x00; 
    }

    return out;
}
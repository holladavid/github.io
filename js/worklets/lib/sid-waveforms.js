// === js/worklets/lib/sid-waveforms.js ===
// =========================================================
// MOS 6581 WAVEFORM GENERATOR & BIT-LOGIC
// Hardware-accurate 8-Bit DAC quantization & Floating DC Bias
// Phase 5: Analog Wire-AND Simulation for Illegal Waveforms
// =========================================================

export function calculateWaveform8Bit(ctrl, phase24, pw12, lfsr23, ringMSB) {
    let hasWave = false;
    
    // Basis-Wellenformen in 8-Bit berechnen
    let tri = 0xFF, saw = 0xFF, pulse = 0xFF, noise = 0xFF;

    if (ctrl & 16) {
        let tri12 = (phase24 >> 11) & 0xFFF;
        if (ringMSB) tri12 = (~tri12) & 0xFFF;
        tri = tri12 >> 4;
        hasWave = true;
    }

    if (ctrl & 32) {
        saw = (phase24 >> 16) & 0xFF;
        hasWave = true;
    }

    if (ctrl & 64) {
        let testPhase = (phase24 >> 12) & 0xFFF;
        pulse = (testPhase <= pw12) ? 0xFF : 0x00;
        hasWave = true;
    }

    if (ctrl & 128) {
        noise = ((lfsr23 & 0x400000) >> 15) | 
                ((lfsr23 & 0x100000) >> 14) | 
                ((lfsr23 & 0x010000) >> 11) | 
                ((lfsr23 & 0x002000) >>  9) | 
                ((lfsr23 & 0x000800) >>  8) | 
                ((lfsr23 & 0x000080) >>  5) | 
                ((lfsr23 & 0x000010) >>  3) | 
                ((lfsr23 & 0x000004) >>  2);  
        hasWave = true;
    }

    // --- Floating DAC DC-Bias ---
    // Wenn keine Welle selektiert ist, fällt der SID nicht auf absolute Null ab.
    // Die analogen DAC-Gatter "floaten" und erzeugen eine Restgleichspannung.
    if (!hasWave) {
        return 0x18; 
    }
    
    // --- SINGLE WAVEFORMS (Fast Path) ---
    let waveMask = ctrl & 0xF0;
    if (waveMask === 0x10) return tri;
    if (waveMask === 0x20) return saw;
    if (waveMask === 0x40) return pulse;
    if (waveMask === 0x80) return noise;

    // =========================================================
    // DSP UPGRADE: ANALOG WIRE-AND SIMULATION (Illegal Waves)
    // =========================================================
    
    let bitAnd = 0xFF;
    let sum = 0;
    let count = 0;
    
    if (ctrl & 16) { bitAnd &= tri; sum += tri; count++; }
    if (ctrl & 32) { bitAnd &= saw; sum += saw; count++; }
    if (ctrl & 64) { bitAnd &= pulse; sum += pulse; count++; }
    if (ctrl & 128) { bitAnd &= noise; sum += noise; count++; }
    
    let avg = sum / count;
    
    // Ein pures bitweises AND (`bitAnd`) ist viel zu leise, da eine digitale '0'
    // eine '1' sofort zerstört. Da die NMOS-Transistoren im 6581 Widerstand haben,
    // mischen wir 22% der "verlorenen" Energie (Differenz zum Durchschnitt) wieder
    // als Leakage/Bleed in das Signal ein.
    let bleed = (avg - bitAnd) * 0.22; 
    
    // Die Puls-Welle hat im SID-Chip einen viel größeren Pull-Down-Transistor.
    // Wenn Puls aktiv ist und auf GND (0V) zieht, "gewinnt" es den Kurzschluss
    // und zerschmettert das Leakage der anderen Wellen massiv. Das erzeugt
    // das klassische, kratzige "Snappen" der MoN-Drums.
    if ((ctrl & 64) && pulse === 0) {
        bleed *= 0.15; 
    }
    
    let out = bitAnd + bleed;
    
    // Gekoppelte Wellenformen haben hardwarebedingt einen Lautstärkeabfall
    // und landen auf einem leichten DC-Offset.
    out = (out * 0.75) + 0x15; 
    
    if (out > 255) out = 255;
    if (out < 0) out = 0;
    
    return Math.floor(out);
}
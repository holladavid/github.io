// === js/worklets/lib/sid-luts.js ===
// =========================================================
// MOS 6581 HARDWARE LOOKUP TABLES (LUTs)
// Pre-computed physical anomalies, bit-weight errors & non-linear curves
// =========================================================

export const DAC_LUT = new Float32Array(256);
export const CUTOFF_LUT = new Float32Array(2048);
export const PWM_LUT = new Uint16Array(4096);

// 1. GENERATE 6581 DAC CURVE (256 Entries)
// Simuliert die fehlerhaften Widerstände des analogen R-2R Leiter-Netzwerks auf dem Die.
// Anstatt einer reinen Parabel gewichten wir jedes Bit mit winzigen Hardware-Toleranzen.
const bitWeights = [
    1.00,   // Bit 0
    2.01,   // Bit 1
    3.98,   // Bit 2
    8.05,   // Bit 3
    15.90,  // Bit 4
    32.15,  // Bit 5
    63.70,  // Bit 6
    128.50  // Bit 7
];
let maxWeight = 0;
for (let b of bitWeights) maxWeight += b;

for (let i = 0; i < 256; i++) {
    let sum = 0;
    for (let b = 0; b < 8; b++) {
        if (i & (1 << b)) sum += bitWeights[b];
    }
    let v = sum / maxWeight;
    // Zusätzlich: Der charakteristische, leichte Bowing-Effekt des Ausgangsverstärkers
    DAC_LUT[i] = v + 0.12 * v * (1.0 - v);
}

// 2. GENERATE 6581 FILTER CUTOFF CURVE (2048 Entries)
// Bildet die gemessene, krumme FET-Kennlinie des originalen Filters nach:
// Flaches Plateau -> harter Knick -> massiver Sprung -> Sättigung im High-End
for (let i = 0; i < 2048; i++) {
    let norm = i / 2047.0;
    let hz;
    
    if (norm < 0.2) {
        hz = 30.0 + norm * 500.0; // Flat start (Plateau)
    } else if (norm < 0.6) {
        hz = 130.0 + Math.pow((norm - 0.2) / 0.4, 2.0) * 3000.0; // Sharp knee (Knick)
    } else if (norm < 0.9) {
        hz = 3130.0 + Math.pow((norm - 0.6) / 0.3, 1.5) * 8000.0; // Jump (Sprung)
    } else {
        hz = 11130.0 + ((norm - 0.9) / 0.1) * 4870.0; // Saturation (Top end)
    }
    
    if (hz < 30) hz = 30;
    if (hz > 16000) hz = 16000;
    CUTOFF_LUT[i] = hz;
}

// 3. GENERATE PWM COMPARATOR OFFSET (4096 Entries)
// Der analoge Komparator des 6581 ist asymmetrisch. Eine programmierte 50% Pulswelle (0x800)
// ist in der Hardware leicht verschoben, was Sweeps charakteristisch unrund macht.
for (let i = 0; i < 4096; i++) {
    // Hardware DC-Offset von ca. 1.8% in die Vergleichslogik injizieren
    let shifted = i + 76; 
    if (shifted > 4095) shifted = 4095;
    PWM_LUT[i] = shifted;
}
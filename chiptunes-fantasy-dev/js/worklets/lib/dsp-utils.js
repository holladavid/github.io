// =========================================================
// DSP UTILITIES & FILTERS
// Das Effekt-Rack für alle Worklets
// =========================================================

export const YM_DAC = [
    0.0000, 0.0137, 0.0205, 0.0291, 0.0423, 0.0618, 0.0847, 0.1369, 
    0.1691, 0.2647, 0.3527, 0.4499, 0.5704, 0.6873, 0.8482, 1.0000
];

export function polyBLEP(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1.0; }
    else if (t > 1.0 - dt) { t = (t - 1.0 + dt) / dt; return 1.0 - (t + t - t * t); }
    return 0.0;
}

export function cubicInterpolate(y0, y1, y2, y3, mu) {
    let mu2 = mu * mu;
    let a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
    let a1 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    let a2 = -0.5 * y0 + 0.5 * y2;
    return (a0 * mu * mu2 + a1 * mu2 + a2 * mu + y1);
}

// 12dB Moog-Style Filter (Für Blade Runner & Noise)
export class MoogFilter {
    constructor() { this.low = 0; this.band = 0; }
    process(input, cutoffHz, resonance, sampleRate) {
        if (cutoffHz < 20) cutoffHz = 20;
        if (cutoffHz > 16000) cutoffHz = 16000; 
        let q = 1.0 - resonance;
        let f = 2.0 * Math.sin(Math.PI * cutoffHz / sampleRate);
        if (f > 1.9 - q) f = 1.9 - q; 
        
        this.low += f * this.band;
        let high = input - this.low - q * this.band;
        this.band += f * high;
        
        if (isNaN(this.low)) { this.low = 0; this.band = 0; }
        return this.low; 
    }
}

// 24dB 4-Pole Filter (Für Chiptunes Fantasy)
export class FourPoleFilter {
    constructor() { this.l1 = 0; this.b1 = 0; this.l2 = 0; this.b2 = 0; }
    process(input, cutoffHz, resonance, sampleRate) {
        if (cutoffHz < 20) cutoffHz = 20;
        if (cutoffHz > 18000) cutoffHz = 18000; 
        let q = 1.0 - (resonance * 0.8); 
        let f = 2.0 * Math.sin(Math.PI * cutoffHz / sampleRate);
        if (f > 1.9 - q) f = 1.9 - q; 
        
        this.l1 += f * this.b1;
        let h1 = input - this.l1 - q * this.b1;
        this.b1 += f * h1;
        
        this.l2 += f * this.b2;
        let h2 = this.l1 - this.l2 - q * this.b2;
        this.b2 += f * h2;

        if (isNaN(this.l2)) { this.l1=0; this.b1=0; this.l2=0; this.b2=0; }
        return this.l2; 
    }
}

// DC Blocker (Hält die Lautsprecher-Membranen mittig)
export class DCBlocker {
    constructor() { this.lastIn = 0; this.lastOut = 0; }
    process(input) {
        let out = input - this.lastIn + 0.995 * this.lastOut;
        this.lastIn = input; this.lastOut = out;
        return out;
    }
}
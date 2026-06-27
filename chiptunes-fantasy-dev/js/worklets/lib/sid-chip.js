// === js/worklets/lib/sid-chip.js ===
// ==========================================
// MOS Technology SID 6581 Sound Chip Emulation
// Pure Cycle-Exact 985.248 Hz Native Clock Synthesis & JFET Modeling
// ==========================================

const ENV_ATTACK = 0, ENV_DECAY = 1, ENV_SUSTAIN = 2, ENV_RELEASE = 3;

const RATE_COUNTER_PERIOD = [
    9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19530, 31256
];

export class SIDChip {
    constructor() {
        this.regs = new Uint8Array(29);
        this.voices = [];
        for (let i = 0; i < 3; i++) {
            this.voices.push({
                freq: 0, pw: 2048, ctrl: 0, env: 0, phase: 0,
                state: ENV_RELEASE, prevGate: false,
                waveOut8Bit: 0, env8Bit: 0, lfsr: 0x7FFFFF,
                rate_counter: 0, exponential_counter: 0, envelope_counter: 0
            });
        }
        this.cutoff = 30; this.resonance = 0; this.filterMode = 0; this.masterVol = 0;
        this.filterLow = 0; this.filterBand = 0;
        this.temperature = 55.0;
        this.outputSample = 0;
    }

    writeReg(reg, val) {
        if (reg >= 29) return;
        this.regs[reg] = val;
        
        let vIdx = Math.floor(reg / 7);
        if (vIdx < 3) {
            let ch = this.voices[vIdx];
            let base = vIdx * 7;
            ch.freq = this.regs[base] | (this.regs[base+1] << 8);
            ch.pw = this.regs[base+2] | ((this.regs[base+3] & 15) << 8);
            
            let prevCtrl = ch.ctrl;
            ch.ctrl = this.regs[base+4];
            
            let gate = (ch.ctrl & 1) !== 0;
            let prevGate = (prevCtrl & 1) !== 0;
            
            if (gate && !prevGate) ch.state = ENV_ATTACK;
            else if (!gate && prevGate) ch.state = ENV_RELEASE;
            ch.prevGate = gate;

            if (ch.ctrl & 8) {
                ch.phase = 0; 
                ch.lfsr = 0x7FFFFF;
            }
        } else if (reg === 21 || reg === 22) {
            let cutoffReg = (this.regs[21] & 7) | (this.regs[22] << 3);
            this.cutoff = 30 + (cutoffReg * 8);
        } else if (reg === 23) {
            this.resonance = (val >> 4) / 15.0;
        } else if (reg === 24) {
            this.filterMode = val;
            this.masterVol = (val & 15) / 15.0;
        }
    }

    getRatePeriod(v, state) {
        let base = v * 7;
        let ad = this.regs[base + 5];
        let sr = this.regs[base + 6];
        
        if (state === ENV_ATTACK) return RATE_COUNTER_PERIOD[ad >> 4];
        if (state === ENV_DECAY) return RATE_COUNTER_PERIOD[ad & 15];
        return RATE_COUNTER_PERIOD[sr & 15]; 
    }

    clockEnvelopeOneCycle(v) {
        let ch = this.voices[v];
        if (ch.state === ENV_SUSTAIN) {
            let sr = this.regs[v * 7 + 6];
            ch.envelope_counter = (sr >> 4) | ((sr >> 4) << 4);
            return;
        }

        let ratePeriod = this.getRatePeriod(v, ch.state);

        if (ch.rate_counter <= 0) {
            ch.rate_counter += ratePeriod; 

            let expPeriod = 1;
            if (ch.state !== ENV_ATTACK) {
                let envVal = ch.envelope_counter;
                if (envVal >= 93) expPeriod = 1;
                else if (envVal >= 54) expPeriod = 2;
                else if (envVal >= 26) expPeriod = 4;
                else if (envVal >= 14) expPeriod = 8;
                else if (envVal >= 6) expPeriod = 16;
                else expPeriod = 30;
            }

            ch.exponential_counter++;
            if (ch.exponential_counter >= expPeriod) {
                ch.exponential_counter = 0;

                if (ch.state === ENV_ATTACK) {
                    ch.envelope_counter++;
                    if (ch.envelope_counter >= 255) {
                        ch.envelope_counter = 255;
                        ch.state = ENV_DECAY;
                    }
                } else if (ch.state === ENV_DECAY) {
                    let sr = this.regs[v * 7 + 6];
                    let sustainVal = (sr >> 4) | ((sr >> 4) << 4);
                    
                    if (ch.envelope_counter > sustainVal) {
                        ch.envelope_counter--;
                    } else {
                        ch.state = ENV_SUSTAIN;
                    }
                } else if (ch.state === ENV_RELEASE) {
                    if (ch.envelope_counter > 0) {
                        ch.envelope_counter--;
                    }
                }
            }
        }
        
        ch.rate_counter--;
    }

    synthesizeVoiceOneCycle(v) {
        let ch = this.voices[v];

        if ((ch.ctrl & 8) === 0) {
            let oldAcc = ch.phase;
            
            ch.phase = (ch.phase + ch.freq) & 0xFFFFFF;
            let newAcc = ch.phase;

            let oldStep = (oldAcc >> 19) & 1;
            let newStep = (newAcc >> 19) & 1;

            if (oldStep !== newStep) {
                let bit = ((ch.lfsr >> 22) ^ (ch.lfsr >> 17)) & 1;
                ch.lfsr = ((ch.lfsr << 1) & 0x7FFFFF) | bit;
            }
        }

        let phaseFloat = ch.phase / 16777216.0;

        let tri = phaseFloat < 0.5 ? phaseFloat * 2.0 : (1.0 - phaseFloat) * 2.0;
        let saw = 1.0 - phaseFloat;
        let pulseHigh = (ch.phase >> 12) > ch.pw; 
        let noiseHigh = ((ch.lfsr >> 22) & 1) === 1;

        let waveOutVal = 0;
        let hasWave = false;

        let hasTri = (ch.ctrl & 16) !== 0;
        let hasSaw = (ch.ctrl & 32) !== 0;
        let hasPulse = (ch.ctrl & 64) !== 0;
        let hasNoise = (ch.ctrl & 128) !== 0;

        if (hasTri && hasSaw && hasPulse) {
            let trisaw = tri * saw * 1.4;
            if (trisaw > 1.0) trisaw = 1.0;
            waveOutVal = pulseHigh ? (trisaw * 0.78 + 0.22) : (trisaw * 0.12);
            hasWave = true;
        } else if (hasTri && hasSaw) {
            let val = tri * saw * 1.4;
            if (val > 1.0) val = 1.0;
            waveOutVal = val;
            hasWave = true;
        } else if (hasTri && hasPulse) {
            waveOutVal = pulseHigh ? (tri * 0.78 + 0.22) : (tri * 0.12);
            hasWave = true;
        } else if (hasSaw && hasPulse) {
            waveOutVal = pulseHigh ? (saw * 0.78 + 0.22) : (saw * 0.12);
            hasWave = true;
        } else if (hasNoise && (hasTri || hasSaw || hasPulse)) {
            let carrier = 1.0;
            if (hasTri) carrier = tri;
            else if (hasSaw) carrier = saw;
            else if (hasPulse) carrier = pulseHigh ? 1.0 : 0.0;
            
            waveOutVal = noiseHigh ? (carrier * 0.78 + 0.22) : (carrier * 0.12);
            hasWave = true;
        } else {
            if (hasTri) {
                waveOutVal = tri;
                hasWave = true;
            } else if (hasSaw) {
                waveOutVal = saw;
                hasWave = true;
            } else if (hasPulse) {
                waveOutVal = pulseHigh ? 1.0 : 0.0;
                hasWave = true;
            } else if (hasNoise) {
                waveOutVal = ((ch.lfsr >> 15) & 0xFF) / 255.0; 
                hasWave = true;
            }
        }

        if (!hasWave) waveOutVal = 0.0; 

        ch.waveOut8Bit = Math.floor(waveOutVal * 255);
        ch.env8Bit = ch.envelope_counter;

        let waveOutFloat = (waveOutVal * 2.0) - 1.0;
        return waveOutFloat * (ch.envelope_counter / 255.0);
    }

    clock() {
        for (let v = 0; v < 3; v++) {
            this.clockEnvelopeOneCycle(v);
        }

        let mix = 0;
        for (let v = 0; v < 3; v++) {
            let voiceOut = this.synthesizeVoiceOneCycle(v);
            
            if (this.regs[23] & (1 << v)) {
                let cutoffReg = (this.regs[21] & 7) | (this.regs[22] << 3);
                let norm = cutoffReg / 2047.0;
                
                let thermalCoefficient = 1.0 - (this.temperature - 55.0) * 0.0035;
                let activeCutoff = (220.0 + Math.pow(norm, 1.4) * 11500.0) * thermalCoefficient;
                if (activeCutoff < 30) activeCutoff = 30;
                if (activeCutoff > 16000) activeCutoff = 16000;

                let g = Math.PI * activeCutoff / 985248;
                
                let resReg = this.regs[23] >> 4;
                let normRes = resReg / 15.0;
                let q = 1.0 - normRes * 0.92;
                let thermalDamp = 1.0 + (this.temperature - 55.0) * 0.0015;
                q = Math.min(1.0, Math.max(0.04, q * thermalDamp));

                let h = voiceOut - this.filterLow;
                let hp = (h - q * this.filterBand) / (1.0 + g * (g + q));
                let bp = this.filterBand + g * hp;
                let lp = this.filterLow + g * bp;
                
                this.filterLow = lp;
                
                // --- NEU: AUTHENTISCHE MOS 6581 JFET SÄTTIGUNG ---
                // Die tanh() Funktion bildet die nichtlineare Röhren-artige Sättigung
                // der originalen Transistoren im C64 SVF-Filter bei hohen Resonanzpegeln ab.
                this.filterBand = Math.tanh(bp * 1.2) / 1.2;
                
                if (this.filterBand > 3.0) this.filterBand = 3.0;
                if (this.filterBand < -3.0) this.filterBand = -3.0;
                if (this.filterLow > 3.0) this.filterLow = 3.0;
                if (this.filterLow < -3.0) this.filterLow = -3.0;
                
                let filterOut = 0;
                if (this.filterMode & 16) filterOut += this.filterLow; 
                if (this.filterMode & 32) filterOut += this.filterBand; 
                if (this.filterMode & 64) filterOut += hp; 
                
                let leakage = voiceOut * 0.11;
                voiceOut = filterOut + leakage;
            }
            mix += voiceOut;
        }

        this.outputSample = (mix / 3.0) * this.masterVol;
    }
}
// === js/worklets/lib/sid-chip.js ===
// ==========================================
// MOS Technology SID 6581 Sound Chip Emulation
// Phase 4: Non-linear DAC Crunch, Asymmetric JFETs & FET-LUT Polynomial
// ==========================================

import { calculateWaveform8Bit } from './sid-waveforms.js';
import { DAC_LUT, CUTOFF_LUT } from './sid-luts.js';

const ENV_ATTACK = 0, ENV_DECAY = 1, ENV_SUSTAIN = 2, ENV_RELEASE = 3;
const RATE_COUNTER_PERIOD = [9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19530, 31256];
const PHASE_SCALE = 1.0 / 16777216.0;

export class SIDChip {
    constructor() {
        this.regs = new Uint8Array(29);
        this.voices = [];
        for (let i = 0; i < 3; i++) {
            this.voices.push({
                freq: 0, pw: 2048, ctrl: 0, env: 0, phase: 0,
                state: ENV_RELEASE, prevGate: false,
                waveOut8Bit: 0, env8Bit: 0, lfsr: 0x7FFFFF,
                rate_counter: 0, exponential_counter: 0, envelope_counter: 0,
                attack_period: RATE_COUNTER_PERIOD[0],
                decay_period: RATE_COUNTER_PERIOD[0],
                sustain_level: 0,
                release_period: RATE_COUNTER_PERIOD[0],
                msbRisingEdge: false,
                envDelay: 0,
                wrapped: false
            });
        }
        this.cutoff = 30; this.resonance = 0; this.filterMode = 0; this.masterVol = 0;
        this.filterLow = 0; this.filterBand = 0;
        this._temperature = 55.0;
        this.outputSample = 0;
        this.useJfetSaturation = true; 
        
        this.g = 0;
        this.q = 1.0;
        this.activeCutoff = 30.0;
        this.updateFilterParameters();
    }

    get temperature() { return this._temperature; }
    set temperature(val) {
        this._temperature = val;
        this.updateFilterParameters();
    }

    updateFilterParameters() {
        let cutoffReg = (this.regs[21] & 7) | (this.regs[22] << 3);
        let norm = cutoffReg / 2047.0;
        let thermalCoefficient = 1.0 - (this._temperature - 55.0) * 0.0035;

        // --- PHASE 4: Nichtlineares FET-Polynom (Gemessene Cutoff-Kurve) ---
        let fetCurve = 30.0 + 250.0 * norm + 8000.0 * (norm * norm) + 8000.0 * (norm * norm * norm);
        
        this.activeCutoff = fetCurve * thermalCoefficient;
        if (this.activeCutoff < 30) this.activeCutoff = 30;
        if (this.activeCutoff > 16000) this.activeCutoff = 16000;

        this.g = Math.PI * this.activeCutoff / 985248;
        
        let resReg = this.regs[23] >> 4;
        let normRes = resReg / 15.0;
        let q = 1.0 - normRes * 0.92;
        let thermalDamp = 1.0 + (this._temperature - 55.0) * 0.0015;
        this.q = Math.min(1.0, Math.max(0.04, q * thermalDamp));
    }

    writeReg(reg, val) {
        if (reg >= 29) return;
        this.regs[reg] = val;
        
        let vIdx = (reg / 7) | 0;
        if (vIdx < 3) {
            let ch = this.voices[vIdx];
            let base = vIdx * 7;
            ch.freq = this.regs[base] | (this.regs[base+1] << 8);
            ch.pw = this.regs[base+2] | ((this.regs[base+3] & 15) << 8);
            
            let prevCtrl = ch.ctrl;
            ch.ctrl = this.regs[base+4];
            
            let gate = (ch.ctrl & 1) !== 0;
            let prevGate = (prevCtrl & 1) !== 0;
            
            if (gate !== prevGate) {
                ch.envDelay = 1;
                ch.state = gate ? ENV_ATTACK : ENV_RELEASE;
            }
            ch.prevGate = gate;

            if (ch.ctrl & 8) {
                ch.phase = 0; 
                ch.lfsr = 0x7FFFFF;
            }

            if (reg === base + 5) { 
                ch.attack_period = RATE_COUNTER_PERIOD[val >> 4];
                ch.decay_period = RATE_COUNTER_PERIOD[val & 15];
            } else if (reg === base + 6) { 
                ch.sustain_level = (val >> 4) | ((val >> 4) << 4);
                ch.release_period = RATE_COUNTER_PERIOD[val & 15];
            }
        } else if (reg === 21 || reg === 22) {
            this.updateFilterParameters();
        } else if (reg === 23) {
            this.updateFilterParameters();
        } else if (reg === 24) {
            this.filterMode = val;
            this.masterVol = (val & 15) / 15.0;
            this.updateFilterParameters();
        }
    }

    clockEnvelopeOneCycle(v) {
        let ch = this.voices[v];

        if (ch.envDelay > 0) {
            ch.envDelay--;
            return;
        }

        if (ch.state === ENV_SUSTAIN) {
            ch.envelope_counter = ch.sustain_level;
            return;
        }

        let ratePeriod = 9;
        switch (ch.state) {
            case ENV_ATTACK:  ratePeriod = ch.attack_period; break;
            case ENV_DECAY:   ratePeriod = ch.decay_period; break;
            case ENV_RELEASE: ratePeriod = ch.release_period; break;
        }

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
                    let sustainVal = ch.sustain_level;
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
            let newAcc = (ch.phase + ch.freq) & 0xFFFFFF;

            let prevIdx = v === 0 ? 2 : v - 1;
            let prevCh = this.voices[prevIdx];
            if ((ch.ctrl & 2) !== 0 && prevCh.msbRisingEdge) newAcc = 0; 

            ch.msbRisingEdge = ((oldAcc & 0x800000) === 0) && ((newAcc & 0x800000) !== 0);
            ch.phase = newAcc;

            let oldStep = oldAcc & 0x080000;
            let newStep = ch.phase & 0x080000;
            if (!oldStep && newStep) {
                let bit = ((ch.lfsr >> 22) ^ (ch.lfsr >> 17)) & 1;
                ch.lfsr = ((ch.lfsr << 1) & 0x7FFFFF) | bit;
            }
        } else {
            ch.msbRisingEdge = false;
        }

        let ringMSB = (ch.phase >> 23) & 1;
        if ((ch.ctrl & 4) !== 0) { 
            let prevIdx = v === 0 ? 2 : v - 1;
            let prevCh = this.voices[prevIdx];
            ringMSB ^= (prevCh.phase >> 23) & 1;
        }

        // KORREKTUR: Signatur-Mismatch behoben! Wir rufen wieder mit exakt 5 Parametern auf.
        ch.waveOut8Bit = calculateWaveform8Bit(ch.ctrl, ch.phase, ch.pw, ch.lfsr, ringMSB);
        ch.env8Bit = ch.envelope_counter;

        let envDac = DAC_LUT[ch.env8Bit];
        let waveDac = DAC_LUT[ch.waveOut8Bit];

        let waveOutFloat = (waveDac * 2.0) - 1.0;
        return waveOutFloat * envDac;
    }

    clock() {
        for (let v = 0; v < 3; v++) {
            this.clockEnvelopeOneCycle(v);
        }

        let voice0 = this.synthesizeVoiceOneCycle(0);
        let voice1 = this.synthesizeVoiceOneCycle(1);
        let voice2 = this.synthesizeVoiceOneCycle(2);

        let filteredSum = 0;
        let unfilteredSum = 0;

        const isVoice3Off = (this.filterMode & 128) !== 0;

        if (this.regs[23] & 1) filteredSum += voice0; else unfilteredSum += voice0;
        if (this.regs[23] & 2) filteredSum += voice1; else unfilteredSum += voice1;

        if (!isVoice3Off) {
            if (this.regs[23] & 4) filteredSum += voice2; else unfilteredSum += voice2;
        }

        let g = this.g;
        let q = this.q;
        
        if (this.activeCutoff < 800.0) {
            let damp = (800.0 - this.activeCutoff) / 800.0; 
            q += damp * 0.55; 
        }

let h = filteredSum - this.filterLow;
        let hp = (h - q * this.filterBand) / (1.0 + g * (g + q));
        let bp = this.filterBand + g * hp;
        let lp = this.filterLow + g * bp;
        
        this.filterLow = lp;
        
        // =========================================================
        // DSP UPGRADE (FIXED): STABILE ASYMMETRISCHE SVF-SÄTTIGUNG
        // =========================================================
        if (this.useJfetSaturation) {
            // Asymmetrisches Clipping OHNE quadratischen DC-Shift im Integrator!
            // Wir clippen die negative Halbwelle härter, belassen aber f(0) = 0.
            if (bp > 0) {
                this.filterBand = Math.tanh(bp * 0.8) / 0.8;
            } else {
                this.filterBand = Math.tanh(bp * 1.5) / 1.5;
            }
        } else {
            this.filterBand = bp / (1.0 + Math.abs(bp) * 0.15); 
        }
        
        if (this.filterBand > 4.0) this.filterBand = 4.0;
        if (this.filterBand < -4.0) this.filterBand = -4.0;
        if (this.filterLow > 4.0) this.filterLow = 4.0;
        if (this.filterLow < -4.0) this.filterLow = -4.0;

        let filterOut = 0;
        if (this.filterMode & 16) filterOut += this.filterLow; 
        if (this.filterMode & 32) filterOut += this.filterBand; 
        if (this.filterMode & 64) filterOut += hp; 

        let leakage = filteredSum * 0.11;
        let filteredMix = filterOut + leakage;

        // --- VCA WARMTH (ANALOG GLUE & 2ND HARMONICS) ---
        let rawSum = unfilteredSum + filteredMix;
        let vcaIn = rawSum * 0.42; 
        
        // HIER bringen wir den "Growl" sicher unter, da der VCA nicht rückkoppelt!
        // Leichte quadratische Verzerrung simuliert den Single-Ended Verstärker
        let vcaQuad = this.useJfetSaturation ? (0.05 * Math.pow(vcaIn, 2)) : 0;
        
        let finalMix = vcaIn > 0 
            ? Math.tanh(vcaIn + vcaQuad) 
            : Math.tanh(vcaIn * 0.85 + vcaQuad) / 0.85;

        let dcLeakage = (this.masterVol - 0.5) * 1.5;
        this.outputSample = (finalMix * this.masterVol) + dcLeakage;
    }
}
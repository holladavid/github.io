// === js/worklets/atari/ym-exact.js ===
// =========================================================
// YM2149F CORE (CYCLE-EXACT, LOG-DAC, POLY-BLEP ANTI-ALIASING)
// With Sub-Sample Accurate Phase & Envelope Alignment
// =========================================================

import { detectDigidrum } from '../lib/dsp-utils.js';

const YM_DAC = [
    0.0000, 0.0137, 0.0205, 0.0291, 0.0423, 0.0618, 0.0847, 0.1369, 
    0.1691, 0.2647, 0.3527, 0.4499, 0.5704, 0.6873, 0.8482, 1.0000
];

function polyBLEP(t, dt) {
    if (t < dt) {
        t /= dt;
        return t + t - t * t - 1.0;
    } else if (t > 1.0 - dt) {
        t = (t - 1.0 + dt) / dt;
        return 1.0 - (t + t - t * t);
    }
    return 0.0;
}

class YMExactProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clock = 2000000; 
        this.regs = new Uint8Array(16); 
        this.phaseA = 0; this.phaseB = 0; this.phaseC = 0;
        this.noiseLfsr = 1; this.noisePhase = 0; this.noiseOutput = 1;
        this.envPhase = 0.0;
        
        this.incA = 0; this.incB = 0; this.incC = 0;
        this.incNoise = 0; this.incEnv = 0;
        this.toneA = false; this.toneB = false; this.toneC = false;
        this.noiseA = false; this.noiseB = false; this.noiseC = false;
        
        this.lastIn = 0; this.lastOut = 0; 

        this.digidrums = [];
        this.currentDigidrum = null;
        this.digiPos = 0;
        this.lastDigiTrigger = 0;
        
        this.trackData = null;
        this.currentFrame = 0;
        this.sampleCounter = 0;
        this.isPlaying = false;

        this.visualView = new Float32Array(40);
        
        this.port.onmessage = (event) => {
            const msg = event.data;
            if (msg.type === 'PLAY_TRACK') {
                this.trackData = msg.track;
                this.digidrums = msg.digidrums || []; 
                this.currentFrame = 0;
                this.sampleCounter = 0;
                this.currentDigidrum = null;
                this.lastDigiTrigger = 0;
                this.envPhase = 0;
                this.isPlaying = true;
                this.updateInternals(); 
            } else if (msg.type === 'STOP_TRACK') {
                this.isPlaying = false;
            } else if (msg.type === 'RESUME_TRACK') {
                this.isPlaying = true; 
            } else if (msg.type === 'SEEK_TRACK') {
                if (this.trackData) {
                    this.currentFrame = msg.frame % this.trackData.length;
                    this.currentDigidrum = null; 
                }
            }
        };
    }

    updateInternals() {
        let pA = ((this.regs[1] & 0x0F) << 8) | this.regs[0];
        let pB = ((this.regs[3] & 0x0F) << 8) | this.regs[2];
        let pC = ((this.regs[5] & 0x0F) << 8) | this.regs[4];
        
        this.incA = (this.clock / (16 * (pA === 0 ? 1 : pA))) / sampleRate;
        this.incB = (this.clock / (16 * (pB === 0 ? 1 : pB))) / sampleRate;
        this.incC = (this.clock / (16 * (pC === 0 ? 1 : pC))) / sampleRate;

        let pN = this.regs[6] & 0x1F;
        this.incNoise = (this.clock / (16 * (pN === 0 ? 1 : pN))) / sampleRate;

        let pE = (this.regs[12] << 8) | this.regs[11];
        this.incEnv = (this.clock / (256 * (pE === 0 ? 1 : pE))) / sampleRate;

        const mix = this.regs[7];
        this.toneA = (mix & 0x01) === 0;
        this.toneB = (mix & 0x02) === 0;
        this.toneC = (mix & 0x04) === 0;
        this.noiseA = (mix & 0x08) === 0;
        this.noiseB = (mix & 0x10) === 0;
        this.noiseC = (mix & 0x20) === 0;
    }

    process(inputs, outputs) {
        const channelLeft = outputs[0][0];  
        const channelRight = outputs[0][1] || outputs[0][0]; 
        let currentVisualValue = 0;

        for (let i = 0; i < channelLeft.length; i++) {
            if (!this.isPlaying) {
                channelLeft[i] = 0; if (channelRight) channelRight[i] = 0;
                continue; 
            }

            if (this.isPlaying && this.trackData) {
                this.sampleCounter--;
                if (this.sampleCounter <= 0) {
                    // === DETERMINISTISCHE SUB-SAMPLE PHASEN-KOMPENSATION ===
                    const overshoot = -this.sampleCounter; // Fraktionaler Überhang in Samples
                    this.sampleCounter += sampleRate / 50.0; 
                    
                    let frame = this.trackData[this.currentFrame];
                    for(let r=0; r<16; r++) {
                        if (r === 13) {
                            if (frame[13] !== 0xFF) {
                                this.regs[13] = frame[13];
                                // Hüllkurve exakt ab dem sub-sample-genauen Startpunkt triggern!
                                this.envPhase = overshoot * this.incEnv; 
                            }
                        } else {
                            this.regs[r] = frame[r];
                        }
                    }
                    
                    let activeDigiTrigger = detectDigidrum(frame);

                    if (activeDigiTrigger > 0 && activeDigiTrigger !== this.lastDigiTrigger) {
                        if (this.digidrums[activeDigiTrigger - 1]) {
                            this.currentDigidrum = this.digidrums[activeDigiTrigger - 1];
                            // Digidrum-Startpunkt sub-sample-genau kompensieren!
                            this.digiPos = overshoot * (7812.5 / sampleRate);
                            this.port.postMessage({ type: 'DEBUG', msg: 'Drum ' + activeDigiTrigger });
                        }
                    }
                    this.lastDigiTrigger = activeDigiTrigger;
                    
                    this.updateInternals();

                    // Oszillatoren sub-sample-genau an der Rhythmus-Achse ausrichten!
                    this.phaseA = (this.phaseA + overshoot * this.incA) % 1.0;
                    this.phaseB = (this.phaseB + overshoot * this.incB) % 1.0;
                    this.phaseC = (this.phaseC + overshoot * this.incC) % 1.0;

                    this.currentFrame = (this.currentFrame + 1) % this.trackData.length;
                }
            }

            this.phaseA = (this.phaseA + this.incA) % 1.0;
            this.phaseB = (this.phaseB + this.incB) % 1.0;
            this.phaseC = (this.phaseC + this.incC) % 1.0;
            
            this.noisePhase += this.incNoise;
            if (this.noisePhase >= 1.0) {
                this.noisePhase %= 1.0;
                this.noiseLfsr ^= (((this.noiseLfsr & 1) ^ ((this.noiseLfsr >> 3) & 1)) << 17);
                this.noiseLfsr >>= 1;
                this.noiseOutput = (this.noiseLfsr & 1) ? 1.0 : -1.0;
            }

            let sqA = (this.phaseA < 0.5 ? 1.0 : -1.0) + polyBLEP(this.phaseA, this.incA) - polyBLEP((this.phaseA + 0.5) % 1.0, this.incA);
            let sqB = (this.phaseB < 0.5 ? 1.0 : -1.0) + polyBLEP(this.phaseB, this.incB) - polyBLEP((this.phaseB + 0.5) % 1.0, this.incB);
            let sqC = (this.phaseC < 0.5 ? 1.0 : -1.0) + polyBLEP(this.phaseC, this.incC) - polyBLEP((this.phaseC + 0.5) % 1.0, this.incC);

            let outA = this.toneA ? sqA : 1.0;
            let outB = this.toneB ? sqB : 1.0;
            let outC = this.toneC ? sqC : 1.0;
            
            if (this.noiseA) outA = (outA === 1.0 && this.noiseOutput === 1.0) ? 1.0 : -1.0;
            if (this.noiseB) outB = (outB === 1.0 && this.noiseOutput === 1.0) ? 1.0 : -1.0;
            if (this.noiseC) outC = (outC === 1.0 && this.noiseOutput === 1.0) ? 1.0 : -1.0;

            this.envPhase += this.incEnv;
            let shape = this.regs[13] & 0x0F;
            let cycles = Math.floor(this.envPhase);
            let localPhase = this.envPhase - cycles;
            let envVolRaw = 0;

            let attack = (shape & 4) !== 0;
            let cont = (shape & 8) !== 0;
            let alt = (shape & 2) !== 0;
            let hold = (shape & 1) !== 0;

            if (!cont) { hold = true; alt = false; }
            else { hold = (shape & 1) !== 0; alt = (shape & 2) !== 0; }

            if (cycles > 0 && hold) {
                envVolRaw = (alt ? (attack ? 0.0 : 1.0) : (attack ? 1.0 : 0.0));
            } else {
                let flip = (cycles % 2 === 1) && alt;
                let up = attack ? !flip : flip;
                envVolRaw = up ? localPhase : (1.0 - localPhase);
            }
            
            let envVolIndex = Math.min(15, Math.max(0, Math.floor(envVolRaw * 15.99)));

            let volA = (this.regs[8] & 0x10) ? YM_DAC[envVolIndex] : YM_DAC[this.regs[8] & 0x0F];
            let volB = (this.regs[9] & 0x10) ? YM_DAC[envVolIndex] : YM_DAC[this.regs[9] & 0x0F];
            let volC = (this.regs[10] & 0x10) ? YM_DAC[envVolIndex] : YM_DAC[this.regs[10] & 0x0F];

            let digiSample = 0;
            if (this.currentDigidrum) {
                let posInt = Math.floor(this.digiPos);
                if (posInt >= 0 && posInt < this.currentDigidrum.length) {
                    digiSample = this.currentDigidrum[posInt] * 2.0;
                    this.digiPos += 7812.5 / sampleRate; 
                } else {
                    this.currentDigidrum = null; 
                }
            }

            let rawOutput = ((outA * volA) + (outB * volB) + (outC * volC) + digiSample) / 4.0;

            this.lastOut = rawOutput - this.lastIn + 0.995 * this.lastOut;
            this.lastIn = rawOutput;
            
            let finalOutput = this.lastOut;
            if (finalOutput > 1.0) finalOutput = 1.0;
            if (finalOutput < -1.0) finalOutput = -1.0;

            channelLeft[i] = finalOutput;
            if (channelRight) channelRight[i] = finalOutput;
            if (i === 0) currentVisualValue = finalOutput;
        }

        this.visCounter = (this.visCounter || 0) + 1;
        if (this.visCounter % 4 === 0) {
            let isAudible = Math.abs(currentVisualValue) > 0.001;
            if (isAudible || this.wasAudible) {
                const view = this.visualView;
                view[0] = 2; 
                view[1] = this.isPlaying ? 1 : 0;
                view[2] = this.currentFrame;
                view[3] = currentVisualValue;

                for (let r = 0; r < 16; r++) {
                    view[4 + r] = this.regs[r];
                }

                this.port.postMessage(view);
            }
            this.wasAudible = isAudible;
        }
        return true; 
    }
}

registerProcessor('ym-exact-processor', YMExactProcessor);
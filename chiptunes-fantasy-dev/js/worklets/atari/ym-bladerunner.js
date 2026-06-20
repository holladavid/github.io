// =========================================================
// YM2149F "BLADE RUNNER" CORE (Cinematic Analog CS-80 Edition)
// Mastering Update: Unified Voices & True Stereo Soundstage
// =========================================================

const YM_DAC = [
    0.0000, 0.0137, 0.0205, 0.0291, 0.0423, 0.0618, 0.0847, 0.1369, 
    0.1691, 0.2647, 0.3527, 0.4499, 0.5704, 0.6873, 0.8482, 1.0000
];

class YMBladeRunnerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clock = 2000000; 
        this.regs = new Uint8Array(16); 
        this.phaseA = 0; this.phaseB = 0; this.phaseC = 0;
        this.lfoPhase1 = 0.0; this.lfoPhase2 = 0.0; 
        this.noiseLfsr = 1; this.noisePhase = 0; this.noiseOutput = 1;
        this.envPhase = 0.0;
        
        this.incA = 0; this.incB = 0; this.incC = 0;
        this.incNoise = 0; this.incEnv = 0;
        this.toneA = false; this.toneB = false; this.toneC = false;
        this.noiseA = false; this.noiseB = false; this.noiseC = false;

        // --- CINEMATIC FX SETUP ---
        // 7 Filter-Instanzen: 3x Links, 3x Rechts, 1x Noise
        this.fLow = new Float32Array(7); 
        this.fBand = new Float32Array(7); 
        
        // Unified Slew Limiters
        this.smoothVolA = 0; this.smoothVolB = 0; this.smoothVolC = 0;
        
        // Cathedral Wash Delay
        this.delayBufL = new Float32Array(262144); 
        this.delayBufR = new Float32Array(262144);
        this.delayMask = 262143;
        this.delayIdx = 0;
        this.delayLpL = 0; this.delayLpR = 0; 
        
        // DC Blocker
        this.lastOutL = 0; this.lastInL = 0;
        this.lastOutR = 0; this.lastInR = 0;

        this.digidrums = [];
        this.currentDigidrum = null;
        this.digiPos = 0;
        this.lastDigiTrigger = 0;
        
        this.trackData = null;
        this.currentFrame = 0;
        this.sampleCounter = 0;
        this.isPlaying = false;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'PLAY_TRACK') {
                this.trackData = event.data.track;
                this.digidrums = event.data.digidrums || []; 
                this.currentFrame = 0;
                this.sampleCounter = 0;
                this.currentDigidrum = null;
                this.lastDigiTrigger = 0;
                this.isPlaying = true;
                this.updateInternals();
            } else if (event.data.type === 'STOP_TRACK') {
                this.isPlaying = false;
            } else if (event.data.type === 'RESUME_TRACK') {
                this.isPlaying = true; 
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

    applyMoogFilter(input, ch, cutoffHz, resonance) {
        if (cutoffHz > 12000) cutoffHz = 12000; 
        let q = 1.0 - resonance;
        let f = 2.0 * Math.sin(Math.PI * cutoffHz / sampleRate);
        if (f > 1.9 - q) f = 1.9 - q; 
        
        this.fLow[ch] += f * this.fBand[ch];
        let high = input - this.fLow[ch] - q * this.fBand[ch];
        this.fBand[ch] += f * high;
        
        if (isNaN(this.fLow[ch])) { this.fLow[ch] = 0; this.fBand[ch] = 0; }
        return this.fLow[ch]; 
    }

    // Erschafft einen fetten, breiten CS-80 Synthesizer Ton
    makeCS80Voice(phase, lfoOffset) {
        let saw1 = (phase * 2.0) - 1.0;
        let phase2 = (phase + lfoOffset) % 1.0;
        let saw2 = (phase2 * 2.0) - 1.0;
        let sub = Math.sin(phase * Math.PI); // Sinus eine Oktave tiefer
        return (saw1 * 0.35) + (saw2 * 0.35) + (sub * 0.5);
    }

    process(inputs, outputs) {
        const outL = outputs[0][0];  
        const outR = outputs[0][1] || outputs[0][0]; 
        let currentVisualValue = 0;

        const tap1 = Math.floor(sampleRate * 0.43);
        const tap2 = Math.floor(sampleRate * 0.71);
        const tap3 = Math.floor(sampleRate * 1.13);

        for (let i = 0; i < outL.length; i++) {
            if (!this.isPlaying) { outL[i] = 0; if (outR) outR[i] = 0; continue; }

            if (this.isPlaying && this.trackData) {
                this.sampleCounter--;
                if (this.sampleCounter <= 0) {
                    this.sampleCounter += sampleRate / 50.0; 
                    let frame = this.trackData[this.currentFrame];
                    for(let r=0; r<16; r++) {
                        if (r === 13) {
                            if (frame[13] !== 0xFF) { this.regs[13] = frame[13]; this.envPhase = 0.0; }
                        } else this.regs[r] = frame[r];
                    }
                    
                    let activeDigiTrigger = 0;
                    if (frame[15] > 0) activeDigiTrigger = frame[15];
                    else if (frame[14] > 0) activeDigiTrigger = frame[14];
                    let fx1Voice = (frame[1] & 0x30) >> 4;
                    if (fx1Voice > 0) activeDigiTrigger = (frame[8 + fx1Voice - 1] & 0x1F) + 1;
                    let fx2Voice = (frame[3] & 0x30) >> 4;
                    if (fx2Voice > 0) activeDigiTrigger = (frame[8 + fx2Voice - 1] & 0x1F) + 1;

                    if (activeDigiTrigger === 0) {
                        let fx1Type = (frame[1] & 0xC0) >> 6;
                        if (fx1Type === 0 && fx1Voice > 0) activeDigiTrigger = (frame[8 + fx1Voice - 1] & 0x1F) + 1;
                        let fx2Type = (frame[3] & 0xC0) >> 6;
                        if (fx2Type === 0 && fx2Voice > 0) activeDigiTrigger = (frame[8 + fx2Voice - 1] & 0x1F) + 1;
                    }

                    if (activeDigiTrigger > 0 && activeDigiTrigger !== this.lastDigiTrigger) {
                        if (this.digidrums[activeDigiTrigger - 1]) {
                            this.currentDigidrum = this.digidrums[activeDigiTrigger - 1];
                            this.digiPos = 0;
                            this.port.postMessage({ type: 'DEBUG', msg: 'Drum ' + activeDigiTrigger });
                        }
                    }
                    this.lastDigiTrigger = activeDigiTrigger;
                    
                    this.updateInternals();
                    this.currentFrame = (this.currentFrame + 1) % this.trackData.length;
                }
            }

            // --- LFOs & OSCILLATOR PHASES ---
            this.lfoPhase1 = (this.lfoPhase1 + 0.8 / sampleRate) % 1.0; // Chorus Speed
            this.lfoPhase2 = (this.lfoPhase2 + 0.15 / sampleRate) % 1.0; // Tape Drift Speed
            
            let drift = Math.sin(this.lfoPhase2 * 2.0 * Math.PI) * 0.005; 
            let chorusL = Math.sin(this.lfoPhase1 * 2.0 * Math.PI) * 0.03; 
            let chorusR = Math.cos(this.lfoPhase1 * 2.0 * Math.PI) * 0.03; 
            
            this.phaseA = (this.phaseA + this.incA * (1.0 + drift)) % 1.0;
            this.phaseB = (this.phaseB + this.incB * (1.0 + drift)) % 1.0;
            this.phaseC = (this.phaseC + this.incC * (1.0 + drift)) % 1.0;
            
            // --- NOISE GENERATOR ---
            this.noisePhase += this.incNoise;
            if (this.noisePhase >= 1.0) {
                this.noisePhase %= 1.0;
                this.noiseLfsr ^= (((this.noiseLfsr & 1) ^ ((this.noiseLfsr >> 3) & 1)) << 17);
                this.noiseLfsr >>= 1;
                this.noiseOutput = (this.noiseLfsr & 1) ? 1.0 : -1.0;
            }

            let pN = this.regs[6] & 0x1F;
            let noiseCutoff = 300 + (31 - pN) * 200; 
            // Sanftes Filter für orchestralen Rausch-Wind (Kanal 6)
            let filteredNoise = this.applyMoogFilter(this.noiseOutput, 6, noiseCutoff, 0.1) * 0.4;

            // --- UNIFIED OSCILLATORS (Echte Gleichberechtigung) ---
            let sigA_L = this.toneA ? this.makeCS80Voice(this.phaseA, chorusL) : 0.0; 
            let sigA_R = this.toneA ? this.makeCS80Voice(this.phaseA, chorusR) : 0.0; 
            
            let sigB_L = this.toneB ? this.makeCS80Voice(this.phaseB, chorusL) : 0.0; 
            let sigB_R = this.toneB ? this.makeCS80Voice(this.phaseB, chorusR) : 0.0; 
            
            let sigC_L = this.toneC ? this.makeCS80Voice(this.phaseC, chorusL) : 0.0; 
            let sigC_R = this.toneC ? this.makeCS80Voice(this.phaseC, chorusR) : 0.0; 

            if (this.noiseA) { sigA_L += filteredNoise; sigA_R += filteredNoise; }
            if (this.noiseB) { sigB_L += filteredNoise; sigB_R += filteredNoise; }
            if (this.noiseC) { sigC_L += filteredNoise; sigC_R += filteredNoise; }

            // --- HARDWARE ENVELOPE (HEG) BERECHNUNG ---
            this.envPhase += this.incEnv;
            let shape = this.regs[13] & 0x0F;
            let cycles = Math.floor(this.envPhase);
            let localPhase = this.envPhase - cycles;
            let envVolRaw = 0;

            let attack = (shape & 4) !== 0; let cont = (shape & 8) !== 0;
            let alt = (shape & 2) !== 0; let hold = (shape & 1) !== 0;
            if (!cont) { hold = true; alt = false; } else { hold = (shape & 1) !== 0; alt = (shape & 2) !== 0; }
            if (cycles > 0 && hold) { envVolRaw = (alt ? (attack ? 0.0 : 1.0) : (attack ? 1.0 : 0.0)); } 
            else { let flip = (cycles % 2 === 1) && alt; let up = attack ? !flip : flip; envVolRaw = up ? localPhase : (1.0 - localPhase); }
            
            let envVolIndex = Math.floor(envVolRaw * 15.99);

            let volA_raw = (this.regs[8] & 0x10) ? envVolIndex : (this.regs[8] & 0x0F);
            let volB_raw = (this.regs[9] & 0x10) ? envVolIndex : (this.regs[9] & 0x0F);
            let volC_raw = (this.regs[10] & 0x10) ? envVolIndex : (this.regs[10] & 0x0F);

            let targetVolA = YM_DAC[volA_raw];
            let targetVolB = YM_DAC[volB_raw];
            let targetVolC = YM_DAC[volC_raw];

            // --- ADAPTIVE SLEW LIMITERS ---
            // Wenn der Tracker die Noten spielt (Standard), wird sanft angeschwellt.
            // Wenn HEG aktiv ist (0x10), reagiert der Kanal blitzschnell!
            let slewSpeedA = (this.regs[8] & 0x10) ? 1.0 : (targetVolA > this.smoothVolA ? 0.002 : 0.0003);
            let slewSpeedB = (this.regs[9] & 0x10) ? 1.0 : (targetVolB > this.smoothVolB ? 0.002 : 0.0003);
            let slewSpeedC = (this.regs[10] & 0x10) ? 1.0 : (targetVolC > this.smoothVolC ? 0.002 : 0.0003);

            this.smoothVolA += (targetVolA - this.smoothVolA) * slewSpeedA;
            this.smoothVolB += (targetVolB - this.smoothVolB) * slewSpeedB;
            this.smoothVolC += (targetVolC - this.smoothVolC) * slewSpeedC;

            // --- MOOG STYLE FILTERS (True Stereo) ---
            // Die Frequenz öffnet sich analog zur Lautstärke
            let cutoffA = 100 + this.smoothVolA * 4500;
            let cutoffB = 100 + this.smoothVolB * 4500;
            let cutoffC = 100 + this.smoothVolC * 4500;

            sigA_L = this.applyMoogFilter(sigA_L, 0, cutoffA, 0.3); 
            sigA_R = this.applyMoogFilter(sigA_R, 1, cutoffA + 100, 0.3); // +100Hz Offset für Stereo-Breite
            sigB_L = this.applyMoogFilter(sigB_L, 2, cutoffB, 0.3); 
            sigB_R = this.applyMoogFilter(sigB_R, 3, cutoffB + 100, 0.3);
            sigC_L = this.applyMoogFilter(sigC_L, 4, cutoffC, 0.3); 
            sigC_R = this.applyMoogFilter(sigC_R, 5, cutoffC + 100, 0.3);

            // --- DISTANT PERCUSSION ---
            let digiSample = 0;
            if (this.currentDigidrum) {
                let posInt = Math.floor(this.digiPos);
                if (posInt < this.currentDigidrum.length) {
                    digiSample = this.currentDigidrum[posInt] * 0.6; // Etwas mehr Punch
                    this.digiPos += 8000 / sampleRate; 
                } else this.currentDigidrum = null; 
            }

            // --- STEREO MIXDOWN (Equal Power Panning) ---
            // Jeder Synth ist exakt gleich stark und breit!
            let mixL = (sigA_L * this.smoothVolA * 0.8) + (sigB_L * this.smoothVolB * 0.4) + (sigC_L * this.smoothVolC * 0.6) + digiSample;
            let mixR = (sigA_R * this.smoothVolA * 0.4) + (sigB_R * this.smoothVolB * 0.8) + (sigC_R * this.smoothVolC * 0.6) + digiSample;

            // --- CATHEDRAL REVERB / SHIMMER DELAY ---
            let r1L = this.delayBufL[(this.delayIdx - tap1 + 262144) & this.delayMask];
            let r2R = this.delayBufR[(this.delayIdx - tap2 + 262144) & this.delayMask];
            let r3L = this.delayBufL[(this.delayIdx - tap3 + 262144) & this.delayMask];
            let r3R = this.delayBufR[(this.delayIdx - tap3 + 262144) & this.delayMask];

            this.delayLpL += 0.1 * ((r1L + r3R) * 0.5 - this.delayLpL); 
            this.delayLpR += 0.1 * ((r2R + r3L) * 0.5 - this.delayLpR); 

            let reverbL = this.delayLpL;
            let reverbR = this.delayLpR;

            let finalL = mixL + reverbL * 0.5; // Reverb leicht gesenkt für mehr Klarheit
            let finalR = mixR + reverbR * 0.5;

            this.delayBufL[this.delayIdx] = mixR * 0.5 + reverbR * 0.5;
            this.delayBufR[this.delayIdx] = mixL * 0.5 + reverbL * 0.5;
            this.delayIdx = (this.delayIdx + 1) & this.delayMask;

            // Analog Tape Saturation
            finalL = Math.tanh(finalL * 1.5);
            finalR = Math.tanh(finalR * 1.5);

            // DC Blocker (Hält die Membranen stabil)
            let dcL = finalL - this.lastInL + 0.995 * this.lastOutL;
            this.lastInL = finalL; this.lastOutL = dcL;
            let dcR = finalR - this.lastInR + 0.995 * this.lastOutR;
            this.lastInR = finalR; this.lastOutR = dcR;

            outL[i] = dcL;
            if (outR) outR[i] = dcR;
            if (i === 0) currentVisualValue = (dcL + dcR) / 2.0;
        }

        this.visCounter = (this.visCounter || 0) + 1;
        if (this.visCounter % 4 === 0) {
            let isAudible = Math.abs(currentVisualValue) > 0.001;
            if (isAudible || this.wasAudible) {
                this.port.postMessage({ type: 'VISUAL_DATA', value: currentVisualValue, frame: this.currentFrame, regs: this.regs });
            }
            this.wasAudible = isAudible;
        }
        return true; 
    }
}
registerProcessor('ym-bladerunner-processor', YMBladeRunnerProcessor);
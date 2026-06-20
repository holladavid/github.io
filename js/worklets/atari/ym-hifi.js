// =========================================================
// YM2149F "HI-FI REIMAGINED" CORE (Analog Mastering Edition)
// =========================================================

const YM_DAC = [
    0.0000, 0.0137, 0.0205, 0.0291, 0.0423, 0.0618, 0.0847, 0.1369, 
    0.1691, 0.2647, 0.3527, 0.4499, 0.5704, 0.6873, 0.8482, 1.0000
];

class YMHifiProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clock = 2000000; 
        this.regs = new Uint8Array(16); 
        this.phaseA = 0; this.phaseB = 0; this.phaseC = 0;
        this.lfoPhase = 0.0; 
        this.envPhase = 0.0;
        
        this.fLow = [0, 0, 0]; this.fBand = [0, 0, 0]; 
        this.nLow = 0; this.nBand = 0; 
        
        this.delayBufL = new Float32Array(131072);
        this.delayBufR = new Float32Array(131072);
        this.delayMask = 131071;
        this.delayIdx = 0;
        this.delayTime = 0; 
        
        this.delayLpL = 0; this.delayLpR = 0; 
        this.delayHpL = 0; this.delayHpR = 0;
        
        this.sidechainEnv = 1.0; 
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
            } else if (event.data.type === 'STOP_TRACK') {
                this.isPlaying = false;
            } else if (event.data.type === 'RESUME_TRACK') {
                this.isPlaying = true; 
            }
        };
    }

    applyFilter(input, ch, cutoffHz, resonance) {
        if (isNaN(cutoffHz) || cutoffHz < 0) cutoffHz = 100;
        if (cutoffHz > 16000) cutoffHz = 16000; 
        let q = 1.0 - resonance;
        let f = 2.0 * Math.sin(Math.PI * cutoffHz / sampleRate);
        if (f > 1.9 - q) f = 1.9 - q; 
        
        this.fLow[ch] += f * this.fBand[ch];
        let high = input - this.fLow[ch] - q * this.fBand[ch];
        this.fBand[ch] += f * high;
        
        // Anti-Crash Airbag
        if (isNaN(this.fLow[ch])) { this.fLow[ch] = 0; this.fBand[ch] = 0; }
        return this.fLow[ch]; 
    }

    process(inputs, outputs) {
        const outL = outputs[0][0];  
        const outR = outputs[0][1] || outputs[0][0]; 
        let currentVisualValue = 0;

        if (this.delayTime === 0) this.delayTime = Math.floor(sampleRate * 0.375);

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
                            this.sidechainEnv = 0.5; 
                            this.port.postMessage({ type: 'DEBUG', msg: 'Drum ' + activeDigiTrigger });
                        }
                    }
                    this.lastDigiTrigger = activeDigiTrigger;
                    this.currentFrame = (this.currentFrame + 1) % this.trackData.length;
                }
            }

            this.sidechainEnv += (1.0 - this.sidechainEnv) * 0.003;

            let pA = ((this.regs[1] & 0x0F) << 8) | this.regs[0];
            let pB = ((this.regs[3] & 0x0F) << 8) | this.regs[2];
            let pC = ((this.regs[5] & 0x0F) << 8) | this.regs[4];
            
            let incA = (2000000 / (16 * (pA === 0 ? 1 : pA))) / sampleRate;
            let incB = (2000000 / (16 * (pB === 0 ? 1 : pB))) / sampleRate;
            let incC = (2000000 / (16 * (pC === 0 ? 1 : pC))) / sampleRate;

            this.phaseA = (this.phaseA + incA) % 1.0;
            this.phaseB = (this.phaseB + incB) % 1.0;
            this.phaseC = (this.phaseC + incC) % 1.0;
            this.lfoPhase = (this.lfoPhase + 2.0 / sampleRate) % 1.0; 
            
            const mix = this.regs[7];
            let tA = (mix & 0x01) === 0; let tB = (mix & 0x02) === 0; let tC = (mix & 0x04) === 0;
            let nA = (mix & 0x08) === 0; let nB = (mix & 0x10) === 0; let nC = (mix & 0x20) === 0;

            let lfoA = Math.sin(this.lfoPhase * 2.0 * Math.PI) * 0.2 + 0.5;
            let lfoB = Math.sin((this.lfoPhase + 0.33) * 2.0 * Math.PI) * 0.2 + 0.5;
            let lfoC = Math.sin((this.lfoPhase + 0.66) * 2.0 * Math.PI) * 0.2 + 0.5;

            let oscA = (this.phaseA < lfoA ? 1.0 : -1.0) * 0.6 + ((this.phaseA * 2.0 - 1.0) * 0.4);
            let oscB = (this.phaseB < lfoB ? 1.0 : -1.0) * 0.6 + ((this.phaseB * 2.0 - 1.0) * 0.4);
            let oscC = (this.phaseC < lfoC ? 1.0 : -1.0) * 0.6 + ((this.phaseC * 2.0 - 1.0) * 0.4);

            let sigA = tA ? oscA : 0.0;
            let sigB = tB ? oscB : 0.0;
            let sigC = tC ? oscC : 0.0;

            let pN = this.regs[6] & 0x1F;
            let noiseVal = 0;
            if (nA || nB || nC) {
                let rawNoise = (Math.random() * 2.0 - 1.0);
                let cutoffN = 4000 + (31 - pN) * 150; 
                let fN = 2.0 * Math.sin(Math.PI * cutoffN / sampleRate);
                this.nLow += fN * this.nBand;
                let nHigh = rawNoise - this.nLow - 0.5 * this.nBand;
                this.nBand += fN * nHigh;
                noiseVal = nHigh * 0.8; 
            }

            if (nA) sigA += noiseVal;
            if (nB) sigB += noiseVal;
            if (nC) sigC += noiseVal;

            this.envPhase += (2000000 / (256 * (((this.regs[12] << 8) | this.regs[11]) === 0 ? 1 : ((this.regs[12] << 8) | this.regs[11])))) / sampleRate;
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

            // SICHERHEIT: Math.max(0) verhindert, dass Math.pow bei -0.001 abstürzt!
            let vA = Math.max(0, volA_raw) / 15.0;
            let vB = Math.max(0, volB_raw) / 15.0;
            let vC = Math.max(0, volC_raw) / 15.0;

            let sweepA = Math.pow(vA, 1.5);
            let sweepB = Math.pow(vB, 1.5);
            let sweepC = Math.pow(vC, 1.5);

            sigA = this.applyFilter(sigA, 0, 150 + sweepA * 14000, 0.45); 
            sigB = this.applyFilter(sigB, 1, 150 + sweepB * 14000, 0.45); 
            sigC = this.applyFilter(sigC, 2, 150 + sweepC * 14000, 0.45); 

            let volA = YM_DAC[volA_raw];
            let volB = YM_DAC[volB_raw];
            let volC = YM_DAC[volC_raw];

            let digiSample = 0;
            if (this.currentDigidrum) {
                let posInt = Math.floor(this.digiPos);
                if (posInt < this.currentDigidrum.length) {
                    digiSample = this.currentDigidrum[posInt] * 1.0; 
                    // DIE HISTORISCH EXAKTE SAMPLE RATE DES ATARI TIMER C (2 MHz / 256)
                    this.digiPos += 7812.5 / sampleRate; 
                } else this.currentDigidrum = null; 
            }

            let synthA = sigA * volA * this.sidechainEnv * 0.7;
            let synthB = sigB * volB * this.sidechainEnv * 0.7;
            let synthC = sigC * volC * this.sidechainEnv * 0.7;
            
            let mixL = (synthA * 0.707) + (synthB * 0.85) + (synthC * 0.35) + (digiSample * 0.5);
            let mixR = (synthA * 0.707) + (synthB * 0.35) + (synthC * 0.85) + (digiSample * 0.5);

            let readIdxL = (this.delayIdx - this.delayTime + 131072) & this.delayMask;
            let readIdxR = (this.delayIdx - this.delayTime + 131072 + Math.floor(this.delayTime/2)) & this.delayMask;
            
            this.delayLpL += 0.4 * (this.delayBufL[readIdxL] - this.delayLpL); 
            this.delayLpR += 0.4 * (this.delayBufR[readIdxR] - this.delayLpR); 

            let delayFeedback = 0.25; 
            let finalL = mixL + this.delayLpL * delayFeedback;
            let finalR = mixR + this.delayLpR * delayFeedback;

            this.delayBufL[this.delayIdx] = mixR + this.delayLpL * 0.15;
            this.delayBufR[this.delayIdx] = mixL + this.delayLpR * 0.15;
            this.delayIdx = (this.delayIdx + 1) & this.delayMask;

            finalL = Math.tanh(finalL * 0.9);
            finalR = Math.tanh(finalR * 0.9);

            // MASTER AIRBAG (Zerstört jedes NaN bevor es den Chip verlässt!)
            if (isNaN(finalL)) finalL = 0;
            if (isNaN(finalR)) finalR = 0;

            let dcBlockL = finalL - this.lastInL + 0.995 * this.lastOutL;
            this.lastInL = finalL; this.lastOutL = dcBlockL;
            
            let dcBlockR = finalR - this.lastInR + 0.995 * this.lastOutR;
            this.lastInR = finalR; this.lastOutR = dcBlockR;

            outL[i] = dcBlockL;
            if (outR) outR[i] = dcBlockR;
            if (i === 0) currentVisualValue = (dcBlockL + dcBlockR) / 2.0;
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
registerProcessor('ym-hifi-processor', YMHifiProcessor);
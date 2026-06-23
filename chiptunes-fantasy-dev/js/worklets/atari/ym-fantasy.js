import { YM_DAC, polyBLEP, cubicInterpolate, FourPoleFilter, MoogFilter, DCBlocker } from '../lib/dsp-utils.js';
import { DynamicStaging } from '../lib/dynamic-staging.js';

class YMFantasyProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clock = 2000000; 
        this.regs = new Uint8Array(16); 
        this.phaseA = 0; this.phaseB1 = 0; this.phaseB2 = 0; this.phaseC = 0;
        this.lfoPhase1 = 0.0; 
        this.noiseLfsr = 1; this.noisePhase = 0; this.noiseOutput = 1;
        this.envPhase = 0.0;
        
        // Modulare DSP Pipeline Instanzen
        this.stager = new DynamicStaging();
        
        this.filterA = new FourPoleFilter();
        this.filterB_L = new FourPoleFilter(); this.filterB_R = new FourPoleFilter();
        this.filterC_L = new FourPoleFilter(); this.filterC_R = new FourPoleFilter();
        
        this.noiseHp = new MoogFilter(); 
        this.noiseLp1 = new MoogFilter(); this.noiseLp2 = new MoogFilter(); 
        
        this.dcBlockL = new DCBlocker();
        this.dcBlockR = new DCBlocker();

        this.delayBufL = new Float32Array(131072); this.delayBufR = new Float32Array(131072);
        this.delayMask = 131071; this.delayIdx = 0; this.delayTime = 0; 
        this.delayLpL = 0; this.delayLpR = 0; this.delayHpL = 0; this.delayHpR = 0;
        
        // True Voltage Slews
        this.smoothVoltA = 0; this.smoothVoltB = 0; this.smoothVoltC = 0;
        this.sidechainEnv = 1.0; 

        this.digidrums = []; this.currentDigidrum = null; this.digiPos = 0; this.lastDigiTrigger = 0;
        this.trackData = null; this.currentFrame = 0; this.sampleCounter = 0; this.isPlaying = false;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'PLAY_TRACK') {
                this.trackData = event.data.track;
                this.digidrums = event.data.digidrums || []; 
                this.currentFrame = 0; this.sampleCounter = 0; this.currentDigidrum = null;
                this.lastDigiTrigger = 0; this.envPhase = 0; this.isPlaying = true;
            } else if (event.data.type === 'STOP_TRACK') this.isPlaying = false;
            else if (event.data.type === 'RESUME_TRACK') this.isPlaying = true; 
        };
    }

    process(inputs, outputs) {
        const outL = outputs[0][0]; const outR = outputs[0][1] || outputs[0][0]; 
        let currentVisualValue = 0;

        if (this.delayTime === 0) this.delayTime = Math.floor(sampleRate * 0.375);
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
                        if (r === 13) { if (frame[13] !== 0xFF) { this.regs[13] = frame[13]; this.envPhase = 0.0; } } 
                        else this.regs[r] = frame[r];
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
                            this.sidechainEnv = 0.45; 
                            this.port.postMessage({ type: 'DEBUG', msg: 'Drum ' + activeDigiTrigger });
                        }
                    }
                    this.lastDigiTrigger = activeDigiTrigger;
                    this.currentFrame = (this.currentFrame + 1) % this.trackData.length;
                }
            }

            this.sidechainEnv += (1.0 - this.sidechainEnv) * 0.002;

            let pA = ((this.regs[1] & 0x0F) << 8) | this.regs[0];
            let pB = ((this.regs[3] & 0x0F) << 8) | this.regs[2];
            let pC = ((this.regs[5] & 0x0F) << 8) | this.regs[4];
            
            let incA = (2000000 / (16 * (pA === 0 ? 1 : pA))) / sampleRate;
            let incB = (2000000 / (16 * (pB === 0 ? 1 : pB))) / sampleRate;
            let incC = (2000000 / (16 * (pC === 0 ? 1 : pC))) / sampleRate;

            this.phaseA = (this.phaseA + incA) % 1.0;
            this.phaseB1 = (this.phaseB1 + incB) % 1.0;
            this.phaseB2 = (this.phaseB2 + incB * 1.003) % 1.0; 
            this.phaseC = (this.phaseC + incC) % 1.0;
            this.lfoPhase1 = (this.lfoPhase1 + 1.8 / sampleRate) % 1.0; 

            const mix = this.regs[7];
            let tA = (mix & 0x01) === 0; let tB = (mix & 0x02) === 0; let tC = (mix & 0x04) === 0;
            let nA = (mix & 0x08) === 0; let nB = (mix & 0x10) === 0; let nC = (mix & 0x20) === 0;

            // --- EXTERNES DYNAMIC STAGING ---
            let stage = this.stager.update(pA, pB, pC, nA, nB, nC);

            let sqA = (this.phaseA < 0.5 ? 1.0 : -1.0) + polyBLEP(this.phaseA, incA) - polyBLEP((this.phaseA + 0.5) % 1.0, incA);
            let sFundA = Math.sin(this.phaseA * 2.0 * Math.PI); 
            let sigA = tA ? (sqA * (1.0 - stage.A.sub*0.4) + sFundA * stage.A.sub * 1.2) : 0.0; 

            let sawB1 = ((this.phaseB1 * 2.0) - 1.0) - polyBLEP(this.phaseB1, incB);
            let sawB2 = ((this.phaseB2 * 2.0) - 1.0) - polyBLEP(this.phaseB2, incB * 1.003);
            let sFundB = Math.sin(this.phaseB1 * 2.0 * Math.PI);
            let sigB_L = tB ? (sawB1 * (1.0 - stage.B.sub*0.4) + sFundB * stage.B.sub * 1.2) : 0.0;
            let sigB_R = tB ? (sawB2 * (1.0 - stage.B.sub*0.4) + sFundB * stage.B.sub * 1.2) : 0.0;

            let pwmWidth = Math.sin(this.lfoPhase1 * 2.0 * Math.PI) * 0.3 + 0.5;
            let pwmC = (this.phaseC < pwmWidth ? 1.0 : -1.0) + polyBLEP(this.phaseC, incC) - polyBLEP((this.phaseC + pwmWidth) % 1.0, incC);
            let sFundC = Math.sin(this.phaseC * 2.0 * Math.PI);
            let sigC_L = tC ? (pwmC * (1.0 - stage.C.sub*0.4) + sFundC * stage.C.sub * 1.2) : 0.0;
            let sigC_R = sigC_L;

            this.noisePhase += (2000000 / (16 * ((this.regs[6] & 0x1F) === 0 ? 1 : (this.regs[6] & 0x1F)))) / sampleRate;
            if (this.noisePhase >= 1.0) {
                this.noisePhase %= 1.0;
                this.noiseLfsr ^= (((this.noiseLfsr & 1) ^ ((this.noiseLfsr >> 3) & 1)) << 17);
                this.noiseLfsr >>= 1;
                this.noiseOutput = (this.noiseLfsr & 1) ? 1.0 : -1.0;
            }

            let pN = this.regs[6] & 0x1F;
            let noiseVal = 0; let subNoiseVal = 0;
            if (nA || nB || nC) {
                let rawNoise = (Math.random() * 2.0 - 1.0);
                if (pN > 12) {
                    let cutoffN = 150 + (31 - pN) * 20; 
                    let nLow1 = this.noiseLp1.process(rawNoise, cutoffN, 0.2, sampleRate);
                    subNoiseVal = this.noiseLp2.process(nLow1, cutoffN, 0.2, sampleRate) * 2.0; 
                } else {
                    let cutoffHp = 4000 + (12 - pN) * 500;
                    let hpHigh = rawNoise - this.noiseHp.process(rawNoise, cutoffHp, 0.5, sampleRate);
                    noiseVal = hpHigh * 0.6;
                }
            }

            if (nA) sigA += noiseVal + subNoiseVal; 
            if (nB) { sigB_L += noiseVal + subNoiseVal; sigB_R += noiseVal + subNoiseVal; }
            if (nC) { sigC_L += noiseVal + subNoiseVal; sigC_R += noiseVal + subNoiseVal; }

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

            let targetVolA = (this.regs[8] & 0x10) ? YM_DAC[envVolIndex] : YM_DAC[this.regs[8] & 0x0F];
            let targetVolB = (this.regs[9] & 0x10) ? YM_DAC[envVolIndex] : YM_DAC[this.regs[9] & 0x0F];
            let targetVolC = (this.regs[10] & 0x10) ? YM_DAC[envVolIndex] : YM_DAC[this.regs[10] & 0x0F];

            let slewSpeedA = (this.regs[8] & 0x10) ? 1.0 : (targetVolA > this.smoothVoltA ? 0.002 : 0.0003);
            let slewSpeedB = (this.regs[9] & 0x10) ? 1.0 : (targetVolB > this.smoothVoltB ? 0.002 : 0.0003);
            let slewSpeedC = (this.regs[10] & 0x10) ? 1.0 : (targetVolC > this.smoothVoltC ? 0.002 : 0.0003);
            
            this.smoothVoltA += (targetVolA - this.smoothVoltA) * slewSpeedA;
            this.smoothVoltB += (targetVolB - this.smoothVoltB) * slewSpeedB;
            this.smoothVoltC += (targetVolC - this.smoothVoltC) * slewSpeedC;

            let sweepA = Math.pow(this.smoothVoltA, 1.5);
            let sweepB = Math.pow(this.smoothVoltB, 1.5);
            let sweepC = Math.pow(this.smoothVoltC, 1.5);

            let cutA = 250 + sweepA * (12000 - stage.A.sub * 10000); 
            let cutB = 250 + sweepB * (12000 - stage.B.sub * 10000);
            let cutC = 250 + sweepC * (12000 - stage.C.sub * 10000);

            // Filter Processing via externem Module!
            sigA = this.filterA.process(sigA, cutA, 0.45 - stage.A.sub*0.35, sampleRate);
            sigB_L = this.filterB_L.process(sigB_L, cutB, 0.45 - stage.B.sub*0.35, sampleRate);
            sigB_R = this.filterB_R.process(sigB_R, cutB+50, 0.45 - stage.B.sub*0.35, sampleRate);
            sigC_L = this.filterC_L.process(sigC_L, cutC, 0.45 - stage.C.sub*0.35, sampleRate);
            sigC_R = this.filterC_R.process(sigC_R, cutC+50, 0.45 - stage.C.sub*0.35, sampleRate);

            let volA = this.smoothVoltA;
            let volB = this.smoothVoltB;
            let volC = this.smoothVoltC;

            // --- CUBIC PCM ---
            let digiSample = 0;
            if (this.currentDigidrum) {
                let posInt = Math.floor(this.digiPos);
                let mu = this.digiPos - posInt;
                digiSample = cubicInterpolate(
                    this.currentDigidrum[posInt - 1] || 0, this.currentDigidrum[posInt],
                    this.currentDigidrum[posInt + 1] || 0, this.currentDigidrum[posInt + 2] || 0, mu) * 0.8; 
                this.digiPos += 7812.5 / sampleRate; 
                if (this.digiPos >= this.currentDigidrum.length - 2) this.currentDigidrum = null; 
            }

            // --- GAIN STAGING ---
            let lvlA_L = sigA * volA * this.sidechainEnv * 0.18;
            let lvlA_R = sigA * volA * this.sidechainEnv * 0.18;
            let lvlB_L = sigB_L * volB * this.sidechainEnv * 0.18;
            let lvlB_R = sigB_R * volB * this.sidechainEnv * 0.18;
            let lvlC_L = sigC_L * volC * this.sidechainEnv * 0.18;
            let lvlC_R = sigC_R * volC * this.sidechainEnv * 0.18;

            let epL_A = Math.cos(stage.A.pan * Math.PI * 0.5); let epR_A = Math.sin(stage.A.pan * Math.PI * 0.5);
            let epL_B = Math.cos(stage.B.pan * Math.PI * 0.5); let epR_B = Math.sin(stage.B.pan * Math.PI * 0.5);
            let epL_C = Math.cos(stage.C.pan * Math.PI * 0.5); let epR_C = Math.sin(stage.C.pan * Math.PI * 0.5);

            let mixL = (lvlA_L * epL_A) + (lvlB_L * epL_B) + (lvlC_L * epL_C) + (digiSample * 0.5);
            let mixR = (lvlA_R * epR_A) + (lvlB_R * epR_B) + (lvlC_R * epR_C) + (digiSample * 0.5);

            let readIdxL = (this.delayIdx - tap1 + 65536) % 65536;
            let readIdxR = (this.delayIdx - tap2 + 65536) % 65536;
            let readIdx3L = (this.delayIdx - tap3 + 65536) % 65536;
            let readIdx3R = (this.delayIdx - tap3 + 65536) % 65536;

            let r1L = this.delayBufL[readIdxL];
            let r2R = this.delayBufR[readIdxR];
            let r3L = this.delayBufL[readIdx3L];
            let r3R = this.delayBufR[readIdx3R];

            this.delayLpL += 0.2 * ((r1L + r3R) * 0.5 - this.delayLpL); 
            this.delayLpR += 0.2 * ((r2R + r3L) * 0.5 - this.delayLpR); 

            let finalL = mixL + this.delayLpL * 0.6; 
            let finalR = mixR + this.delayLpR * 0.6;

            this.delayBufL[this.delayIdx] = mixR * 0.4 + this.delayLpL * 0.5;
            this.delayBufR[this.delayIdx] = mixL * 0.4 + this.delayLpR * 0.5;
            this.delayIdx = (this.delayIdx + 1) % 65536;

            finalL = (Math.tanh(finalL * 2.8) / 1.1) * 0.95;
            finalR = (Math.tanh(finalR * 2.8) / 1.1) * 0.95;

            // DC Blocker via externes Modul
            let dcL = this.dcBlockL.process(finalL);
            let dcR = this.dcBlockR.process(finalR);

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
registerProcessor('ym-fantasy-processor', YMFantasyProcessor);
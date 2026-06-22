// =========================================================
// YM2149F "CHIPTUNES FANTASY" CORE (The Ultimate Mastering)
// True Analog Voltage Slewing & Perfect Gain Equilibrium
// =========================================================

// Exakte logarithmische Spannungswerte eines echten YM2149 Digital-Analog-Wandlers
const YM_DAC = [
    0.0000, 0.0137, 0.0205, 0.0291, 0.0423, 0.0618, 0.0847, 0.1369, 
    0.1691, 0.2647, 0.3527, 0.4499, 0.5704, 0.6873, 0.8482, 1.0000
];

function polyBLEP(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1.0; }
    else if (t > 1.0 - dt) { t = (t - 1.0 + dt) / dt; return 1.0 - (t + t - t * t); }
    return 0.0;
}

function cubicInterpolate(y0, y1, y2, y3, mu) {
    let mu2 = mu * mu;
    let a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
    let a1 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    let a2 = -0.5 * y0 + 0.5 * y2;
    return (a0 * mu * mu2 + a1 * mu2 + a2 * mu + y1);
}

class YMFantasyProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clock = 2000000; 
        this.regs = new Uint8Array(16); 
        
        this.phaseA = 0; 
        this.phaseB_L = 0; this.phaseB_R = 0; 
        this.phaseC_L = 0; this.phaseC_R = 0; 
        this.pwmPhase = 0.0; 
        
        this.noiseLfsr = 1; this.noisePhase = 0; this.noiseOutput = 1;
        this.envPhase = 0.0;
        
        this.f1Low = [0,0,0,0,0,0]; this.f1Band = [0,0,0,0,0,0]; 
        this.f2Low = [0,0,0,0,0,0]; this.f2Band = [0,0,0,0,0,0]; 
        this.nLow1 = 0; this.nBand1 = 0; this.nLow2 = 0; this.nBand2 = 0; 
        this.nHpLow = 0; this.nHpBand = 0; 
        
        this.delayBufL = new Float32Array(131072); 
        this.delayBufR = new Float32Array(131072);
        this.delayMask = 131071;
        this.delayIdx = 0;
        this.delayTime = 0; 
        this.delayLpL = 0; this.delayLpR = 0; 
        this.delayHpL = 0; this.delayHpR = 0;
        
        // Spannungsspeicher für die Analog-Glättung
        this.smoothVoltA = 0.0; this.smoothVoltB = 0.0; this.smoothVoltC = 0.0;
        
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

        this.panA = 0.5; this.panB = 0.5; this.panC = 0.5;
        this.subA = 0.0; this.subB = 0.0; this.subC = 0.0;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'PLAY_TRACK') {
                this.trackData = event.data.track;
                this.digidrums = event.data.digidrums || []; 
                this.currentFrame = 0;
                this.sampleCounter = 0;
                this.currentDigidrum = null;
                this.lastDigiTrigger = 0;
                this.envPhase = 0;
                this.isPlaying = true;
            } else if (event.data.type === 'STOP_TRACK') {
                this.isPlaying = false;
            } else if (event.data.type === 'RESUME_TRACK') {
                this.isPlaying = true; 
            }
        };
    }

    apply4PoleFilter(input, ch, cutoffHz, resonance) {
        if (cutoffHz < 20) cutoffHz = 20;
        if (cutoffHz > 20000) cutoffHz = 20000; 
        let q = 1.0 - (resonance * 0.8); 
        let f = 2.0 * Math.sin(Math.PI * cutoffHz / sampleRate);
        if (f > 1.9 - q) f = 1.9 - q; 
        
        this.f1Low[ch] += f * this.f1Band[ch];
        let high1 = input - this.f1Low[ch] - q * this.f1Band[ch];
        this.f1Band[ch] += f * high1;
        this.f2Low[ch] += f * this.f2Band[ch];
        let high2 = this.f1Low[ch] - this.f2Low[ch] - q * this.f2Band[ch];
        this.f2Band[ch] += f * high2;

        if (isNaN(this.f2Low[ch])) { this.f1Low[ch]=0; this.f1Band[ch]=0; this.f2Low[ch]=0; this.f2Band[ch]=0; }
        return this.f2Low[ch]; 
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
                            // Sanfter Sidechain, der den Mix nicht abwürgt
                            this.sidechainEnv = 0.6; 
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

            this.pwmPhase = (this.pwmPhase + 1.5 / sampleRate) % 1.0; 
            this.phaseA = (this.phaseA + incA) % 1.0;
            this.phaseB_L = (this.phaseB_L + incB * 1.002) % 1.0;
            this.phaseB_R = (this.phaseB_R + incB * 0.998) % 1.0;
            this.phaseC_L = (this.phaseC_L + incC * 1.002) % 1.0;
            this.phaseC_R = (this.phaseC_R + incC * 0.998) % 1.0;

            const mix = this.regs[7];
            let tA = (mix & 0x01) === 0; let tB = (mix & 0x02) === 0; let tC = (mix & 0x04) === 0;
            let nA = (mix & 0x08) === 0; let nB = (mix & 0x10) === 0; let nC = (mix & 0x20) === 0;

            // =========================================================
            // DYNAMIC STAGING: Rollen & Panning
            // =========================================================
            let tPanA = 0.2; let tSubA = 0.0; 
            let tPanB = 0.8; let tSubB = 0.0;
            let tPanC = 0.5; let tSubC = 0.0; 

            // Bass Detection (KORRIGIERT!)
            // Periode > 800 entspricht Frequenzen unter ~156 Hz (D#3 und tiefer).
            // Das schützt die Melodien davor, plötzlich zum dumpfen Bass zu mutieren!
            if (pA > 800 && !nA) { tPanA = 0.5; tSubA = 1.0; }
            if (pB > 800 && !nB) { tPanB = 0.5; tSubB = 1.0; }
            if (pC > 800 && !nC) { tPanC = 0.5; tSubC = 1.0; }

            // Percussion Override (Wenn Noise aktiv ist, ab in die Mitte)
            if (nA) { tPanA = 0.5; tSubA = 0.0; }
            if (nB) { tPanB = 0.5; tSubB = 0.0; }
            if (nC) { tPanC = 0.5; tSubC = 0.0; }

            // Slew Limiting für weiche Panorama-Fahrten
            let stageSpeed = 0.002; 
            this.panA += (tPanA - this.panA) * stageSpeed; this.subA += (tSubA - this.subA) * stageSpeed;
            this.panB += (tPanB - this.panB) * stageSpeed; this.subB += (tSubB - this.subB) * stageSpeed;
            this.panC += (tPanC - this.panC) * stageSpeed; this.subC += (tSubC - this.subC) * stageSpeed;

            // --- OSCILLATORS (Mathematisch normiert = Konstante maximale Amplitude von 1.0) ---
            let pwmWidth = Math.sin(this.pwmPhase * 2.0 * Math.PI) * 0.25 + 0.5;

            // Kanal A
            let sqA = (this.phaseA < pwmWidth ? 1.0 : -1.0) + polyBLEP(this.phaseA, incA) - polyBLEP((this.phaseA + pwmWidth) % 1.0, incA);
            let sFundA = Math.sin(this.phaseA * 2.0 * Math.PI); 
            // Die Amplitude beider Schwingungen zusammen ist exakt 1.0, egal wie das Staging mischt!
            let sigA = tA ? (sqA * (1.0 - this.subA*0.3) + sFundA * (this.subA*0.7)) : 0.0; 

            // Kanal B
            let sawB_L = ((this.phaseB_L * 2.0) - 1.0) - polyBLEP(this.phaseB_L, incB * 1.002);
            let sawB_R = ((this.phaseB_R * 2.0) - 1.0) - polyBLEP(this.phaseB_R, incB * 0.998);
            let sFundB = Math.sin(this.phaseB_L * 2.0 * Math.PI);
            let sigB_L = tB ? (sawB_L * (1.0 - this.subB*0.3) + sFundB * (this.subB*0.7)) : 0.0;
            let sigB_R = tB ? (sawB_R * (1.0 - this.subB*0.3) + sFundB * (this.subB*0.7)) : 0.0;

            // Kanal C
            let sawC_L = ((this.phaseC_L * 2.0) - 1.0) - polyBLEP(this.phaseC_L, incC * 1.002);
            let sawC_R = ((this.phaseC_R * 2.0) - 1.0) - polyBLEP(this.phaseC_R, incC * 0.998);
            let sFundC = Math.sin(this.phaseC_L * 2.0 * Math.PI);
            let sigC_L = tC ? (sawC_L * (1.0 - this.subC*0.3) + sFundC * (this.subC*0.7)) : 0.0;
            let sigC_R = tC ? (sawC_R * (1.0 - this.subC*0.3) + sFundC * (this.subC*0.7)) : 0.0;

            // --- STUDIO NOISE (Normiert & Equalized) ---
            let pN = this.regs[6] & 0x1F;
            let noiseVal = 0; let subNoiseVal = 0;
            if (nA || nB || nC) {
                let rawNoise = (Math.random() * 2.0 - 1.0);
                if (pN > 12) {
                    let cutoffN = 150 + (31 - pN) * 20; 
                    let fN = 2.0 * Math.sin(Math.PI * cutoffN / sampleRate);
                    this.nLow1 += fN * this.nBand1; let h1 = rawNoise - this.nLow1 - 0.2 * this.nBand1; this.nBand1 += fN * h1;
                    this.nLow2 += fN * this.nBand2; let h2 = this.nLow1 - this.nLow2 - 0.2 * this.nBand2; this.nBand2 += fN * h2;
                    subNoiseVal = this.nLow2 * 1.5; // Pegel reduziert
                } else {
                    let cutoffHp = 5000 + (12 - pN) * 500;
                    let fHp = 2.0 * Math.sin(Math.PI * cutoffHp / sampleRate);
                    this.nHpLow += fHp * this.nHpBand;
                    let hpHigh = rawNoise - this.nHpLow - 0.5 * this.nHpBand;
                    this.nHpBand += fHp * hpHigh;
                    noiseVal = hpHigh * 0.4; // Pegel reduziert
                }
            }

            // Mischung Tone + Noise (Dämpft Tone etwas ab, wenn Noise anliegt, um Übersteuern zu verhindern!)
            if (nA) sigA = (sigA * 0.6) + noiseVal + subNoiseVal; 
            if (nB) { sigB_L = (sigB_L * 0.6) + noiseVal + subNoiseVal; sigB_R = (sigB_R * 0.6) + noiseVal + subNoiseVal; }
            if (nC) { sigC_L = (sigC_L * 0.6) + noiseVal + subNoiseVal; sigC_R = (sigC_R * 0.6) + noiseVal + subNoiseVal; }

            // --- ENVELOPES ---
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

            // ZIEL-SPANNUNGEN (0.0 bis 1.0) aus der YM_DAC Tabelle ermitteln!
            let targetVolA = (this.regs[8] & 0x10) ? YM_DAC[envVolIndex] : YM_DAC[this.regs[8] & 0x0F];
            let targetVolB = (this.regs[9] & 0x10) ? YM_DAC[envVolIndex] : YM_DAC[this.regs[9] & 0x0F];
            let targetVolC = (this.regs[10] & 0x10) ? YM_DAC[envVolIndex] : YM_DAC[this.regs[10] & 0x0F];

            // --- ANALOG SLEW LIMITING (Auf echter elektrischer Spannung) ---
            let slewA = (this.regs[8] & 0x10) ? 1.0 : (targetVolA > this.smoothVoltA ? 0.3 : 0.002);
            let slewB = (this.regs[9] & 0x10) ? 1.0 : (targetVolB > this.smoothVoltB ? 0.3 : 0.002);
            let slewC = (this.regs[10] & 0x10) ? 1.0 : (targetVolC > this.smoothVoltC ? 0.3 : 0.002);
            
            this.smoothVoltA += (targetVolA - this.smoothVoltA) * slewA;
            this.smoothVoltB += (targetVolB - this.smoothVoltB) * slewB;
            this.smoothVoltC += (targetVolC - this.smoothVoltC) * slewC;

            // Die geglättete, exakte Spannung für Filter und Lautstärke nutzen!
            let sweepA = Math.pow(this.smoothVoltA, 0.75);
            let sweepB = Math.pow(this.smoothVoltB, 0.75);
            let sweepC = Math.pow(this.smoothVoltC, 0.75);

            let cutA = 200 + sweepA * (this.subA > 0.5 ? 2000 : 12000);
            let cutB = 200 + sweepB * (this.subB > 0.5 ? 2000 : 12000);
            let cutC = 200 + sweepC * (this.subC > 0.5 ? 2000 : 12000);

            let resA = 0.4 - (this.subA * 0.35);
            let resB = 0.4 - (this.subB * 0.35);
            let resC = 0.4 - (this.subC * 0.35);

            sigA   = this.apply4PoleFilter(sigA, 0, cutA, resA); 
            sigB_L = this.apply4PoleFilter(sigB_L, 1, cutB, resB); 
            sigB_R = this.apply4PoleFilter(sigB_R, 2, cutB + 50, resB); 
            sigC_L = this.apply4PoleFilter(sigC_L, 3, cutC, resC); 
            sigC_R = this.apply4PoleFilter(sigC_R, 4, cutC + 50, resC); 

            // --- CUBIC INTERPOLATION PCM ---
            let digiSample = 0;
            if (this.currentDigidrum) {
                let posInt = Math.floor(this.digiPos);
                let mu = this.digiPos - posInt;
                let y0 = this.currentDigidrum[posInt - 1] || 0;
                let y1 = this.currentDigidrum[posInt];
                let y2 = this.currentDigidrum[posInt + 1] || 0;
                let y3 = this.currentDigidrum[posInt + 2] || 0;
                
                digiSample = cubicInterpolate(y0, y1, y2, y3, mu) * 0.8; 
                this.digiPos += 7812.5 / sampleRate; 
                if (this.digiPos >= this.currentDigidrum.length - 2) this.currentDigidrum = null; 
            }

            // --- GAIN STAGING ---
            // Volle Multiplikation der geglätteten Lautstärke (True Gain)
            let lvlA = sigA * this.smoothVoltA * this.sidechainEnv * 0.22;
            let lvlB_L = sigB_L * this.smoothVoltB * this.sidechainEnv * 0.22;
            let lvlB_R = sigB_R * this.smoothVoltB * this.sidechainEnv * 0.22;
            let lvlC_L = sigC_L * this.smoothVoltC * this.sidechainEnv * 0.22;
            let lvlC_R = sigC_R * this.smoothVoltC * this.sidechainEnv * 0.22;

            let epL_A = Math.cos(this.panA * Math.PI * 0.5); let epR_A = Math.sin(this.panA * Math.PI * 0.5);
            let epL_B = Math.cos(this.panB * Math.PI * 0.5); let epR_B = Math.sin(this.panB * Math.PI * 0.5);
            let epL_C = Math.cos(this.panC * Math.PI * 0.5); let epR_C = Math.sin(this.panC * Math.PI * 0.5);

            let mixL = (lvlA * epL_A) + (lvlB_L * epL_B) + (lvlC_L * epL_C) + (digiSample * 0.4);
            let mixR = (lvlA * epR_A) + (lvlB_R * epR_B) + (lvlC_R * epR_C) + (digiSample * 0.4);

            // --- DELAY ---
            let readIdxL = (this.delayIdx - this.delayTime + 131072) & this.delayMask;
            let readIdxR = (this.delayIdx - this.delayTime + 131072 + Math.floor(this.delayTime/2)) & this.delayMask;
            
            this.delayLpL += 0.3 * (this.delayBufL[readIdxL] - this.delayLpL); 
            this.delayLpR += 0.3 * (this.delayBufR[readIdxR] - this.delayLpR); 
            this.delayHpL += 0.05 * (this.delayLpL - this.delayHpL);
            this.delayHpR += 0.05 * (this.delayLpR - this.delayHpR);

            let tapeEchoL = this.delayLpL - this.delayHpL; 
            let tapeEchoR = this.delayLpR - this.delayHpR;

            let finalL = mixL + tapeEchoL * 0.25;
            let finalR = mixR + tapeEchoR * 0.25;

            this.delayBufL[this.delayIdx] = mixR * 0.25 + tapeEchoL * 0.15;
            this.delayBufR[this.delayIdx] = mixL * 0.25 + tapeEchoR * 0.15;
            this.delayIdx = (this.delayIdx + 1) & this.delayMask;

            // --- MASTERING COMPRESSOR ---
            finalL = (Math.tanh(finalL * 2.8) / 1.1) * 0.95;
            finalR = (Math.tanh(finalR * 2.8) / 1.1) * 0.95;

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
registerProcessor('ym-fantasy-processor', YMFantasyProcessor);
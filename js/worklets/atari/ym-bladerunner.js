// =========================================================
// YM2149F "BLADE RUNNER" CORE (3D Dynamic Staging Edition)
// X/Y/Z-Axis Sound Staging & -18dBFS True Headroom
// =========================================================

const YM_DAC = [
    0.0000, 0.0137, 0.0205, 0.0291, 0.0423, 0.0618, 0.0847, 0.1369, 
    0.1691, 0.2647, 0.3527, 0.4499, 0.5704, 0.6873, 0.8482, 1.0000
];

function polyBLEP(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1.0; }
    else if (t > 1.0 - dt) { t = (t - 1.0 + dt) / dt; return 1.0 - (t + t - t * t); }
    return 0.0;
}

class YMBladeRunnerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clock = 2000000; 
        this.regs = new Uint8Array(16); 
        this.phaseA = 0; this.phaseB1 = 0; this.phaseB2 = 0; this.phaseC = 0;
        this.subPhaseA = 0; this.subPhaseB = 0; this.subPhaseC = 0; // Echte Sub-Oszillatoren!
        this.lfoPhase1 = 0.0; this.lfoPhase2 = 0.0; 
        this.noiseLfsr = 1; this.noisePhase = 0; this.noiseOutput = 1;
        this.envPhase = 0.0;
        
        // 5 Moog-Filter (Mono Bass, Stereo Pad, Stereo Lead)
        this.fLow = new Float32Array(5); 
        this.fBand = new Float32Array(5); 
        
        // Dual-Band Noise Filters
        this.nLow1 = 0; this.nBand1 = 0; this.nLow2 = 0; this.nBand2 = 0; 
        this.nHpLow = 0; this.nHpBand = 0; 
        
        // Cathedral Wash Delay (Reverb Send)
        this.delayBufL = new Float32Array(262144); 
        this.delayBufR = new Float32Array(262144);
        this.delayMask = 262143;
        this.delayIdx = 0;
        this.delayTime = 0; 
        this.delayLpL = 0; this.delayLpR = 0; 
        
        this.smoothVolA = 0; this.smoothVolB = 0; this.smoothVolC = 0;
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
        
        // DYNAMIC STAGING: X-Achse (Pan), Y-Achse (Filter/Sub), Z-Achse (Reverb Send)
        this.stage = {
            A: { pan: 0.5, sub: 0.0, rev: 0.0, cut: 5000 },
            B: { pan: 0.5, sub: 0.0, rev: 0.0, cut: 5000 },
            C: { pan: 0.5, sub: 0.0, rev: 0.0, cut: 5000 }
        };
        
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

    applyMoogFilter(input, ch, cutoffHz, resonance) {
        if (cutoffHz > 16000) cutoffHz = 16000; 
        let q = 1.0 - resonance;
        let f = 2.0 * Math.sin(Math.PI * cutoffHz / sampleRate);
        if (f > 1.9 - q) f = 1.9 - q; 
        
        this.fLow[ch] += f * this.fBand[ch];
        let high = input - this.fLow[ch] - q * this.fBand[ch];
        this.fBand[ch] += f * high;
        
        if (isNaN(this.fLow[ch])) { this.fLow[ch] = 0; this.fBand[ch] = 0; }
        return this.fLow[ch]; 
    }

    process(inputs, outputs) {
        const outL = outputs[0][0];  
        const outR = outputs[0][1] || outputs[0][0]; 
        let currentVisualValue = 0;

        // 120 BPM tempo sync (approx)
        if (this.delayTime === 0) this.delayTime = Math.floor(sampleRate * 0.375);

        const tap1 = Math.floor(sampleRate * 0.43);
        const tap2 = Math.floor(sampleRate * 0.71);
        const tap3 = Math.floor(sampleRate * 1.13);

        for (let i = 0; i < outL.length; i++) {
            if (!this.isPlaying) { outL[i] = 0; if (outR) outR[i] = 0; continue; }

            // --- 50HZ SEQUENCER ---
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
                            this.port.postMessage({ type: 'DEBUG', msg: 'Drum ' + activeDigiTrigger });
                        }
                    }
                    this.lastDigiTrigger = activeDigiTrigger;
                    this.currentFrame = (this.currentFrame + 1) % this.trackData.length;
                }
            }

            let pA = ((this.regs[1] & 0x0F) << 8) | this.regs[0];
            let pB = ((this.regs[3] & 0x0F) << 8) | this.regs[2];
            let pC = ((this.regs[5] & 0x0F) << 8) | this.regs[4];
            
            let incA = (2000000 / (16 * (pA === 0 ? 1 : pA))) / sampleRate;
            let incB = (2000000 / (16 * (pB === 0 ? 1 : pB))) / sampleRate;
            let incC = (2000000 / (16 * (pC === 0 ? 1 : pC))) / sampleRate;

            // LFOs für Analog Drift & Chorus
            this.lfoPhase1 = (this.lfoPhase1 + 0.8 / sampleRate) % 1.0; 
            this.lfoPhase2 = (this.lfoPhase2 + 0.15 / sampleRate) % 1.0; 
            let drift = Math.sin(this.lfoPhase2 * 2.0 * Math.PI) * 0.005; 
            
            this.phaseA = (this.phaseA + incA * (1.0 + drift)) % 1.0;
            this.phaseB1 = (this.phaseB1 + incB * (1.0 + drift)) % 1.0;
            this.phaseB2 = (this.phaseB2 + incB * (1.0 + drift + 0.004)) % 1.0; // Detuned
            this.phaseC = (this.phaseC + incC * (1.0 + drift)) % 1.0;

            // Echte Sub-Oszillatoren (halbe Frequenz = 1 Oktave tiefer!)
            this.subPhaseA = (this.subPhaseA + incA * 0.5 * (1.0 + drift)) % 1.0;
            this.subPhaseB = (this.subPhaseB + incB * 0.5 * (1.0 + drift)) % 1.0;
            this.subPhaseC = (this.subPhaseC + incC * 0.5 * (1.0 + drift)) % 1.0;
            
            const mix = this.regs[7];
            let tA = (mix & 0x01) === 0; let tB = (mix & 0x02) === 0; let tC = (mix & 0x04) === 0;
            let nA = (mix & 0x08) === 0; let nB = (mix & 0x10) === 0; let nC = (mix & 0x20) === 0;

            // =========================================================
            // DYNAMIC STAGING: Rollen-Zuweisung pro Frame!
            // =========================================================
            let rA = { pan: 0.5, sub: 0.0, rev: 0.2, cut: 12000 };
            let rB = { pan: 0.5, sub: 0.0, rev: 0.2, cut: 12000 };
            let rC = { pan: 0.5, sub: 0.0, rev: 0.2, cut: 12000 };

            // Y-ACHSE: Frequenz bestimmt die Rolle
            if (pA > 300) { rA = { pan: 0.50, sub: 1.0, rev: 0.0, cut: 3000 }; } // Bass: Mitte, viel Sub, 0 Reverb (Up Front)
            else { rA = { pan: 0.35, sub: 0.0, rev: 0.4, cut: 14000 }; }         // Lead: Links, kein Sub, Medium Reverb
            
            if (pB > 300) { rB = { pan: 0.50, sub: 1.0, rev: 0.0, cut: 3000 }; }
            else { rB = { pan: 0.85, sub: 0.0, rev: 0.7, cut: 10000 }; }         // Pad: Hart Rechts, Heavy Reverb (Background)
            
            if (pC > 300) { rC = { pan: 0.50, sub: 1.0, rev: 0.0, cut: 3000 }; }
            else { rC = { pan: 0.65, sub: 0.0, rev: 0.4, cut: 14000 }; }         // Lead: Rechts, Medium Reverb

            // PERCUSSION OVERRIDE (Wenn Noise an ist, muss der Sound in die Mitte und knallen!)
            if (nA) { rA = { pan: 0.5, sub: 0.0, rev: 0.1, cut: 16000 }; }
            if (nB) { rB = { pan: 0.5, sub: 0.0, rev: 0.1, cut: 16000 }; }
            if (nC) { rC = { pan: 0.5, sub: 0.0, rev: 0.1, cut: 16000 }; }

            // Slew Limiting für weiche 3D-Fahrten
            let morph = 0.002;
            this.stage.A.pan += (rA.pan - this.stage.A.pan) * morph; this.stage.A.sub += (rA.sub - this.stage.A.sub) * morph;
            this.stage.A.rev += (rA.rev - this.stage.A.rev) * morph; this.stage.A.cut += (rA.cut - this.stage.A.cut) * morph;
            
            this.stage.B.pan += (rB.pan - this.stage.B.pan) * morph; this.stage.B.sub += (rB.sub - this.stage.B.sub) * morph;
            this.stage.B.rev += (rB.rev - this.stage.B.rev) * morph; this.stage.B.cut += (rB.cut - this.stage.B.cut) * morph;
            
            this.stage.C.pan += (rC.pan - this.stage.C.pan) * morph; this.stage.C.sub += (rC.sub - this.stage.C.sub) * morph;
            this.stage.C.rev += (rC.rev - this.stage.C.rev) * morph; this.stage.C.cut += (rC.cut - this.stage.C.cut) * morph;

            // --- OSCILLATORS (Tone) ---
            let sqA = (this.phaseA < 0.5 ? 1.0 : -1.0) + polyBLEP(this.phaseA, incA) - polyBLEP((this.phaseA + 0.5) % 1.0, incA);
            let sSubA = Math.sin(this.subPhaseA * 2.0 * Math.PI); // Echter reiner Sub-Sinus
            let sigA = tA ? (sqA * (1.0 - this.stage.A.sub*0.5) + sSubA * this.stage.A.sub) : 0.0;

            let sawB1 = ((this.phaseB1 * 2.0) - 1.0) - polyBLEP(this.phaseB1, incB);
            let sawB2 = ((this.phaseB2 * 2.0) - 1.0) - polyBLEP(this.phaseB2, incB);
            let sSubB = Math.sin(this.subPhaseB * 2.0 * Math.PI);
            let sigB_L = tB ? (sawB1 * (1.0 - this.stage.B.sub*0.5) + sSubB * this.stage.B.sub) : 0.0;
            let sigB_R = tB ? (sawB2 * (1.0 - this.stage.B.sub*0.5) + sSubB * this.stage.B.sub) : 0.0;

            let pwmWidth = Math.sin(this.lfoPhase1 * 2.0 * Math.PI) * 0.3 + 0.5;
            let pwmC = (this.phaseC < pwmWidth ? 1.0 : -1.0) + polyBLEP(this.phaseC, incC) - polyBLEP((this.phaseC + pwmWidth) % 1.0, incC);
            let sSubC = Math.sin(this.subPhaseC * 2.0 * Math.PI);
            let sigC = tC ? (pwmC * (1.0 - this.stage.C.sub*0.5) + sSubC * this.stage.C.sub) : 0.0;

            // --- ENVELOPES (Slew Limiters) ---
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

            // HEG = Fast Attack. Volume = Cinematic Fade
            let slewSpeedA = (this.regs[8] & 0x10) ? 1.0 : (volA_raw > this.smoothVolA ? 0.005 : 0.0005);
            let slewSpeedB = (this.regs[9] & 0x10) ? 1.0 : (volB_raw > this.smoothVolB ? 0.005 : 0.0005);
            let slewSpeedC = (this.regs[10] & 0x10) ? 1.0 : (volC_raw > this.smoothVolC ? 0.005 : 0.0005);
            
            this.smoothVolA += (volA_raw - this.smoothVolA) * slewSpeedA;
            this.smoothVolB += (volB_raw - this.smoothVolB) * slewSpeedB;
            this.smoothVolC += (volC_raw - this.smoothVolC) * slewSpeedC;

            // BUGFIX: Echte, logarithmische Lautstärke aus der YM_DAC Tabelle!
            let volA = YM_DAC[Math.round(this.smoothVolA)];
            let volB = YM_DAC[Math.round(this.smoothVolB)];
            let volC = YM_DAC[Math.round(this.smoothVolC)];

            // --- FILTERING ---
            // Tonal-Filter VOR dem Noise, damit Hi-Hats nicht weggedrückt werden!
            let sweepA = Math.pow(this.smoothVolA / 15.0, 1.5);
            let sweepB = Math.pow(this.smoothVolB / 15.0, 1.5);
            let sweepC = Math.pow(this.smoothVolC / 15.0, 1.5);

            sigA = this.applyMoogFilter(sigA, 0, 100 + sweepA * this.stage.A.cut, 0.3); 
            sigB_L = this.applyMoogFilter(sigB_L, 1, 100 + sweepB * this.stage.B.cut, 0.3); 
            sigB_R = this.applyMoogFilter(sigB_R, 2, 120 + sweepB * this.stage.B.cut, 0.3); 
            sigC = this.applyMoogFilter(sigC, 3, 100 + sweepC * this.stage.C.cut, 0.3); 

            // --- DUAL-BAND NOISE (Wird NACH dem Tone-Filter addiert!) ---
            let pN = this.regs[6] & 0x1F;
            let noiseVal = 0; let subNoiseVal = 0;
            if (nA || nB || nC) {
                let rawNoise = (Math.random() * 2.0 - 1.0);
                if (pN > 12) {
                    let cutoffN = 150 + (31 - pN) * 20; 
                    let fN = 2.0 * Math.sin(Math.PI * cutoffN / sampleRate);
                    this.nLow1 += fN * this.nBand1; let h1 = rawNoise - this.nLow1 - 0.2 * this.nBand1; this.nBand1 += fN * h1;
                    this.nLow2 += fN * this.nBand2; let h2 = this.nLow1 - this.nLow2 - 0.2 * this.nBand2; this.nBand2 += fN * h2;
                    subNoiseVal = this.nLow2 * 2.5; // Fetter Rausch-Bass
                } else {
                    let cutoffHp = 4000 + (12 - pN) * 500;
                    let fHp = 2.0 * Math.sin(Math.PI * cutoffHp / sampleRate);
                    this.nHpLow += fHp * this.nHpBand;
                    let hpHigh = rawNoise - this.nHpLow - 0.5 * this.nHpBand;
                    this.nHpBand += fHp * hpHigh;
                    noiseVal = hpHigh * 0.7; // Glasklare Hi-Hats
                }
            }

            if (nA) sigA += noiseVal + subNoiseVal; 
            if (nB) { sigB_L += noiseVal + subNoiseVal; sigB_R += noiseVal + subNoiseVal; }
            if (nC) sigC += noiseVal + subNoiseVal;

            // --- DIGIDRUMS (Foreground, Center) ---
            let digiSample = 0;
            if (this.currentDigidrum) {
                let posInt = Math.floor(this.digiPos);
                let y0 = this.currentDigidrum[posInt - 1] || 0;
                let y1 = this.currentDigidrum[posInt];
                let y2 = this.currentDigidrum[posInt + 1] || 0;
                let y3 = this.currentDigidrum[posInt + 2] || 0;
                
                // Drums peaken laut und klar im Foreground
                digiSample = cubicInterpolate(y0, y1, y2, y3, this.digiPos - posInt) * 0.6; 
                this.digiPos += 7812.5 / sampleRate; 
                if (this.digiPos >= this.currentDigidrum.length - 2) this.currentDigidrum = null; 
            }

            // =========================================================
            // GAIN STAGING & 3D STEREO MIXDOWN
            // =========================================================
            // Headroom: Oszillatoren auf ca. -15dBFS pegeln (0.18 multiplier)
            let lvlA = sigA * volA * 0.18;
            let lvlB_L = sigB_L * volB * 0.18;
            let lvlB_R = sigB_R * volB * 0.18;
            let lvlC = sigC * volC * 0.18;

            let epL_A = Math.cos(this.stage.A.pan * Math.PI * 0.5); let epR_A = Math.sin(this.stage.A.pan * Math.PI * 0.5);
            let epL_B = Math.cos(this.stage.B.pan * Math.PI * 0.5); let epR_B = Math.sin(this.stage.B.pan * Math.PI * 0.5);
            let epL_C = Math.cos(this.stage.C.pan * Math.PI * 0.5); let epR_C = Math.sin(this.stage.C.pan * Math.PI * 0.5);

            let mixL = (lvlA * epL_A) + (lvlB_L * epL_B) + (lvlC * epL_C) + digiSample;
            let mixR = (lvlA * epR_A) + (lvlB_R * epR_B) + (lvlC * epR_C) + digiSample;

            // --- Z-AXIS REVERB (Depth Staging) ---
            let revL = (lvlA * epL_A * this.stage.A.rev) + (lvlB_L * epL_B * this.stage.B.rev) + (lvlC * epL_C * this.stage.C.rev);
            let revR = (lvlA * epR_A * this.stage.A.rev) + (lvlB_R * epR_B * this.stage.B.rev) + (lvlC * epR_C * this.stage.C.rev);
            
            // Reverb Dämpfung auf Digidrums (Drums bleiben Up-Front!)
            if (this.currentDigidrum) { revL += digiSample * 0.1; revR += digiSample * 0.1; }

            let r1L = this.delayBufL[(this.delayIdx - tap1 + 262144) & this.delayMask];
            let r2R = this.delayBufR[(this.delayIdx - tap2 + 262144) & this.delayMask];
            let r3L = this.delayBufL[(this.delayIdx - tap3 + 262144) & this.delayMask];
            let r3R = this.delayBufR[(this.delayIdx - tap3 + 262144) & this.delayMask];

            this.delayLpL += 0.2 * ((r1L + r3R) * 0.5 - this.delayLpL); 
            this.delayLpR += 0.2 * ((r2R + r3L) * 0.5 - this.delayLpR); 

            let finalL = mixL + this.delayLpL; 
            let finalR = mixR + this.delayLpR;

            this.delayBufL[this.delayIdx] = revR * 0.4 + this.delayLpL * 0.4;
            this.delayBufR[this.delayIdx] = revL * 0.4 + this.delayLpR * 0.4;
            this.delayIdx = (this.delayIdx + 1) & this.delayMask;

            // --- MASTERING COMPRESSOR ---
            finalL = (Math.tanh(finalL * 4.0) / 1.1) * 0.9;
            finalR = (Math.tanh(finalR * 4.0) / 1.1) * 0.9;

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
registerProcessor('ym-bladerunner-processor', YMBladeRunnerProcessor);
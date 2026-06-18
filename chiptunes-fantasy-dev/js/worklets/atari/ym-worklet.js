class YMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clock = 2000000;
        this.regs = new Uint8Array(16); 
        this.phaseA = 0; this.phaseB = 0; this.phaseC = 0;
        this.noiseLfsr = 1; this.noisePhase = 0; this.noiseOutput = 1;
        
        // --- HARDWARE ENVELOPE GENERATOR (NEU) ---
        this.envPhase = 0.0;
        
        // --- DIGIDRUM SYSTEM ---
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
                this.envPhase = 0;
                this.isPlaying = true;
            } else if (event.data.type === 'STOP_TRACK') {
                this.isPlaying = false;
                // WICHTIG: Die Register bleiben erhalten, wir löschen nichts mehr!
            } else if (event.data.type === 'RESUME_TRACK') {
                this.isPlaying = true; // Wieder aufwecken!
            }
        };
    }

    getFrequency(coarseReg, fineReg) {
        let period = ((this.regs[coarseReg] & 0x0F) << 8) | this.regs[fineReg];
        if (period === 0) period = 1; 
        return this.clock / (16 * period);
    }

    getSquareWave(phase) { return phase < 0.5 ? 1.0 : -1.0; }

    process(inputs, outputs) {
        const channelLeft = outputs[0][0];  
        const channelRight = outputs[0][1] || outputs[0][0]; 
        let currentVisualValue = 0;

        for (let i = 0; i < channelLeft.length; i++) {
            
            // ECHTE PAUSE: Zeit friert komplett ein, Phase stoppt!
            if (!this.isPlaying) {
                channelLeft[i] = 0;
                if (channelRight) channelRight[i] = 0;
                continue; 
            }

            if (this.isPlaying && this.trackData) {
                this.sampleCounter--;
                if (this.sampleCounter <= 0) {
                    this.sampleCounter += sampleRate / 50.0; 
                    
                    let frame = this.trackData[this.currentFrame];
                    
                    // Register schreiben (mit Besonderheit für Register 13!)
                    for(let r=0; r<16; r++) {
                        if (r === 13) {
                            // Im YM Format bedeutet 0xFF bei Reg 13: "Nicht neu triggern!"
                            if (frame[13] !== 0xFF) {
                                this.regs[13] = frame[13];
                                this.envPhase = 0.0; // Hüllkurve neu starten (Trigger!)
                            }
                        } else {
                            this.regs[r] = frame[r];
                        }
                    }
                    
                    // --- DIGIDRUM TRIGGER (Geheime Bits in Reg 1 & 3) ---
                    let activeDigiTrigger = 0;
                    let fx1Type = (frame[1] & 0xC0) >> 6;
                    let fx1Voice = (frame[1] & 0x30) >> 4;
                    if (fx1Type === 1 && fx1Voice > 0) activeDigiTrigger = (frame[8 + fx1Voice - 1] & 0x1F) + 1;

                    let fx2Type = (frame[3] & 0xC0) >> 6;
                    let fx2Voice = (frame[3] & 0x30) >> 4;
                    if (fx2Type === 1 && fx2Voice > 0) activeDigiTrigger = (frame[8 + fx2Voice - 1] & 0x1F) + 1;
                    if (fx2Type === 0 && fx2Voice > 0) activeDigiTrigger = (frame[8 + fx2Voice - 1] & 0x1F) + 1;

                    if (activeDigiTrigger > 0 && activeDigiTrigger !== this.lastDigiTrigger) {
                        if (this.digidrums[activeDigiTrigger - 1]) {
                            this.currentDigidrum = this.digidrums[activeDigiTrigger - 1];
                            this.digiPos = 0;
                            this.port.postMessage({ type: 'DEBUG', msg: 'DRUM' });
                        }
                    }
                    this.lastDigiTrigger = activeDigiTrigger;
                    
                    this.currentFrame = (this.currentFrame + 1) % this.trackData.length;
                }
            }

            // Oszillatoren
            const freqA = this.getFrequency(1, 0);
            const freqB = this.getFrequency(3, 2);
            const freqC = this.getFrequency(5, 4);
            
            // Rauschen
            let noisePeriod = this.regs[6] & 0x1F;
            if (noisePeriod === 0) noisePeriod = 1;
            const noiseFreq = this.clock / (16 * noisePeriod);
            
            const mix = this.regs[7];
            const toneEnableA = (mix & 0x01) === 0;
            const toneEnableB = (mix & 0x02) === 0;
            const toneEnableC = (mix & 0x04) === 0;
            const noiseEnableA = (mix & 0x08) === 0;
            const noiseEnableB = (mix & 0x10) === 0;
            const noiseEnableC = (mix & 0x20) === 0;

            this.phaseA = (this.phaseA + freqA / sampleRate) % 1.0;
            this.phaseB = (this.phaseB + freqB / sampleRate) % 1.0;
            this.phaseC = (this.phaseC + freqC / sampleRate) % 1.0;
            
            this.noisePhase += noiseFreq / sampleRate;
            if (this.noisePhase >= 1.0) {
                this.noisePhase %= 1.0;
                this.noiseLfsr ^= (((this.noiseLfsr & 1) ^ ((this.noiseLfsr >> 3) & 1)) << 17);
                this.noiseLfsr >>= 1;
                this.noiseOutput = (this.noiseLfsr & 1) ? 1.0 : -1.0;
            }

            let outA = toneEnableA ? this.getSquareWave(this.phaseA) : 1.0;
            let outB = toneEnableB ? this.getSquareWave(this.phaseB) : 1.0;
            let outC = toneEnableC ? this.getSquareWave(this.phaseC) : 1.0;
            
            if (noiseEnableA) outA = (outA === 1.0 && this.noiseOutput === 1.0) ? 1.0 : -1.0;
            if (noiseEnableB) outB = (outB === 1.0 && this.noiseOutput === 1.0) ? 1.0 : -1.0;
            if (noiseEnableC) outC = (outC === 1.0 && this.noiseOutput === 1.0) ? 1.0 : -1.0;

            // ====================================================
            // DIE MAGIE: HARDWARE ENVELOPE GENERATOR (HEG)
            // ====================================================
            let envPeriod = (this.regs[12] << 8) | this.regs[11];
            if (envPeriod === 0) envPeriod = 1;
            // Der HEG läuft mit 1/256 der Chip-Clock!
            let envFreq = this.clock / (256 * envPeriod);
            this.envPhase += envFreq / sampleRate;

            let shape = this.regs[13] & 0x0F;
            let cycles = Math.floor(this.envPhase);
            let localPhase = this.envPhase - cycles;
            let envVol = 0;

            let attack = (shape & 4) !== 0;
            let cont = (shape & 8) !== 0;
            let alt = (shape & 2) !== 0;
            let hold = (shape & 1) !== 0;

            if (!cont) { hold = true; alt = false; }
            else { hold = (shape & 1) !== 0; alt = (shape & 2) !== 0; }

            if (cycles > 0 && hold) {
                if (alt) envVol = attack ? 0.0 : 1.0;
                else envVol = attack ? 1.0 : 0.0;
            } else {
                let flip = (cycles % 2 === 1) && alt;
                let up = attack ? !flip : flip;
                envVol = up ? localPhase : (1.0 - localPhase);
            }

            // --- LAUTSTÄRKEN ZUWEISEN ---
            // Wenn Bit 4 (0x10) gesetzt ist, nutzt der Kanal den HEG! Sonst fixen Wert.
            let volA = (this.regs[8] & 0x10) ? envVol : ((this.regs[8] & 0x0F) / 15.0);
            let volB = (this.regs[9] & 0x10) ? envVol : ((this.regs[9] & 0x0F) / 15.0);
            let volC = (this.regs[10] & 0x10) ? envVol : ((this.regs[10] & 0x0F) / 15.0);

            // --- DIGIDRUM PLAYBACK ---
            let digiSample = 0;
            if (this.currentDigidrum) {
                let posInt = Math.floor(this.digiPos);
                if (posInt < this.currentDigidrum.length) {
                    digiSample = this.currentDigidrum[posInt] * 2.0;
                    this.digiPos += 12500 / sampleRate; 
                } else {
                    this.currentDigidrum = null; 
                }
            }

            // Gesamtmix
            let mixedOutput = ((outA * volA) + (outB * volB) + (outC * volC) + digiSample) / 4.0;

            if (mixedOutput > 1.0) mixedOutput = 1.0;
            if (mixedOutput < -1.0) mixedOutput = -1.0;

            channelLeft[i] = mixedOutput;
            if (channelRight) channelRight[i] = mixedOutput;
            if (i === 0) currentVisualValue = mixedOutput;
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
registerProcessor('ym-processor', YMProcessor);
class YMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clock = 2000000;
        this.regs = new Uint8Array(14);
        this.phaseA = 0; this.phaseB = 0; this.phaseC = 0;
        this.noiseLfsr = 1; this.noisePhase = 0; this.noiseOutput = 1;
        
        // Der neue interne Hardware-Sequenzer
        this.trackData = null;
        this.currentFrame = 0;
        this.sampleCounter = 0;
        this.isPlaying = false;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'PLAY_TRACK') {
                this.trackData = event.data.track;
                this.currentFrame = 0;
                this.sampleCounter = 0;
                this.isPlaying = true;
            } else if (event.data.type === 'STOP_TRACK') {
                this.isPlaying = false;
                for(let r=0; r<14; r++) this.regs[r] = 0;
                this.regs[7] = 0xFF; // Mute
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
            
            // --- DIE MAGIE: 100% ZYKLUSGENAUES 50HZ TIMING ---
            if (this.isPlaying && this.trackData) {
                this.sampleCounter--;
                if (this.sampleCounter <= 0) {
                    this.sampleCounter += sampleRate / 50.0; // Exakt 1 Frame in Samples!
                    
                    let frame = this.trackData[this.currentFrame];
                    for(let r=0; r<14; r++) this.regs[r] = frame[r];
                    
                    this.currentFrame = (this.currentFrame + 1) % this.trackData.length;
                }
            }

            // Register auslesen (jetzt direkt in der Sample-Schleife für sofortige Reaktion!)
            const freqA = this.getFrequency(1, 0);
            const freqB = this.getFrequency(3, 2);
            const freqC = this.getFrequency(5, 4);
            
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

            let mixedOutput = ((outA * ((this.regs[8] & 0x0F) / 15.0)) + 
                               (outB * ((this.regs[9] & 0x0F) / 15.0)) + 
                               (outC * ((this.regs[10] & 0x0F) / 15.0))) / 3.0;

            channelLeft[i] = mixedOutput;
            if (channelRight) channelRight[i] = mixedOutput;
            if (i === 0) currentVisualValue = mixedOutput;
        }

        this.visCounter = (this.visCounter || 0) + 1;
        if (this.visCounter % 4 === 0) {
            let isAudible = Math.abs(currentVisualValue) > 0.001;
            if (isAudible || this.wasAudible) this.port.postMessage({ type: 'VISUAL_DATA', value: currentVisualValue });
            this.wasAudible = isAudible;
        }
        return true; 
    }
}
registerProcessor('ym-processor', YMProcessor);
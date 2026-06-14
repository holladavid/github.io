class SIDProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clock = 985248; 
        this.regs = new Uint8Array(29);
        this.voices = [{ phase: 0, env: 0 }, { phase: 0, env: 0 }, { phase: 0, env: 0 }];
        this.filterLow = 0; this.filterBand = 0;
        this.lfsr = 0x7FFFF8; 

        this.trackData = null;
        this.currentFrame = 0;
        this.sampleCounter = 0;
        this.isPlaying = false;

        this.port.onmessage = (e) => {
            if (e.data.type === 'PLAY_TRACK') {
                this.trackData = e.data.track;
                this.currentFrame = 0;
                this.sampleCounter = 0;
                this.isPlaying = true;
            } else if (e.data.type === 'STOP_TRACK') {
                this.isPlaying = false;
                this.regs[24] = 0; // Master vol 0
            }
        };
    }

    getNoise() {
        let bit = ((this.lfsr >> 22) ^ (this.lfsr >> 17)) & 1;
        this.lfsr = ((this.lfsr << 1) & 0x7FFFFF) | bit;
        return (this.lfsr & 0x400000) ? 1.0 : -1.0;
    }

    process(inputs, outputs) {
        const outL = outputs[0][0];
        const outR = outputs[0].length > 1 ? outputs[0][1] : null;
        let visualValue = 0;

        for (let i = 0; i < outL.length; i++) {
            
            // --- C64 HARDWARE SEQUENZER ---
            if (this.isPlaying && this.trackData) {
                this.sampleCounter--;
                if (this.sampleCounter <= 0) {
                    this.sampleCounter += sampleRate / 50.0;
                    
                    let frame = this.trackData[this.currentFrame];
                    for(let r=0; r<29; r++) this.regs[r] = frame.regs[r];
                    
                    this.currentFrame = (this.currentFrame + 1) % this.trackData.length;
                }
            }

            let cutoffReg = (this.regs[21] & 7) | (this.regs[22] << 3);
            let cutoffFreq = 30 + (cutoffReg * 8); 
            let resonance = (this.regs[23] >> 4) / 15.0;
            let q = 1.0 - resonance * 0.9; 
            let filterMode = this.regs[24];
            let masterVol = (filterMode & 15) / 15.0;

            let mix = 0;

            for (let v = 0; v < 3; v++) {
                let rBase = v * 7;
                let freqReg = this.regs[rBase] | (this.regs[rBase+1] << 8);
                let pwReg = this.regs[rBase+2] | ((this.regs[rBase+3] & 15) << 8);
                let ctrl = this.regs[rBase+4];
                
                let voiceState = this.voices[v];
                if (ctrl & 1) {
                    voiceState.env += 0.002; if(voiceState.env > 1.0) voiceState.env = 1.0;
                } else {
                    voiceState.env -= 0.0005; if(voiceState.env < 0.0) voiceState.env = 0.0;
                }

                voiceState.phase = (voiceState.phase + ((freqReg * this.clock) / 16777216.0) / sampleRate) % 1.0;

                let waveOut = 0;
                if (ctrl & 16) waveOut = Math.abs((voiceState.phase * 2.0) - 1.0) * 2.0 - 1.0;
                else if (ctrl & 32) waveOut = (voiceState.phase * 2.0) - 1.0;
                else if (ctrl & 64) waveOut = voiceState.phase > (pwReg / 4095.0) ? 1.0 : -1.0;
                else if (ctrl & 128) waveOut = this.getNoise();

                let voiceOut = waveOut * voiceState.env;

                if (this.regs[23] & (1 << v)) {
                    let f = 2.0 * Math.sin(Math.PI * cutoffFreq / sampleRate);
                    this.filterLow += f * this.filterBand;
                    let high = voiceOut - this.filterLow - q * this.filterBand;
                    this.filterBand += f * high;
                    
                    let filterOut = 0;
                    if (filterMode & 16) filterOut += this.filterLow; 
                    if (filterMode & 32) filterOut += this.filterBand; 
                    if (filterMode & 64) filterOut += high; 
                    voiceOut = filterOut;
                }
                mix += voiceOut;
            }

            let finalOut = (mix / 3.0) * masterVol;
            outL[i] = finalOut;
            if (outR) outR[i] = finalOut;
            if (i === 0) visualValue = finalOut;
        }

        this.visCounter = (this.visCounter || 0) + 1;
        if (this.visCounter % 4 === 0) {
            let isAudible = Math.abs(visualValue) > 0.001;
            if (isAudible || this.wasAudible) this.port.postMessage({ type: 'VISUAL_DATA', value: visualValue });
            this.wasAudible = isAudible;
        }
        return true;
    }
}
registerProcessor('sid-processor', SIDProcessor);
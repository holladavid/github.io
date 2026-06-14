// ==========================================
// MOS Technology SID 6581 (C64) AudioWorklet
// ==========================================

class SIDProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clock = 985248; // PAL C64 Clock in Hz
        
        // 29 klassische SID Register
        this.regs = new Uint8Array(29);
        
        // 3 Stimmen (Voices)
        this.voices = [this.createVoice(), this.createVoice(), this.createVoice()];
        
        // Filter-Status (State Variable Filter für den analogen Touch)
        this.filterLow = 0;
        this.filterBand = 0;

        // LFSR für Noise
        this.lfsr = 0x7FFFF8; 

        this.port.onmessage = (e) => {
            if (e.data.type === 'WRITE_REG') {
                this.regs[e.data.reg] = e.data.val;
            }
        };
    }

    createVoice() {
        return { phase: 0, env: 0, state: 'release' }; // Stark vereinfachte Hüllkurve
    }

    // Erzeugt C64-Noise (23-Bit LFSR)
    getNoise() {
        let bit = ((this.lfsr >> 22) ^ (this.lfsr >> 17)) & 1;
        this.lfsr = ((this.lfsr << 1) & 0x7FFFFF) | bit;
        return (this.lfsr & 0x400000) ? 1.0 : -1.0;
    }

    process(inputs, outputs) {
        const outL = outputs[0][0];
        const outR = outputs[0].length > 1 ? outputs[0][1] : null;
        let visualValue = 0;

        // Filter Parameter extrahieren (Register 21-24)
        let cutoffReg = (this.regs[21] & 7) | (this.regs[22] << 3);
        let cutoffFreq = 30 + (cutoffReg * 8); // Grobe Annäherung an Hz
        let resonance = (this.regs[23] >> 4) / 15.0;
        let q = 1.0 - resonance * 0.9; // Q-Faktor für den Filter
        
        let filterMode = this.regs[24];
        let masterVol = (filterMode & 15) / 15.0;

        for (let i = 0; i < outL.length; i++) {
            let mix = 0;

            for (let v = 0; v < 3; v++) {
                let rBase = v * 7;
                
                // Frequenz auslesen (16-Bit)
                let freqReg = this.regs[rBase] | (this.regs[rBase+1] << 8);
                let freq = (freqReg * this.clock) / 16777216.0;
                
                // Pulsweite (12-Bit)
                let pwReg = this.regs[rBase+2] | ((this.regs[rBase+3] & 15) << 8);
                let pw = pwReg / 4095.0;

                let ctrl = this.regs[rBase+4];
                let gate = ctrl & 1;
                
                // Extrem simpler Hüllkurven-Hack für die Demo (normalisiert auf 0.0 - 1.0)
                let voiceState = this.voices[v];
                if (gate) {
                    voiceState.env += 0.002; // Attack
                    if(voiceState.env > 1.0) voiceState.env = 1.0;
                } else {
                    voiceState.env -= 0.0005; // Release
                    if(voiceState.env < 0.0) voiceState.env = 0.0;
                }

                // Phase weiterdrehen
                voiceState.phase += freq / sampleRate;
                if (voiceState.phase > 1.0) voiceState.phase -= 1.0;

                let waveOut = 0;

                // Wellenformen generieren
                if (ctrl & 16) { // Triangle
                    waveOut = Math.abs((voiceState.phase * 2.0) - 1.0) * 2.0 - 1.0;
                }
                else if (ctrl & 32) { // Sawtooth
                    waveOut = (voiceState.phase * 2.0) - 1.0;
                }
                else if (ctrl & 64) { // Pulse (Das wichtigste für den fetten Sound!)
                    waveOut = voiceState.phase > pw ? 1.0 : -1.0;
                }
                else if (ctrl & 128) { // Noise
                    waveOut = this.getNoise();
                }

                // Voice Output = Welle * Hüllkurve
                let voiceOut = waveOut * voiceState.env;

                // Analoges Filter anwenden? (Register 23 regelt Routing)
                if (this.regs[23] & (1 << v)) {
                    // State Variable Filter Math
                    let f = 2.0 * Math.sin(Math.PI * cutoffFreq / sampleRate);
                    this.filterLow += f * this.filterBand;
                    let high = voiceOut - this.filterLow - q * this.filterBand;
                    this.filterBand += f * high;
                    
                    let filterOut = 0;
                    if (filterMode & 16) filterOut += this.filterLow; // Lowpass
                    if (filterMode & 32) filterOut += this.filterBand; // Bandpass
                    if (filterMode & 64) filterOut += high; // Highpass
                    
                    voiceOut = filterOut;
                }

                mix += voiceOut;
            }

            let finalOut = (mix / 3.0) * masterVol;
            
            outL[i] = finalOut;
            if (outR) outR[i] = finalOut;
            
            if (i === 0) visualValue = finalOut;
        }

        this.port.postMessage({ type: 'VISUAL_DATA', value: visualValue });
        return true;
    }
}

registerProcessor('sid-processor', SIDProcessor);
class PaulaStaticFilter {
    constructor() {
        this.lastOut = 0;
    }
    process(input, cutoff, sr) {
        let alpha = Math.exp(-2.0 * Math.PI * cutoff / sr);
        let out = (1.0 - alpha) * input + alpha * this.lastOut;
        this.lastOut = out;
        return out;
    }
}

class PaulaButterworthFilter {
    constructor() {
        this.low = 0; this.band = 0;
    }
    process(input, cutoff, sr) {
        let f = 2.0 * Math.sin(Math.PI * cutoff / sr);
        let damping = 1.515; // 1 / Q-factor (0.660)
        this.low += f * this.band;
        let high = input - this.low - damping * this.band;
        this.band += f * high;
        return this.low;
    }
}

class PaulaProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clock = 3546895; 
        this.channels = [
            { pos: 0, period: 0, vol: 0, data: null, loopStart: 0, loopLen: 0, pan: -1 },
            { pos: 0, period: 0, vol: 0, data: null, loopStart: 0, loopLen: 0, pan: 1 },
            { pos: 0, period: 0, vol: 0, data: null, loopStart: 0, loopLen: 0, pan: 1 },
            { pos: 0, period: 0, vol: 0, data: null, loopStart: 0, loopLen: 0, pan: -1 }
        ];
        
        this.samples = {}; // Der Amiga Arbeitsspeicher für Instrumente

        this.trackData = null;
        this.currentFrame = 0;
        this.sampleCounter = 0;
        this.isPlaying = false;

        // Amiga 500 Analogfilter-Instanzen (Stereo)
        this.staticL = new PaulaStaticFilter();
        this.staticR = new PaulaStaticFilter();
        this.butterL = new PaulaButterworthFilter();
        this.butterR = new PaulaButterworthFilter();
        
        this.ledFilterOn = true; // LED Filter standardmäßig aktiv auf Amiga 500

        this.port.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === 'UPLOAD_SAMPLE') {
                this.samples[msg.name] = msg.data;
            } else if (msg.type === 'PLAY_TRACK') {
                this.trackData = msg.track;
                this.currentFrame = 0;
                this.sampleCounter = 0;
                this.isPlaying = true;
            } else if (msg.type === 'STOP_TRACK') {
                this.isPlaying = false;
            } else if (msg.type === 'RESUME_TRACK') {
                this.isPlaying = true;
            } else if (msg.type === 'SEEK_TRACK') {
                if (this.trackData) this.currentFrame = msg.frame % this.trackData.length;
            } else if (msg.type === 'SET_LED_FILTER') {
                this.ledFilterOn = msg.enabled;
            }
        };
    }

    process(inputs, outputs) {
        const outL = outputs[0][0]; 
        const outR = outputs[0].length > 1 ? outputs[0][1] : null; 
        let oscValue = 0;

        for (let i = 0; i < outL.length; i++) {
            
            // ECHTE PAUSE
            if (!this.isPlaying) {
                outL[i] = 0;
                if (outR) outR[i] = 0;
                continue; 
            }
            
            // --- AMIGA HARDWARE SEQUENZER ---
            if (this.isPlaying && this.trackData) {
                this.sampleCounter--;
                if (this.sampleCounter <= 0) {
                    this.sampleCounter += sampleRate / 50.0;
                    
                    let frame = this.trackData[this.currentFrame];
                    if (frame && frame.cmds) {
                        for (let cmd of frame.cmds) {
                            const ch = this.channels[cmd.ch];
                            if (cmd.smp) {
                                ch.data = this.samples[cmd.smp];
                                ch.loopStart = 0;
                                ch.loopLen = (cmd.smp === 'bass') ? ch.data.length : 0;
                                ch.pos = 0; // Trigger!
                            }
                            if (cmd.per !== undefined) ch.period = cmd.per;
                            if (cmd.vol !== undefined) ch.vol = cmd.vol / 64.0;
                            if (cmd.smp) ch.pos = 0; 
                        }
                    }
                    this.currentFrame = (this.currentFrame + 1) % this.trackData.length;
                }
            }

            let mixedL = 0, mixedR = 0;
            for (let c = 0; c < 4; c++) {
                const ch = this.channels[c];
                if (ch.data && ch.period > 0 && ch.vol > 0) {
                    let posInt = Math.floor(ch.pos);
                    if (posInt < ch.data.length) {
                        // --- 8-BIT ZOH & 14-BIT PAULA DAC MULTIPLICATION ---
                        // Emuliert die raue Quantisierung des originalen Paula-Multiplexers
                        let rawByte = Math.round(ch.data[posInt] * 127.0); 
                        let volumeScale = Math.round(ch.vol * 64.0);
                        let sampleVal = (rawByte * volumeScale) / 8128.0; 

                        if (ch.pan < 0) mixedL += sampleVal; else mixedR += sampleVal;
                    }

                    // Amiga Paula Master Clock Resampling
                    ch.pos += (this.clock / ch.period) / sampleRate;

                    if (ch.pos >= ch.data.length) {
                        if (ch.loopLen > 2) ch.pos = ch.loopStart + (ch.pos - ch.data.length);
                        else ch.data = null; 
                    }
                }
            }
            
            // --- AMIGA 500 ANALOG RECONSTRUCTION FILTERS ---
            // 1. Statischer 1-Pole Lowpass-Filter bei 4.42 kHz (6 dB/oct)
            mixedL = this.staticFilterL.v0 = 0.9 * this.staticFilterL.v0 + 0.1 * mixedL; // Simulierter RC-Schnitt
            mixedR = this.staticFilterR.process ? this.staticFilterR.process(mixedR, 4421, sampleRate) : mixedR;
            // Let's implement both inline/classes as identical 1-pole for static:
            // (Wir verwenden dafür die schnellen SVF oder ein einfaches RC-IIR)
            
            // Für präzisen Analogsound berechnen wir den static filter über ein RC-Filter:
            if (!this.staticL) {
                this.staticL = 0; this.staticR = 0;
                this.ledL = new SVF(); this.ledR = new SVF(); // SVF-Instanzen für Butterworth
            }
            
            let alpha = Math.exp(-2.0 * Math.PI * 4421.0 / sampleRate);
            this.staticL = (1.0 - alpha) * mixedL + alpha * (this.staticL || 0);
            this.staticR = (1.0 - alpha) * mixedR + alpha * (this.staticR || 0);
            
            let finalL = this.staticL;
            let finalR = this.staticR;

            // 2. Dynamischer LED-Filter (12 dB/oct Butterworth bei 3.09 kHz, Q=0.66)
            if (this.ledFilterOn) {
                finalL = this.ledFilterL.process(this.staticL, 3091, 1.0 - 0.66, sampleRate);
                finalR = this.ledFilterR.process(this.staticFilterR.lastOut, 3091, 1.0 - 0.66, sampleRate); 
                // Zur Effizienz nutzen wir inline oder Biquad, falls nötig
            }
            
            outL[i] = mixedL;
            if (outR) outR[i] = mixedR; else outL[i] += mixedR; 
            if (i === 0) oscValue = (mixedL + mixedR) / 2.0;
        }

        this.visCounter = (this.visCounter || 0) + 1;
        if (this.visCounter % 4 === 0) {
            let isAudible = Math.abs(oscValue) > 0.001;
            if (isAudible || this.wasAudible) {
                let fakeRegs = new Uint8Array(16);
                for(let c=0; c<4; c++) {
                    fakeRegs[c*4] = (this.channels[c].period >> 8) & 0xFF; 
                    fakeRegs[c*4+1] = this.channels[c].period & 0xFF;      
                    fakeRegs[c*4+2] = Math.floor(this.channels[c].vol * 64); 
                    fakeRegs[c*4+3] = this.channels[c].data ? 1 : 0;       
                }
                this.port.postMessage({ type: 'VISUAL_DATA', value: oscValue, frame: this.currentFrame, regs: fakeRegs });
            }
            this.wasAudible = isAudible;
        }
        return true;
    }
}

// Inline Butterworth 2-Pole & Static Lowpass für Amiga 500 Spezifikationen
class AmigaFilter {
    constructor() {
        this.v0 = 0; this.v1 = 0;
    }
    process(input, cutoff, sr) {
        let f = 2.0 * Math.sin(Math.PI * cutoff / sr);
        let damping = 1.515; // 1 / Q (0.660)
        this.low = (this.low || 0) + f * (this.band || 0);
        let high = input - this.low - damping * (this.band || 0);
        this.band = (this.band || 0) + f * high;
        return this.low;
    }
}

class StaticRCFilter {
    constructor() {
        this.lastOut = 0;
    }
    process(input, cutoff, sr) {
        let alpha = Math.exp(-2.0 * Math.PI * cutoff / sr);
        let out = (1.0 - alpha) * input + alpha * this.lastOut;
        this.lastOut = out;
        return out;
    }
}

// Instanziierung im Processor-Kontext sicherstellen
PaulaProcessor.prototype.initHardwareFilters = function() {
    this.staticL = new StaticRCFilter();
    this.staticR = new StaticRCFilter();
    this.ledL = new AmigaFilter();
    this.ledR = new AmigaFilter();
};

// Modifizierter Constructor um Filter-Setup zu bootstrappen
const originalConstructor = PaulaProcessor;
PaulaProcessor = class extends originalConstructor {
    constructor() {
        super();
        this.initHardwareFilters();
    }
    process(inputs, outputs) {
        const outL = outputs[0][0];
        const outR = outputs[0].length > 1 ? outputs[0][1] : null;
        let oscValue = 0;

        for (let i = 0; i < outL.length; i++) {
            if (!this.isPlaying) {
                outL[i] = 0; if (outR) outR[i] = 0;
                continue;
            }

            if (this.isPlaying && this.trackData) {
                this.sampleCounter--;
                if (this.sampleCounter <= 0) {
                    this.sampleCounter += sampleRate / 50.0;
                    let frame = this.trackData[this.currentFrame];
                    if (frame && frame.cmds) {
                        for (let cmd of frame.cmds) {
                            const ch = this.channels[cmd.ch];
                            if (cmd.smp) {
                                ch.data = this.samples[cmd.smp];
                                ch.loopStart = 0;
                                ch.loopLen = (cmd.smp === 'bass') ? ch.data.length : 0;
                                ch.pos = 0;
                            }
                            if (cmd.per !== undefined) ch.period = cmd.per;
                            if (cmd.vol !== undefined) ch.vol = cmd.vol / 64.0;
                        }
                    }
                    this.currentFrame = (this.currentFrame + 1) % this.trackData.length;
                }
            }

            let mixedL = 0, mixedR = 0;
            for (let c = 0; c < 4; c++) {
                const ch = this.channels[c];
                if (ch.data && ch.period > 0 && ch.vol > 0) {
                    let posInt = Math.floor(ch.pos);
                    if (posInt < ch.data.length) {
                        // --- 8-BIT SAMPLE & 6-BIT VOLUME BIT-EXACT PAULA MULTIPLICATION ---
                        let sample8 = Math.round(ch.data[posInt] * 127.0); 
                        let vol6 = Math.round(ch.vol * 64.0);
                        let sampleVal = (sample8 * vol6) / 8128.0; 

                        if (ch.pan < 0) mixedL += sampleVal; else mixedR += sampleVal;
                    }
                    ch.pos += (this.clock / ch.period) / sampleRate;
                    if (ch.pos >= ch.data.length) {
                        if (ch.loopLen > 2) ch.pos = ch.loopStart + (ch.pos - ch.data.length);
                        else ch.data = null;
                    }
                }
            }

            // --- AMIGA 500 HARDWARE RECONSTRUCTION FILTERING ---
            // Stage 1: Statischer RC-Filter bei 4421 Hz (6 dB/oct)
            let filteredL = this.staticL.process(mixedL, 4421, sampleRate);
            let filteredR = this.staticR.process(mixedR, 4421, sampleRate);

            // Stage 2: Dynamischer LED-Butterworth-Filter bei 3091 Hz (12 dB/oct, Q=0.66)
            if (this.ledFilterOn) {
                filteredL = this.ledL.process(filteredL, 3091, sampleRate);
                filteredR = this.ledR.process(filteredR, 3091, sampleRate);
            }

            outL[i] = filteredL / 2.0;
            if (outR) outR[i] = filteredR / 2.0; else outL[i] += filteredR / 2.0;
            if (i === 0) oscValue = (filteredL + filteredR) / 2.0;
        }

        this.visCounter = (this.visCounter || 0) + 1;
        if (this.visCounter % 4 === 0) {
            let isAudible = Math.abs(oscValue) > 0.001;
            if (isAudible || this.wasAudible) {
                let fakeRegs = new Uint8Array(16);
                for(let c=0; c<4; c++) {
                    fakeRegs[c*4] = (this.channels[c].period >> 8) & 0xFF;
                    fakeRegs[c*4+1] = this.channels[c].period & 0xFF;
                    fakeRegs[c*4+2] = Math.floor(this.channels[c].vol * 64);
                    fakeRegs[c*4+3] = this.channels[c].data ? 1 : 0;
                }
                this.port.postMessage({ type: 'VISUAL_DATA', value: oscValue, frame: this.currentFrame, regs: fakeRegs });
            }
            this.wasAudible = isAudible;
        }
        return true;
    }
};

registerProcessor('paula-processor', PaulaProcessor);
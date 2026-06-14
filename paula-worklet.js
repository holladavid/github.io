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
                for (let c of this.channels) { c.data = null; c.vol = 0; }
            }
        };
    }

    process(inputs, outputs) {
        const outL = outputs[0][0]; 
        const outR = outputs[0].length > 1 ? outputs[0][1] : null; 
        let oscValue = 0;

        for (let i = 0; i < outL.length; i++) {
            
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
                        let sampleVal = ch.data[posInt] * ch.vol;
                        if (ch.pan < 0) mixedL += sampleVal; else mixedR += sampleVal;
                    }

                    ch.pos += (this.clock / ch.period) / sampleRate;

                    if (ch.pos >= ch.data.length) {
                        if (ch.loopLen > 2) ch.pos = ch.loopStart + (ch.pos - ch.data.length);
                        else ch.data = null; 
                    }
                }
            }
            
            outL[i] = mixedL / 2.0;
            if (outR) outR[i] = mixedR / 2.0; else outL[i] += mixedR / 2.0; 
            if (i === 0) oscValue = (mixedL + mixedR) / 2.0;
        }

        this.visCounter = (this.visCounter || 0) + 1;
        if (this.visCounter % 4 === 0) {
            let isAudible = Math.abs(oscValue) > 0.001;
            if (isAudible || this.wasAudible) this.port.postMessage({ type: 'VISUAL_DATA', value: oscValue });
            this.wasAudible = isAudible;
        }
        return true;
    }
}
registerProcessor('paula-processor', PaulaProcessor);
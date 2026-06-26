// === js/worklets/amiga/paula-worklet.js ===
// ==========================================
// MOS TECHNOLOGY PAULA 8364 CHIP EMULATION
// With Sub-Sample Accurate Phase & Sample Pointer Alignment
// ==========================================

class StaticRCFilter {
    constructor(sampleRate) {
        this.lastOut = 0;
        this.alpha = Math.exp(-2.0 * Math.PI * 4421.0 / sampleRate);
    }
    process(input) {
        let out = (1.0 - this.alpha) * input + this.alpha * this.lastOut;
        this.lastOut = out;
        return out;
    }
}

class AmigaLEDFilter {
    constructor(sampleRate) {
        const fc = 3090; 
        const q = 0.707; 
        const w0 = 2 * Math.PI * fc / sampleRate;
        const alpha = Math.sin(w0) / (2 * q);
        const cosw0 = Math.cos(w0);
        
        const a0 = 1 + alpha;
        this.b0 = ((1 - cosw0) / 2) / a0;
        this.b1 = (1 - cosw0) / a0;
        this.b2 = ((1 - cosw0) / 2) / a0;
        this.a1 = (-2 * cosw0) / a0;
        this.a2 = (1 - alpha) / a0;
        
        this.x1 = 0; this.x2 = 0;
        this.y1 = 0; this.y2 = 0;
    }
    process(x) {
        let y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1; this.x1 = x;
        this.y2 = this.y1; this.y1 = y;
        return y;
    }
}

class PaulaChannel {
    constructor() {
        this.vol = 0;       
        this.per = 428;     
        this.data = null;   
        this.pointer = 0;   
        this.length = 0;    
        this.repPointer = 0;
        this.repLength = 0; 
        this.phase = 0;     
        this.activeSample = 1; 
    }

    trigger(data, loopStart, loopLen) {
        this.data = data;
        this.pointer = 0;
        this.length = data.length;
        this.phase = 0;
        
        if (loopLen > 2) {
            this.repPointer = loopStart;
            this.repLength = loopLen;
        } else {
            this.repPointer = -1; 
            this.repLength = 0;
        }
    }

    step(clockTicksPerSample) {
        if (!this.data || this.vol === 0 || this.per === 0 || this.length <= 0) return 0;

        this.phase += clockTicksPerSample / this.per;
        while (this.phase >= 1.0) {
            this.phase -= 1.0;
            this.pointer++;
            this.length--;
            
            if (this.length <= 0) {
                if (this.repPointer === -1) {
                    this.data = null; 
                    return 0;
                } else {
                    this.pointer = this.repPointer;
                    this.length = this.repLength;
                }
            }
        }

        if (!this.data) return 0;
        
        let rawByte = this.data[Math.floor(this.pointer)];
        if (isNaN(rawByte)) rawByte = 0; 
        
        let sample8 = Math.round(rawByte * 127.0); 
        let vol6 = Math.round(this.vol);
        return (sample8 * vol6) / 8128.0; 
    }
}

class PaulaProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clock = 3546895; 
        
        this.channels = [];
        for (let i = 0; i < 64; i++) {
            this.channels.push(new PaulaChannel());
        }
        
        this.samples = {}; 
        this.isPlaying = false;

        this.visualView = new Float32Array(40);

        // Sequenzer Engine Variablen
        this.isSequenced = false;
        this.seqType = 'MOD';
        this.songLength = 0;
        this.orderTable = null;
        this.patterns = null;
        this.bpm = 125;
        this.speed = 6;
        this.numChannels = 4; 
        
        this.currentOrder = 0;
        this.currentRow = 0;
        this.currentTick = 0;
        this.samplesUntilNextTick = 0;

        // Legacy Fallback Variablen
        this.trackData = null;
        this.currentFrame = 0;
        this.sampleCounter = 0;

        this.staticL = new StaticRCFilter(sampleRate);
        this.staticR = new StaticRCFilter(sampleRate);
        this.ledL = new AmigaLEDFilter(sampleRate);
        this.ledR = new AmigaLEDFilter(sampleRate);
        this.ledFilterOn = true; 

        this.port.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === 'UPLOAD_SAMPLE') {
                if (msg.data && msg.data.data instanceof Float32Array) {
                    this.samples[msg.name] = msg.data;
                } else {
                    this.samples[msg.name] = {
                        data: msg.data,
                        loopStart: msg.loopStart || 0,
                        loopLen: msg.loopLen !== undefined ? msg.loopLen : (msg.name === 'bass' || msg.name === 'chord' ? msg.data.length : 0)
                    };
                }
            } else if (msg.type === 'PLAY_TRACK') {
                for (let i = 0; i < 64; i++) {
                    this.channels[i].data = null;
                    this.channels[i].vol = 0;
                    this.channels[i].per = 428;
                    this.channels[i].pointer = 0;
                    this.channels[i].length = 0;
                    this.channels[i].repPointer = 0;
                    this.channels[i].repLength = 0;
                    this.channels[i].phase = 0;
                    this.channels[i].activeSample = 1;
                }

                if (msg.track && msg.track.isSequenced) {
                    this.isSequenced = true;
                    this.seqType = msg.track.type;
                    this.songLength = msg.track.songLength;
                    this.orderTable = msg.track.orderTable;
                    this.patterns = msg.track.patterns;
                    this.bpm = msg.track.bpm || 125;
                    this.speed = msg.track.speed || 6;
                    this.numChannels = msg.track.numChannels || 4;

                    this.currentOrder = 0;
                    this.currentRow = 0;
                    this.currentTick = 0;
                    this.samplesUntilNextTick = 0;
                    this.isPlaying = true;
                } else {
                    this.isSequenced = false;
                    this.trackData = msg.track;
                    this.numChannels = 4; 
                    this.currentFrame = 0;
                    this.sampleCounter = 0;
                    this.isPlaying = true;
                }
            } else if (msg.type === 'STOP_TRACK') {
                this.isPlaying = false;
                for (let i = 0; i < 64; i++) {
                    this.channels[i].data = null;
                    this.channels[i].vol = 0;
                }
            } else if (msg.type === 'RESUME_TRACK') {
                this.isPlaying = true;
            } else if (msg.type === 'SEEK_TRACK') {
                if (this.isSequenced) {
                    const ticksPerOrder = 64 * this.speed;
                    const targetOrder = Math.floor(msg.frame / ticksPerOrder);
                    const remainingTicks = msg.frame % ticksPerOrder;
                    
                    this.currentOrder = targetOrder % this.songLength;
                    this.currentRow = Math.floor(remainingTicks / this.speed) % 64;
                    this.currentTick = remainingTicks % this.speed;
                } else {
                    if (this.trackData) this.currentFrame = msg.frame % this.trackData.length;
                }
            } else if (msg.type === 'SET_LED_FILTER') {
                this.ledFilterOn = msg.enabled;
            }
        };
    }

    processTrackerTick() {
        if (this.currentOrder >= this.songLength) {
            this.currentOrder = 0; 
        }

        const patternIdx = this.orderTable[this.currentOrder];
        const patternObj = this.patterns[patternIdx];
        if (!patternObj) return;

        const pattern = patternObj.data;
        const numRows = patternObj.numRows;

        const rowOffset = this.currentRow * this.numChannels * 6;

        // === DETERMINISTISCHE SUB-SAMPLE PHASEN-KOMPENSATION ===
        const overshoot = -this.samplesUntilNextTick; // Fraktionaler Überhang in Samples
        const clockTicksPerSample = this.clock / sampleRate;

        for (let ch = 0; ch < this.numChannels; ch++) {
            const cellOffset = rowOffset + (ch * 6);
            const period = pattern[cellOffset] | (pattern[cellOffset + 1] << 8);
            const sample = pattern[cellOffset + 2];
            const volume = pattern[cellOffset + 3];
            const effect = pattern[cellOffset + 4];
            const param = pattern[cellOffset + 5];

            const channel = this.channels[ch];

            if (sample > 0) {
                channel.activeSample = sample;
            }
            const activeSample = channel.activeSample || 1;
            const smpName = this.seqType === 'MOD' ? `mod_sample_${activeSample}` : `xm_sample_${activeSample}`;
            const currentSmpObj = this.samples[smpName];

            if (this.currentTick === 0) {
                // --- TICK 0: Trigger Phase ---
                if (sample > 0 && currentSmpObj && currentSmpObj.data) {
                    channel.trigger(currentSmpObj.data, currentSmpObj.loopStart, currentSmpObj.loopLen);
                    channel.vol = currentSmpObj.baseVolume; 
                    
                    // Sample-Zeiger sub-sample-genau ausrichten!
                    channel.pointer = overshoot * (clockTicksPerSample / channel.per);
                }

                if (period > 0) {
                    if (this.seqType === 'MOD') {
                        channel.per = period;
                    } else { 
                        if (period === 0xFFFF || period === 97) {
                            channel.vol = 0; 
                        } else {
                            const relNote = currentSmpObj ? (currentSmpObj.relNote || 0) : 0;
                            const actualNote = period + relNote;
                            const clampedNote = Math.min(96, Math.max(1, actualNote));
                            channel.per = Math.round(428.0 * Math.pow(2.0, (37 - clampedNote) / 12.0));
                        }
                    }
                    if (period !== 0xFFFF && period !== 97) {
                        // Phasen-Akkumulator exakt auf die Rhythmus-Achse synchronisieren!
                        channel.phase = overshoot * (clockTicksPerSample / channel.per);
                    }
                }

                if (volume !== 0xFF) {
                    channel.vol = volume; 
                }

                switch (effect) {
                    case 0x0C: 
                        channel.vol = param > 64 ? 64 : param;
                        break;
                    case 0x0F: 
                        if (param > 0) {
                            if (param < 32) {
                                this.speed = param;
                            } else {
                                this.bpm = param;
                            }
                        }
                        break;
                    case 0x0B: 
                        this.currentOrder = param;
                        this.currentRow = 0;
                        this.currentTick = -1; 
                        break;
                    case 0x0D: 
                        const targetRow = ((param >> 4) * 10) + (param & 0x0F);
                        this.currentRow = targetRow < numRows ? targetRow : 0;
                        this.currentOrder++;
                        this.currentTick = -1;
                        break;
                }
            } else {
                // --- TICK > 0 ---
                switch (effect) {
                    case 0x00: 
                        if (param > 0 && channel.per > 0) {
                            const arpOffsets = [0, (param >> 4) & 0x0F, param & 0x0F];
                            const currentOffset = arpOffsets[this.currentTick % 3];
                            channel.per = period * Math.pow(0.9438, currentOffset);
                        }
                        break;
                    case 0x01: 
                        if (channel.per > 0) {
                            channel.per = Math.max(113, channel.per - param); 
                        }
                        break;
                    case 0x02: 
                        if (channel.per > 0) {
                            channel.per = Math.min(856, channel.per + param); 
                        }
                        break;
                    case 0x0A: 
                        if (param > 0) {
                            const slideUp = (param >> 4) & 0x0F;
                            const slideDown = param & 0x0F;
                            if (slideUp > 0) {
                                channel.vol = Math.min(64, channel.vol + slideUp);
                            } else if (slideDown > 0) {
                                channel.vol = Math.max(0, channel.vol - slideDown);
                            }
                        }
                        break;
                }
            }
        }

        this.currentTick++;
        if (this.currentTick >= this.speed) {
            this.currentTick = 0;
            this.currentRow++;
            if (this.currentRow >= numRows) {
                this.currentRow = 0;
                this.currentOrder++;
            }
        }
    }

    process(inputs, outputs) {
        const outL = outputs[0][0]; 
        const outR = outputs[0].length > 1 ? outputs[0][1] : null; 
        let oscValue = 0;

        let clockTicksPerSample = this.clock / sampleRate;

        for (let i = 0; i < outL.length; i++) {
            if (!this.isPlaying) {
                outL[i] = 0; if (outR) outR[i] = 0;
                continue; 
            }
            
            if (this.isPlaying) {
                if (this.isSequenced) {
                    this.samplesUntilNextTick--;
                    if (this.samplesUntilNextTick <= 0) {
                        const samplesPerTick = (2.5 / this.bpm) * sampleRate;
                        this.samplesUntilNextTick += samplesPerTick;
                        
                        this.processTrackerTick();
                    }
                } else {
                    this.sampleCounter--;
                    if (this.sampleCounter <= 0) {
                        this.sampleCounter += sampleRate / 50.0;
                        
                        let frame = this.trackData[this.currentFrame];
                        if (frame && frame.cmds) {
                            for (let cmd of frame.cmds) {
                                const ch = this.channels[cmd.ch];
                                if (cmd.smp) {
                                    let sampleObj = this.samples[cmd.smp];
                                    if (sampleObj && sampleObj.data) {
                                        ch.trigger(sampleObj.data, sampleObj.loopStart, sampleObj.loopLen);
                                    }
                                }
                                if (cmd.per !== undefined) ch.per = cmd.per;
                                if (cmd.vol !== undefined) ch.vol = cmd.vol; 
                            }
                        }
                        this.currentFrame = (this.currentFrame + 1) % this.trackData.length;
                    }
                }
            }

            let mixedL = 0, mixedR = 0;
            
            for (let c = 0; c < this.numChannels; c++) {
                let sampleVal = this.channels[c].step(clockTicksPerSample);
                if (sampleVal !== 0) {
                    if ((c % 4) === 0 || (c % 4) === 3) mixedL += sampleVal; 
                    else mixedR += sampleVal; 
                }
            }
            
            let filteredL = this.staticL.process(mixedL);
            let filteredR = this.staticR.process(mixedR);

            if (this.ledFilterOn) {
                filteredL = this.ledL.process(filteredL);
                filteredR = this.ledR.process(filteredR);
            }

            outL[i] = filteredL / 2.0;
            if (outR) outR[i] = filteredR / 2.0; else outL[i] += filteredR / 2.0; 
            if (i === 0) oscValue = (filteredL + filteredR) / 2.0;
        }

        this.visCounter = (this.visCounter || 0) + 1;
        if (this.visCounter % 4 === 0) {
            let isAudible = Math.abs(oscValue) > 0.001;
            if (isAudible || this.wasAudible) {
                const view = this.visualView;
                view[0] = 1; 
                view[1] = this.isPlaying ? 1 : 0;
                view[2] = this.isSequenced 
                    ? (this.currentOrder * 64 * this.speed + this.currentRow * this.speed + this.currentTick)
                    : this.currentFrame;
                view[3] = oscValue;

                for(let c = 0; c < 4; c++) {
                    let offset = c * 7;
                    let ch = this.channels[c];
                    
                    let simulatedAddress = ch.data ? 0x00020000 + c * 0x4000 + Math.floor(ch.pointer) : 0;
                    view[4 + offset] = (simulatedAddress >> 8) & 0xFF; 
                    view[4 + offset + 1] = simulatedAddress & 0xFF;       
                    
                    let len = ch.data ? Math.floor(ch.data.length / 2) : 0;
                    view[4 + offset + 2] = (len >> 8) & 0xFF;
                    view[4 + offset + 3] = len & 0xFF;
                    
                    view[4 + offset + 4] = (ch.per >> 8) & 0xFF;
                    view[4 + offset + 5] = ch.per & 0xFF;
                    
                    view[4 + offset + 6] = Math.round(ch.vol) & 0xFF;
                }

                this.port.postMessage(view);
            }
            this.wasAudible = isAudible;
        }
        return true;
    }
}

registerProcessor('paula-processor', PaulaProcessor);
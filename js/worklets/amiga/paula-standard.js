// === js/worklets/amiga/paula-standard.js ===
// ==========================================
// MOS TECHNOLOGY PAULA 8364 CHIP EMULATION
// Digital Clean Edition: Full Stereo Panning & XM Logic (No Analog Dirt)
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
        
        this.targetPeriod = 0;
        this.basePeriod = 428;
        this.currentNote = 0;
        this.targetNote = 0;
        
        this.portamentoSpeed = 0;
        this.portamentoUpSpeed = 0;
        this.portamentoDownSpeed = 0;
        this.volSlideSpeed = 0;
        this.sampleOffset = 0;
        
        this.pan = 0.5;
        this.vibratoSpeed = 0;
        this.vibratoDepth = 0;
        this.vibratoPhase = 0;
        this.hasVibrato = false;
        
        this.lastPlayedSample = 0;
        
        this.patternLoopRow = 0;
        this.patternLoopCount = 0;
    }

    trigger(data, loopStart, loopLen) {
        this.data = data;
        this.pointer = 0;
        this.phase = 0;
        
        if (loopLen > 2) {
            if (loopStart >= data.length) loopStart = 0;
            if (loopStart + loopLen > data.length) loopLen = data.length - loopStart;
            this.length = loopStart + loopLen;
            this.repPointer = loopStart;
            this.repLength = loopLen;
        } else {
            this.length = data.length;
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
        
        let idx = Math.floor(this.pointer);
        if (idx >= this.data.length) idx = this.data.length - 1;
        if (idx < 0) idx = 0;

        let rawByte = this.data[idx];
        let vol6 = Math.round(this.vol); 
        
        return (rawByte * vol6) / 8128.0; 
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

        this.isSequenced = false;
        this.seqType = 'MOD';
        this.linearFreq = false;
        
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
        
        this.patternDelay = 0;
        this.breakPending = false;
        this.breakOrder = 0;
        this.breakRow = 0;

        this.staticL = new StaticRCFilter(sampleRate);
        this.staticR = new StaticRCFilter(sampleRate);
        this.ledL = new AmigaLEDFilter(sampleRate);
        this.ledR = new AmigaLEDFilter(sampleRate);
        this.trackLedFilterOn = true;
        this.ledFilterOn = true; 
        this.filterModeState = 0; 

        this.port.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === 'UPLOAD_SAMPLE') {
                if (msg.data && msg.data.data instanceof Int8Array) {
                    this.samples[msg.name] = msg.data;
                }
            } else if (msg.type === 'PLAY_TRACK') {
                const isXM = msg.track && msg.track.type === 'XM';
                this.linearFreq = msg.track ? (msg.track.linearFreq || false) : false;
                
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
                    
                    this.channels[i].targetPeriod = 0;
                    this.channels[i].basePeriod = 428;
                    this.channels[i].currentNote = 0;
                    this.channels[i].targetNote = 0;
                    
                    this.channels[i].portamentoSpeed = 0;
                    this.channels[i].portamentoUpSpeed = 0;
                    this.channels[i].portamentoDownSpeed = 0;
                    this.channels[i].volSlideSpeed = 0;
                    this.channels[i].sampleOffset = 0;
                    
                    this.channels[i].patternLoopRow = 0;
                    this.channels[i].patternLoopCount = 0;
                    
                    this.channels[i].lastPlayedSample = 0;
                    
                    if (isXM) {
                        this.channels[i].pan = 0.5;
                    } else {
                        const panMod = i % 4;
                        this.channels[i].pan = (panMod === 0 || panMod === 3) ? 0.0 : 1.0;
                    }
                    this.channels[i].vibratoSpeed = 0;
                    this.channels[i].vibratoDepth = 0;
                    this.channels[i].vibratoPhase = 0;
                    this.channels[i].hasVibrato = false;
                }

                this.filterModeState = 0;
                this.trackLedFilterOn = true; 
                this.ledFilterOn = true;      

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
                    this.patternDelay = 0;
                    this.breakPending = false;
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
                    this.patternDelay = 0;
                    this.breakPending = false;
                } else {
                    if (this.trackData) this.currentFrame = msg.frame % this.trackData.length;
                }
            } else if (msg.type === 'CYCLE_FILTER') {
                this.filterModeState = (this.filterModeState + 1) % 3;
                if (this.filterModeState === 0) this.ledFilterOn = this.trackLedFilterOn; 
                else if (this.filterModeState === 1) this.ledFilterOn = true; 
                else if (this.filterModeState === 2) this.ledFilterOn = false; 
            }
        };
    }

    processTrackerTick(overshoot) {
        if (this.currentOrder >= this.songLength) {
            this.currentOrder = 0; 
        }

        const patternIdx = this.orderTable[this.currentOrder];
        const patternObj = this.patterns[patternIdx];
        if (!patternObj) return;

        const pattern = patternObj.data;
        const numRows = patternObj.numRows;
        const rowOffset = this.currentRow * this.numChannels * 6;
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

            const isSampleChange = (sample > 0 && sample !== channel.lastPlayedSample);
            const isPortamento = (effect === 0x03 || effect === 0x05) && (channel.data !== null) && 
                                 (this.seqType === 'XM' ? true : !isSampleChange);

            if (this.currentTick === 0) {
                const hasNote = (period > 0 && period !== 97);
                if (period === 97) channel.vol = 0;

                if (hasNote) {
                    let calculatedPeriod = period;
                    let actualNote = 0;

                    if (this.seqType === 'XM') {
                        const relNote = currentSmpObj ? (currentSmpObj.relNote || 0) : 0;
                        const finetune = currentSmpObj ? (currentSmpObj.finetune || 0) : 0;
                        actualNote = period + relNote + (finetune / 128.0);
                        const clampedNote = Math.min(96, Math.max(1, actualNote));
                        calculatedPeriod = Math.round(428.0 * Math.pow(2.0, (49 - clampedNote) / 12.0));
                    }

                    if (isPortamento) {
                        channel.targetPeriod = calculatedPeriod;
                        channel.targetNote = actualNote;
                    } else {
                        channel.per = calculatedPeriod;
                        channel.basePeriod = calculatedPeriod;
                        channel.targetPeriod = 0;
                        channel.currentNote = actualNote;
                        channel.targetNote = 0;
                    }
                }

                if (hasNote && currentSmpObj && currentSmpObj.data) {
                    if (!isPortamento) {
                        channel.trigger(currentSmpObj.data, currentSmpObj.loopStart, currentSmpObj.loopLen);
                        channel.phase = overshoot * (clockTicksPerSample / channel.per);
                        
                        if (effect === 0x09) {
                            if (param > 0) channel.sampleOffset = param * 256;
                            channel.pointer = channel.sampleOffset;
                        }
                    }
                    if (sample > 0) {
                        channel.lastPlayedSample = sample;
                    }
                }

                // --- Panning & Volume Übernahmen ---
                if (sample > 0 && currentSmpObj) {
                    channel.vol = currentSmpObj.baseVolume; 
                    if (currentSmpObj.pan !== undefined) {
                        channel.pan = currentSmpObj.pan / 255.0;
                    }
                }

                if (volume !== 0xFF) {
                    if (volume >= 0xC0 && volume <= 0xCF) {
                        channel.pan = (volume - 0xC0) / 15.0;
                    } else if (volume <= 64) {
                        channel.vol = volume; 
                    }
                }

                if (effect !== 0x04 && effect !== 0x06) {
                    channel.hasVibrato = false;
                }

                switch (effect) {
                    case 0x01: if (param > 0) channel.portamentoUpSpeed = param; break;
                    case 0x02: if (param > 0) channel.portamentoDownSpeed = param; break;
                    case 0x03: if (param > 0) channel.portamentoSpeed = param; break;
                    case 0x04: 
                        if (param > 0) {
                            if ((param >> 4) > 0) channel.vibratoSpeed = (param >> 4) & 0x0F;
                            if ((param & 0x0F) > 0) channel.vibratoDepth = param & 0x0F;
                        }
                        channel.hasVibrato = true;
                        break;
                    case 0x05:
                    case 0x0A: 
                        if (param > 0) channel.volSlideSpeed = param; 
                        break;
                    case 0x06: 
                        if (param > 0) channel.volSlideSpeed = param;
                        channel.hasVibrato = true;
                        break;
                    case 0x08: 
                        channel.pan = param / 255.0;
                        break;
                    case 0x0C: 
                        channel.vol = param > 64 ? 64 : param;
                        break;
                    case 0x0F: 
                        if (param > 0) {
                            if (param < 32) this.speed = param;
                            else this.bpm = param;
                        }
                        break;
                    case 0x0B: 
                        this.breakOrder = param;
                        this.breakRow = 0;
                        this.breakPending = true;
                        break;
                    case 0x0D: 
                        this.breakOrder = this.currentOrder + 1;
                        this.breakRow = ((param >> 4) * 10) + (param & 0x0F);
                        this.breakPending = true;
                        break;
                        
                    case 0x0E:
                        const subEffect = param >> 4;
                        const subParam = param & 0x0F;
                        if (subEffect === 0x00) { 
                            this.trackLedFilterOn = (subParam === 0);
                            if (this.filterModeState === 0) this.ledFilterOn = (subParam === 0); 
                        } else if (subEffect === 0x08) { 
                            channel.pan = subParam / 15.0;
                        } else if (subEffect === 0x0A) { 
                            channel.vol = Math.min(64, channel.vol + subParam);
                        } else if (subEffect === 0x0B) { 
                            channel.vol = Math.max(0, channel.vol - subParam);
                        } else if (subEffect === 0x01) { 
                            if (this.seqType === 'XM' && this.linearFreq) {
                                channel.currentNote = Math.min(96, channel.currentNote + (subParam / 16.0));
                                channel.per = Math.round(428.0 * Math.pow(2.0, (49 - channel.currentNote) / 12.0));
                            } else if (channel.per > 0) {
                                channel.per = Math.max(113, channel.per - subParam);
                            }
                        } else if (subEffect === 0x02) { 
                            if (this.seqType === 'XM' && this.linearFreq) {
                                channel.currentNote = Math.max(1, channel.currentNote - (subParam / 16.0));
                                channel.per = Math.round(428.0 * Math.pow(2.0, (49 - channel.currentNote) / 12.0));
                            } else if (channel.per > 0) {
                                channel.per = Math.min(856, channel.per + subParam);
                            }
                        }
                        else if (subEffect === 0x0E) {
                            this.patternDelay = subParam;
                        }
                        else if (subEffect === 0x06) {
                            if (subParam === 0) {
                                channel.patternLoopRow = this.currentRow;
                            } else {
                                if (channel.patternLoopCount === 0) {
                                    channel.patternLoopCount = subParam;
                                } else {
                                    channel.patternLoopCount--;
                                }
                                if (channel.patternLoopCount > 0) {
                                    this.breakOrder = this.currentOrder;
                                    this.breakRow = channel.patternLoopRow;
                                    this.breakPending = true;
                                }
                            }
                        }
                        break;
                }
            } else {
                // --- TICK > 0: EFFECTS ---
                switch (effect) {
                    case 0x00: 
                        if (param > 0 && channel.per > 0) {
                            const arpOffsets = [0, (param >> 4) & 0x0F, param & 0x0F];
                            const currentOffset = arpOffsets[this.currentTick % 3];
                            if (this.seqType === 'XM' && this.linearFreq) {
                                const arpNote = channel.currentNote + currentOffset; 
                                const clampedNote = Math.min(96, Math.max(1, arpNote));
                                channel.per = Math.round(428.0 * Math.pow(2.0, (49 - clampedNote) / 12.0));
                            } else {
                                const base = (period > 0 && period !== 97) ? period : channel.basePeriod;
                                channel.per = base * Math.pow(0.9438, currentOffset);
                            }
                        }
                        break;
                    case 0x01: 
                        if (this.seqType === 'XM' && this.linearFreq) {
                            channel.currentNote = Math.min(96, channel.currentNote + (channel.portamentoUpSpeed / 16.0));
                            channel.per = Math.round(428.0 * Math.pow(2.0, (49 - channel.currentNote) / 12.0));
                        } else if (channel.per > 0) {
                            channel.per = Math.max(113, channel.per - channel.portamentoUpSpeed); 
                        }
                        break;
                    case 0x02: 
                        if (this.seqType === 'XM' && this.linearFreq) {
                            channel.currentNote = Math.max(1, channel.currentNote - (channel.portamentoDownSpeed / 16.0));
                            channel.per = Math.round(428.0 * Math.pow(2.0, (49 - channel.currentNote) / 12.0));
                        } else if (channel.per > 0) {
                            channel.per = Math.min(856, channel.per + channel.portamentoDownSpeed); 
                        }
                        break;
                    case 0x03:
                    case 0x05:
                        if (this.seqType === 'XM' && this.linearFreq) {
                            if (channel.targetNote > 0 && channel.currentNote !== channel.targetNote) {
                                const slideAmount = channel.portamentoSpeed / 16.0;
                                if (channel.currentNote < channel.targetNote) {
                                    channel.currentNote = Math.min(channel.targetNote, channel.currentNote + slideAmount);
                                } else {
                                    channel.currentNote = Math.max(channel.targetNote, channel.currentNote - slideAmount);
                                }
                                const clampedNote = Math.min(96, Math.max(1, channel.currentNote));
                                channel.per = Math.round(428.0 * Math.pow(2.0, (49 - clampedNote) / 12.0));
                            }
                        } else {
                            if (channel.targetPeriod > 0 && channel.per !== channel.targetPeriod) {
                                if (channel.per < channel.targetPeriod) {
                                    channel.per = Math.min(channel.targetPeriod, channel.per + channel.portamentoSpeed);
                                } else {
                                    channel.per = Math.max(channel.targetPeriod, channel.per - channel.portamentoSpeed);
                                }
                            }
                        }
                        if (effect === 0x05) {
                            const slideUp = (channel.volSlideSpeed >> 4) & 0x0F;
                            const slideDown = channel.volSlideSpeed & 0x0F;
                            if (slideUp > 0) channel.vol = Math.min(64, channel.vol + slideUp);
                            else if (slideDown > 0) channel.vol = Math.max(0, channel.vol - slideDown);
                        }
                        break;
                    case 0x04: 
                    case 0x06: 
                        if (channel.hasVibrato) {
                            channel.vibratoPhase = (channel.vibratoPhase + channel.vibratoSpeed) & 63;
                            const vibSine = Math.sin(channel.vibratoPhase * (Math.PI / 32));
                            
                            if (this.seqType === 'XM' && this.linearFreq) {
                                const vibOffsetNotes = vibSine * (channel.vibratoDepth / 16.0);
                                const clampedNote = Math.min(96, Math.max(1, channel.currentNote + vibOffsetNotes));
                                channel.per = Math.round(428.0 * Math.pow(2.0, (49 - clampedNote) / 12.0));
                            } else {
                                const vibOffset = vibSine * channel.vibratoDepth * 2.5; 
                                channel.per = Math.max(113, Math.min(856, Math.round(channel.basePeriod + vibOffset)));
                            }
                        }
                        if (effect === 0x06) {
                            const slideUp = (channel.volSlideSpeed >> 4) & 0x0F;
                            const slideDown = channel.volSlideSpeed & 0x0F;
                            if (slideUp > 0) channel.vol = Math.min(64, channel.vol + slideUp);
                            else if (slideDown > 0) channel.vol = Math.max(0, channel.vol - slideDown);
                        }
                        break;
                    case 0x0A: 
                        const slideUp = (channel.volSlideSpeed >> 4) & 0x0F;
                        const slideDown = channel.volSlideSpeed & 0x0F;
                        if (slideUp > 0) channel.vol = Math.min(64, channel.vol + slideUp);
                        else if (slideDown > 0) channel.vol = Math.max(0, channel.vol - slideDown);
                        break;
                }
            }
        }

        this.currentTick++;
        if (this.currentTick >= this.speed * (this.patternDelay + 1)) {
            this.currentTick = 0;
            this.patternDelay = 0;
            
            if (this.breakPending) {
                this.currentOrder = this.breakOrder;
                this.currentRow = this.breakRow;
                this.breakPending = false;
            } else {
                this.currentRow++;
                if (this.currentRow >= numRows) {
                    this.currentRow = 0;
                    this.currentOrder++;
                }
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
                        const overshoot = -this.samplesUntilNextTick; 
                        
                        this.processTrackerTick(overshoot);
                        
                        const samplesPerTick = (2.5 / this.bpm) * sampleRate;
                        this.samplesUntilNextTick += samplesPerTick;
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
                    // Panning (Constant-Power)
                    const pan = this.channels[c].pan;
                    mixedL += sampleVal * Math.cos(pan * Math.PI * 0.5); 
                    mixedR += sampleVal * Math.sin(pan * Math.PI * 0.5); 
                }
            }
            
            // --- NO CROSSTALK, NO TANH SATURATION, NO HSYNC NOISE ---
            // Reines, sauberes Digital-Routing in die Filter
            
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

                view[33] = this.ledFilterOn ? 1.0 : 0.0;

                for (let c = 0; c < 4; c++) {
                    let ch = this.channels[c];
                    view[34 + c] = ch.data ? (ch.vol / 64.0) : 0.0;
                }

                view[38] = this.filterModeState;

                this.port.postMessage(view);
            }
            this.wasAudible = isAudible;
        }
        return true;
    }
}

// Hier wichtig: Der eindeutige Namespace für den sauberen Core
registerProcessor('paula-standard-processor', PaulaProcessor);
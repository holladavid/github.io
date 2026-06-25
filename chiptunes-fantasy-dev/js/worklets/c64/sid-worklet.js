// =========================================================
// MOS TECHNOLOGY SID 6581 AUDIO WORKLET PROCESSOR
// =========================================================

import { CPU6502 } from '../lib/cpu6502.js';
import { SIDChip } from '../lib/sid-chip.js';

class SIDProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clock = 985248; 
        this.sid = new SIDChip();
        this.cpu = new CPU6502(this.sid);

        this.trackData = null;
        this.isPlaying = false;
        this.sampleCounter = 0;
        this.currentFrame = 0;
        
        this.initAddress = 0;
        this.playAddress = 0;

        this.port.onmessage = (e) => {
            const msg = e.data;
            if (msg.isSidFile) {
                this.cpu.reset(msg.loadAddress, msg.c64Code);
                this.initAddress = msg.initAddress;
                this.playAddress = msg.playAddress;
                
                this.cpu.a = (msg.startSong > 0 ? msg.startSong - 1 : 0) & 0xFF;
                this.cpu.x = this.cpu.a; 
                this.cpu.y = 0;
                this.cpu.p &= ~1;
                
                // Nutze neuen Wrapper für sicheres RTI/RTS handling!
                this.cpu.play(this.initAddress);
                
                if (this.playAddress === 0) {
                    this.playAddress = this.cpu.read(0x0314) | (this.cpu.read(0x0315) << 8); 
                    if (this.playAddress === 0 || this.playAddress === 0xFFFF) {
                        this.playAddress = this.cpu.read(0xFFFE) | (this.cpu.read(0xFFFF) << 8);
                    }
                    if (this.playAddress === 0 || this.playAddress === 0xFFFF) {
                        this.playAddress = this.initAddress + 3; 
                    }
                }

                this.currentFrame = 0;
                this.sampleCounter = 0;
                this.isPlaying = true;
                
                console.log(`[6502 CPU] Loaded at $${msg.loadAddress.toString(16)}. Play: $${this.playAddress.toString(16)}`);
            } else if (msg.type === 'STOP_TRACK') {
                this.isPlaying = false;
            } else if (msg.type === 'RESUME_TRACK') {
                this.isPlaying = true;
            } else if (msg.type === 'SEEK_TRACK') {
                this.currentFrame = msg.frame % 5000;
            }
        };
    }

    process(inputs, outputs) {
        const outL = outputs[0][0];
        const outR = outputs[0].length > 1 ? outputs[0][1] : null;
        let visualValue = 0;

        for (let i = 0; i < outL.length; i++) {
            if (!this.isPlaying) {
                outL[i] = 0; if (outR) outR[i] = 0;
                continue; 
            }
            
            if (this.isPlaying && this.playAddress > 0) {
                this.sampleCounter--;
                if (this.sampleCounter <= 0) {
                    this.sampleCounter += sampleRate / 50.0;
                    
                    this.cpu.write(0xD019, 0x81);
                    this.cpu.play(this.playAddress); // Nutze Wrapper für IRQ Player
                    this.currentFrame = (this.currentFrame + 1) % 5000;
                }
            }

            let mix = 0;
            for (let v = 0; v < 3; v++) {
                let voiceOut = this.sid.synthesizeVoice(v, this.clock, sampleRate);
                
                if (this.sid.regs[23] & (1 << v)) {
                    let f = 2.0 * Math.sin(Math.PI * this.sid.cutoff / sampleRate);
                    this.sid.filterLow += f * this.sid.filterBand;
                    let high = voiceOut - this.sid.filterLow - (1.0 - this.sid.resonance * 0.9) * this.sid.filterBand;
                    this.sid.filterBand += f * high;
                    
                    let filterOut = 0;
                    if (this.sid.filterMode & 16) filterOut += this.sid.filterLow; 
                    if (this.sid.filterMode & 32) filterOut += this.sid.filterBand; 
                    if (this.sid.filterMode & 64) filterOut += high; 
                    voiceOut = filterOut;
                }
                mix += voiceOut;
            }

            let finalOut = (mix / 3.0) * this.sid.masterVol;
            outL[i] = finalOut;
            if (outR) outR[i] = finalOut;
            if (i === 0) visualValue = finalOut;
        }

        this.visCounter = (this.visCounter || 0) + 1;
        if (this.visCounter % 4 === 0) {
            let isAudible = Math.abs(visualValue) > 0.001;
            if (isAudible || this.wasAudible) {
                this.port.postMessage({ type: 'VISUAL_DATA', value: visualValue, frame: this.currentFrame, regs: this.sid.regs });
            }
            this.wasAudible = isAudible;
        }
        return true;
    }
}

registerProcessor('sid-processor', SIDProcessor);
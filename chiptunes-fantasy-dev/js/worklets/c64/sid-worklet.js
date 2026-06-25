// =========================================================
// MOS TECHNOLOGY SID 6581 AUDIO WORKLET PROCESSOR
// Dynamic CIA Speed & IRQ Controller
// =========================================================

import { CPU6502 } from '../lib/cpu6502.js';
import { SIDChip } from '../lib/sid-chip.js';

class SIDProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.clock = 985248; // PAL C64 Clock
        this.sid = new SIDChip();
        this.cpu = new CPU6502(this.sid);

        this.trackData = null;
        this.isPlaying = false;
        this.sampleCounter = 0;
        this.currentFrame = 0;
        
        this.initAddress = 0;
        this.playAddress = 0;
        this.useCiaTimer = false; 
        this.isIrqRoutine = false; 

        this.port.onmessage = (e) => {
            const msg = e.data;
            if (msg.isSidFile) {
                this.cpu.reset(msg.loadAddress, msg.c64Code);
                this.initAddress = msg.initAddress;
                this.playAddress = msg.playAddress;
                
                let songIndex = (msg.startSong > 0 ? msg.startSong - 1 : 0) & 0xFF;
                this.cpu.a = songIndex;
                this.cpu.x = songIndex; 
                this.cpu.y = 0;
                this.cpu.p &= ~1;
                
                // PSID Speed-Flag für diesen Subsong auslesen (0 = VBLANK 50Hz, 1 = CIA)
                this.useCiaTimer = ((msg.speed >> songIndex) & 1) !== 0;

                this.cpu.jsr(this.initAddress); // 6502 Initialisierung aufrufen
                
                this.isIrqRoutine = false;

                if (this.playAddress === 0) {
                    this.playAddress = this.cpu.read(0x0314) | (this.cpu.read(0x0315) << 8); 
                    if (this.playAddress === 0 || this.playAddress === 0xFFFF) {
                        this.playAddress = this.cpu.read(0xFFFE) | (this.cpu.read(0xFFFF) << 8);
                        if (this.playAddress !== 0 && this.playAddress !== 0xFFFF) {
                            this.isIrqRoutine = true; 
                        }
                    }
                    if (this.playAddress === 0 || this.playAddress === 0xFFFF) {
                        this.playAddress = this.initAddress + 3; 
                    }
                }

                this.currentFrame = 0;
                this.sampleCounter = 0;
                
                this.maxFrames = msg.length || 7500;
                this.isPlaying = true;
                
                console.log(`[6502 CPU] Program loaded. Max frames: ${this.maxFrames} | CIA Mode: ${this.useCiaTimer}`);
            } else if (msg.type === 'STOP_TRACK') {
                this.isPlaying = false;
            } else if (msg.type === 'RESUME_TRACK') {
                this.isPlaying = true;
            } else if (msg.type === 'SEEK_TRACK') {
                this.currentFrame = msg.frame % this.maxFrames;
            } else if (msg.type === 'CHANGE_SUBSONG') {
                this.sid = new SIDChip();
                this.cpu.sid = this.sid;
                
                let songIndex = (msg.frame > 0 ? msg.frame - 1 : 0) & 0xFF;
                this.cpu.a = songIndex;
                this.cpu.x = songIndex;
                this.cpu.y = 0;
                this.cpu.p &= ~1;
                
                this.cpu.jsr(this.initAddress);
                
                this.currentFrame = 0;
                this.sampleCounter = 0;
                this.maxFrames = msg.length || 7500;
                console.log(`[6502 CPU] Switched Subsong to ${songIndex + 1}. Max frames: ${this.maxFrames}`);
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
            
            // --- C64 CPU & SID RUNTIME ---
            if (this.isPlaying && this.playAddress > 0) {
                this.sampleCounter--;
                if (this.sampleCounter <= 0) {
                    
                    let hz = 50.0; // Standard PAL VBLANK
                    
                    // Korrekte Taktung: CIA-Timer NUR nutzen, wenn das PSID-Speed-Flag es explizit vorschreibt!
                    if (this.useCiaTimer && this.cpu.ciaTimerA > 0) {
                        hz = this.clock / this.cpu.ciaTimerA;
                    }

                    // Begrenzung um extreme Frequenzen abzufedern (min 10Hz, max 1000Hz)
                    if (hz < 10) hz = 10;
                    if (hz > 1000) hz = 1000;
                    
                    this.sampleCounter += sampleRate / hz;
                    
                    this.cpu.write(0xD019, 0x81);
                    
                    if (this.isIrqRoutine) {
                        this.cpu.irq(this.playAddress);
                    } else {
                        this.cpu.jsr(this.playAddress);
                    }
                    
                    this.currentFrame = (this.currentFrame + 1) % this.maxFrames;
                }
            }

            let mix = 0;
            for (let v = 0; v < 3; v++) {
                let voiceOut = this.sid.synthesizeVoice(v, this.clock, sampleRate);
                
                if (this.sid.regs[23] & (1 << v)) {
                    let f = 2.0 * Math.sin(Math.PI * this.sid.cutoff / sampleRate);
                    if (f > 1.0) f = 1.0; 
                    
                    this.sid.filterLow += f * this.sid.filterBand;
                    let high = voiceOut - this.sid.filterLow - (1.0 - this.sid.resonance * 0.9) * this.sid.filterBand;
                    this.sid.filterBand += f * high;
                    
                    if (this.sid.filterBand > 3.0) this.sid.filterBand = 3.0;
                    if (this.sid.filterBand < -3.0) this.sid.filterBand = -3.0;
                    if (this.sid.filterLow > 3.0) this.sid.filterLow = 3.0;
                    if (this.sid.filterLow < -3.0) this.sid.filterLow = -3.0;
                    
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

        // --- AKKURATE REGISTER-RÜCKMELDUNG INS HUD ---
        this.visCounter = (this.visCounter || 0) + 1;
        if (this.visCounter % 4 === 0) {
            let isAudible = Math.abs(visualValue) > 0.001;
            if (isAudible || this.wasAudible) {
                // Sende die Register an das HUD
                this.port.postMessage({ type: 'VISUAL_DATA', value: visualValue, frame: this.currentFrame, regs: this.sid.regs });
            }
            this.wasAudible = isAudible;
        }
        return true;
    }
}

registerProcessor('sid-processor', SIDProcessor);
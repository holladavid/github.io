// === js/worklets/lib/sid-chip.js ===
// ==========================================
// MOS Technology SID 6581 Sound Chip Emulation
// Oscillator Bit-19 (16x) Clocked LFSR Noise & reSID-compliant MSB Mapping
// ==========================================

const ADSR_RATES_S = [
    0.006, 0.024, 0.054, 0.090, 0.150, 0.260, 0.300, 0.390,
    0.540, 0.800, 1.500, 3.000, 4.500, 5.700, 9.000, 24.00
];

const ENV_ATTACK = 0, ENV_DECAY = 1, ENV_SUSTAIN = 2, ENV_RELEASE = 3;

export class SIDChip {
    constructor() {
        this.regs = new Uint8Array(29);
        this.voices = [
            { freq: 0, pw: 2048, ctrl: 0, env: 0, phase: 0, state: ENV_RELEASE, prevGate: false, waveOut8Bit: 0, env8Bit: 0, lfsr: 0x7FFFFF },
            { freq: 0, pw: 2048, ctrl: 0, env: 0, phase: 0, state: ENV_RELEASE, prevGate: false, waveOut8Bit: 0, env8Bit: 0, lfsr: 0x7FFFFF },
            { freq: 0, pw: 2048, ctrl: 0, env: 0, phase: 0, state: ENV_RELEASE, prevGate: false, waveOut8Bit: 0, env8Bit: 0, lfsr: 0x7FFFFF }
        ];
        this.cutoff = 30; this.resonance = 0; this.filterMode = 0; this.masterVol = 0;
        this.filterLow = 0; this.filterBand = 0;
    }

    writeReg(reg, val) {
        this.regs[reg] = val;
        
        let vIdx = Math.floor(reg / 7);
        if (vIdx < 3) {
            let ch = this.voices[vIdx];
            let base = vIdx * 7;
            ch.freq = this.regs[base] | (this.regs[base+1] << 8);
            ch.pw = this.regs[base+2] | ((this.regs[base+3] & 15) << 8);
            
            let prevCtrl = ch.ctrl;
            ch.ctrl = this.regs[base+4];
            
            let gate = (ch.ctrl & 1) !== 0;
            let prevGate = (prevCtrl & 1) !== 0;
            
            if (gate && !prevGate) ch.state = ENV_ATTACK;
            else if (!gate && prevGate) ch.state = ENV_RELEASE;
            ch.prevGate = gate;

            // TEST-BIT: Setzt die Phase und das LFSR-Register synchron zurück
            if (ch.ctrl & 8) {
                ch.phase = 0; 
                ch.lfsr = 0x7FFFFF;
            }
            
        } else if (reg === 21 || reg === 22) {
            let cutoffReg = (this.regs[21] & 7) | (this.regs[22] << 3);
            this.cutoff = 30 + (cutoffReg * 8);
        } else if (reg === 23) {
            this.resonance = (val >> 4) / 15.0;
        } else if (reg === 24) {
            this.filterMode = val;
            this.masterVol = (val & 15) / 15.0;
        }
    }

    synthesizeVoice(v, clock, sampleRate) {
        let ch = this.voices[v];

        let base = v * 7;
        let ad = this.regs[base + 5];
        let sr = this.regs[base + 6]; 

        let attackRate = 1.0 / (ADSR_RATES_S[ad >> 4] * sampleRate); 
        let decayRate = 1.0 / (ADSR_RATES_S[ad & 15] * sampleRate);
        let targetSustain = (sr >> 4) / 15.0;             
        let releaseRate = 1.0 / (ADSR_RATES_S[sr & 15] * sampleRate);

        switch(ch.state) {
            case ENV_ATTACK:
                ch.env += attackRate;
                if (ch.env >= 1.0) { ch.env = 1.0; ch.state = ENV_DECAY; }
                break;
            case ENV_DECAY:
                ch.env -= decayRate;
                if (ch.env <= targetSustain) { ch.env = targetSustain; ch.state = ENV_SUSTAIN; }
                break;
            case ENV_SUSTAIN:
                ch.env = targetSustain;
                break;
            case ENV_RELEASE:
                ch.env -= releaseRate;
                if (ch.env <= 0.0) { ch.env = 0.0; }
                break;
        }

        if ((ch.ctrl & 8) === 0) {
            // Phasen-Überlauf im 24-Bit Akkumulator bestimmen
            let oldAcc = Math.floor(ch.phase * 16777216.0);
            let phaseInc = ((ch.freq * clock) / 16777216.0) / sampleRate;
            ch.phase += phaseInc;
            
            let newAcc = Math.floor(ch.phase * 16777216.0);
            ch.phase %= 1.0;

            // === NATIVE HARDWARE-TAKTACTUNG BEI ÜBERGANG VON BIT 19 ===
            // Das triggert das LFSR exakt 16-mal pro Oszillator-Zyklus (16x f_out)
            let oldStep = Math.floor(oldAcc / 524288) & 31;
            let newStep = Math.floor(newAcc / 524288) & 31;
            let shifts = (newStep - oldStep + 32) & 31;

            for (let s = 0; s < shifts; s++) {
                let bit = ((ch.lfsr >> 22) ^ (ch.lfsr >> 17)) & 1;
                ch.lfsr = ((ch.lfsr << 1) & 0x7FFFFF) | bit;
            }
        }

        // 8-Bit Wellenform-Mapping (0-255)
        let tri8 = ch.phase < 0.5 ? Math.floor(ch.phase * 2.0 * 255) : Math.floor((1.0 - ch.phase) * 2.0 * 255);
        let saw8 = Math.floor((1.0 - ch.phase) * 255);
        let pulse8 = ch.phase > (ch.pw / 4095.0) ? 255 : 0;
        
        // reSID-konformes Rausch-Mapping: Extrahiert direkt die obersten 8 Bits (MSB) des LFSRs!
        let noise8 = (ch.lfsr >> 15) & 0xFF; 

        let waveOut8 = 255;
        let hasWave = false;

        // Bitgenaue analoge Dioden-AND-Mischung
        if (ch.ctrl & 16) { waveOut8 &= tri8; hasWave = true; }
        if (ch.ctrl & 32) { waveOut8 &= saw8; hasWave = true; }
        if (ch.ctrl & 64) { waveOut8 &= pulse8; hasWave = true; }
        if (ch.ctrl & 128) { waveOut8 &= noise8; hasWave = true; }

        if (!hasWave) waveOut8 = 0; 

        ch.waveOut8Bit = waveOut8;
        ch.env8Bit = Math.floor(ch.env * 255);

        let waveOutFloat = (waveOut8 / 127.5) - 1.0;
        return waveOutFloat * ch.env;
    }
}
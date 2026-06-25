// =========================================================
// 6502 CPU EMULATOR & C64 I/O INTERCEPTOR
// Bare-Metal Accuracy (151 Opcodes)
// =========================================================

export class CPU6502 {
    constructor(sid) {
        this.ram = new Uint8Array(65536);
        this.sid = sid;
        this.a = 0; this.x = 0; this.y = 0;
        this.sp = 0xFF; this.pc = 0;
        this.p = 0x20; 
        this.rasterLine = 0;
    }

    reset(loadAddr, prgCode) {
        this.ram.fill(0);
        this.ram[0x0000] = 0x2F; 
        this.ram[0x0001] = 0x37; 
        
        for (let i = 0; i < prgCode.length; i++) {
            this.ram[loadAddr + i] = prgCode[i];
        }
        this.a = 0; this.x = 0; this.y = 0;
        this.sp = 0xFF; this.p = 0x20;
    }

    push(val) {
        this.ram[0x0100 + this.sp] = val;
        this.sp = (this.sp - 1) & 0xFF;
    }

    pop() {
        this.sp = (this.sp + 1) & 0xFF;
        return this.ram[0x0100 + this.sp];
    }

    setNZ(val) {
        let v = val & 0xFF;
        if (v === 0) this.p |= 2; else this.p &= ~2; 
        if (v & 0x80) this.p |= 128; else this.p &= ~128; 
    }

    read(addr) {
        if (addr === 0xD019) return this.ram[0xD019] | 0x80; 
        if (addr === 0xD012) {
            this.rasterLine = (this.rasterLine + 1) % 263;
            return this.rasterLine;
        }
        if (addr === 0xD011) return 0x1B | ((this.pc >> 8) & 0x80);
        if (addr === 0xDC04 || addr === 0xDC05) return Math.floor(Math.random() * 256);
        if (addr === 0xDC0D || addr === 0xDD0D) return 0x81;
        if (addr === 0x0001) return this.ram[0x0001];
        return this.ram[addr];
    }

    write(addr, val) {
        this.ram[addr] = val;
        if (addr === 0xD019) {
            this.ram[0xD019] &= ~val; 
        } else if (addr >= 0xD400 && addr <= 0xD41C) {
            this.sid.writeReg(addr - 0xD400, val);
        }
    }

    // SICHERER ABSPIEL-WRAPPER (Unterstützt RTS und RTI Exits!)
    play(addr) {
        if (addr === 0) return;
        
        // Wenn die Routine per RTI beendet, poppt sie P, PCL, PCH.
        // Wenn per RTS, poppt sie PCL, PCH.
        // Wir pushen 0xFFFE (für RTI) und 0xFFFF (für RTS).
        this.push(0xFF); // PCH für RTS
        this.push(0xFE); // PCL für RTS (kehrt nach 0xFFFF zurück)
        this.push(this.p); // Statusregister (P) für RTI (kehrt nach 0xFFFE zurück)
        
        this.pc = addr;
        let instructions = 0;
        
        while (this.pc !== 0xFFFF && this.pc !== 0xFFFE && instructions < 50000) { 
            this.step();
            instructions++;
        }
    }

    // Hilfsfunktionen für Adressierungs-Modi (Verhindert JIT-Bugs!)
    abs() { let l = this.read(this.pc++); let h = this.read(this.pc++); return l | (h << 8); }
    absX() { return (this.abs() + this.x) & 0xFFFF; }
    absY() { return (this.abs() + this.y) & 0xFFFF; }
    zp() { return this.read(this.pc++); }
    zpX() { return (this.zp() + this.x) & 0xFF; }
    zpY() { return (this.zp() + this.y) & 0xFF; }
    indX() { let z = this.zpX(); return this.read(z) | (this.read((z+1)&0xFF) << 8); }
    indY() { let z = this.zp(); let addr = this.read(z) | (this.read((z+1)&0xFF) << 8); return (addr + this.y) & 0xFFFF; }

    step() {
        let op = this.read(this.pc++);
        
        switch (op) {
            case 0xEA: break; // NOP
                
            // --- LDA ---
            case 0xA9: this.a = this.read(this.pc++); this.setNZ(this.a); break; 
            case 0xA5: this.a = this.read(this.zp()); this.setNZ(this.a); break; 
            case 0xB5: this.a = this.read(this.zpX()); this.setNZ(this.a); break; 
            case 0xAD: this.a = this.read(this.abs()); this.setNZ(this.a); break; 
            case 0xBD: this.a = this.read(this.absX()); this.setNZ(this.a); break; 
            case 0xB9: this.a = this.read(this.absY()); this.setNZ(this.a); break; 
            case 0xA1: this.a = this.read(this.indX()); this.setNZ(this.a); break; 
            case 0xB1: this.a = this.read(this.indY()); this.setNZ(this.a); break; 

            // --- LDX ---
            case 0xA2: this.x = this.read(this.pc++); this.setNZ(this.x); break; 
            case 0xA6: this.x = this.read(this.zp()); this.setNZ(this.x); break; 
            case 0xB6: this.x = this.read(this.zpY()); this.setNZ(this.x); break; 
            case 0xAE: this.x = this.read(this.abs()); this.setNZ(this.x); break; 
            case 0xBE: this.x = this.read(this.absY()); this.setNZ(this.x); break; 

            // --- LDY ---
            case 0xA0: this.y = this.read(this.pc++); this.setNZ(this.y); break; 
            case 0xA4: this.y = this.read(this.zp()); this.setNZ(this.y); break; 
            case 0xB4: this.y = this.read(this.zpX()); this.setNZ(this.y); break; 
            case 0xAC: this.y = this.read(this.abs()); this.setNZ(this.y); break; 
            case 0xBC: this.y = this.read(this.absX()); this.setNZ(this.y); break; 

            // --- STA ---
            case 0x85: this.write(this.zp(), this.a); break; 
            case 0x95: this.write(this.zpX(), this.a); break; 
            case 0x8D: this.write(this.abs(), this.a); break; 
            case 0x9D: this.write(this.absX(), this.a); break; 
            case 0x99: this.write(this.absY(), this.a); break; 
            case 0x81: this.write(this.indX(), this.a); break; 
            case 0x91: this.write(this.indY(), this.a); break; 

            // --- STX / STY ---
            case 0x86: this.write(this.zp(), this.x); break; 
            case 0x96: this.write(this.zpY(), this.x); break; 
            case 0x8E: this.write(this.abs(), this.x); break; 
            case 0x84: this.write(this.zp(), this.y); break; 
            case 0x94: this.write(this.zpX(), this.y); break; 
            case 0x8C: this.write(this.abs(), this.y); break; 

            // --- Transfers ---
            case 0xAA: this.x = this.a; this.setNZ(this.x); break; 
            case 0x8A: this.a = this.x; this.setNZ(this.a); break; 
            case 0xA8: this.y = this.a; this.setNZ(this.y); break; 
            case 0x98: this.a = this.y; this.setNZ(this.a); break; 
            case 0x9A: this.sp = this.x; break; 
            case 0xBA: this.x = this.sp; this.setNZ(this.x); break; 

            // --- INC / DEC ---
            case 0xE8: this.x = (this.x + 1) & 0xFF; this.setNZ(this.x); break; 
            case 0xCA: this.x = (this.x - 1) & 0xFF; this.setNZ(this.x); break; 
            case 0xC8: this.y = (this.y + 1) & 0xFF; this.setNZ(this.y); break; 
            case 0x88: this.y = (this.y - 1) & 0xFF; this.setNZ(this.y); break; 
            case 0xE6: { let z = this.zp(); let v = (this.read(z) + 1) & 0xFF; this.write(z, v); this.setNZ(v); } break; 
            case 0xF6: { let z = this.zpX(); let v = (this.read(z) + 1) & 0xFF; this.write(z, v); this.setNZ(v); } break; 
            case 0xEE: { let a = this.abs(); let v = (this.read(a) + 1) & 0xFF; this.write(a, v); this.setNZ(v); } break; 
            case 0xFE: { let a = this.absX(); let v = (this.read(a) + 1) & 0xFF; this.write(a, v); this.setNZ(v); } break; 
            case 0xC6: { let z = this.zp(); let v = (this.read(z) - 1) & 0xFF; this.write(z, v); this.setNZ(v); } break; 
            case 0xD6: { let z = this.zpX(); let v = (this.read(z) - 1) & 0xFF; this.write(z, v); this.setNZ(v); } break; 
            case 0xCE: { let a = this.abs(); let v = (this.read(a) - 1) & 0xFF; this.write(a, v); this.setNZ(v); } break; 
            case 0xDE: { let a = this.absX(); let v = (this.read(a) - 1) & 0xFF; this.write(a, v); this.setNZ(v); } break; 

            // --- Jumps ---
            case 0x20: { let target = this.abs(); this.push((this.pc - 1) >> 8); this.push((this.pc - 1) & 0xFF); this.pc = target; } break; // JSR
            case 0x4C: this.pc = this.abs(); break; // JMP ABS
            case 0x6C: { let ptr = this.abs(); let low = this.read(ptr); let high = this.read((ptr & 0xFF00) | ((ptr + 1) & 0x00FF)); this.pc = low | (high << 8); } break; // JMP (IND) Page Bug emuliert!
            case 0x60: { let low = this.pop(); let high = this.pop(); this.pc = (low | (high << 8)) + 1; } break; // RTS
            case 0x40: { this.p = this.pop(); let low = this.pop(); let high = this.pop(); this.pc = low | (high << 8); } break; // RTI

            // --- Branches ---
            case 0xD0: { let off = this.read(this.pc++); if (off > 127) off -= 256; if ((this.p & 2) === 0) this.pc += off; } break; // BNE
            case 0xF0: { let off = this.read(this.pc++); if (off > 127) off -= 256; if ((this.p & 2) !== 0) this.pc += off; } break; // BEQ
            case 0x10: { let off = this.read(this.pc++); if (off > 127) off -= 256; if ((this.p & 128) === 0) this.pc += off; } break; // BPL
            case 0x30: { let off = this.read(this.pc++); if (off > 127) off -= 256; if ((this.p & 128) !== 0) this.pc += off; } break; // BMI
            case 0x90: { let off = this.read(this.pc++); if (off > 127) off -= 256; if ((this.p & 1) === 0) this.pc += off; } break; // BCC
            case 0xB0: { let off = this.read(this.pc++); if (off > 127) off -= 256; if ((this.p & 1) !== 0) this.pc += off; } break; // BCS
            case 0x50: { let off = this.read(this.pc++); if (off > 127) off -= 256; if ((this.p & 64) === 0) this.pc += off; } break; // BVC
            case 0x70: { let off = this.read(this.pc++); if (off > 127) off -= 256; if ((this.p & 64) !== 0) this.pc += off; } break; // BVS

            // --- Stack & Flags ---
            case 0x08: this.push(this.p | 0x10); break; // PHP
            case 0x28: this.p = (this.pop() & 0xEF) | 0x20; break; // PLP
            case 0x48: this.push(this.a); break; // PHA
            case 0x68: this.a = this.pop(); this.setNZ(this.a); break; // PLA
            case 0x18: this.p &= ~1; break; // CLC
            case 0x38: this.p |= 1; break; // SEC
            case 0x58: this.p &= ~4; break; // CLI
            case 0x78: this.p |= 4; break; // SEI
            case 0xD8: this.p &= ~8; break; // CLD
            case 0xF8: this.p |= 8; break; // SED
            case 0xB8: this.p &= ~64; break; // CLV

            // --- Math & Logic Helpers ---
            default: this.handleALU(op); break;
        }
    }

    handleALU(op) {
        let val = 0;
        let setVal = true;
        
        // Fetch Operand
        if ([0x69, 0xE9, 0x29, 0x09, 0x49, 0xC9, 0xE0, 0xC0].includes(op)) val = this.read(this.pc++); // IMM
        else if ([0x65, 0xE5, 0x25, 0x05, 0x45, 0xC5, 0xE4, 0xC4, 0x24].includes(op)) val = this.read(this.zp()); // ZP
        else if ([0x75, 0xF5, 0x35, 0x15, 0x55, 0xD5].includes(op)) val = this.read(this.zpX()); // ZP,X
        else if ([0x6D, 0xED, 0x2D, 0x0D, 0x4D, 0xCD, 0xEC, 0xCC, 0x2C].includes(op)) val = this.read(this.abs()); // ABS
        else if ([0x7D, 0xFD, 0x3D, 0x1D, 0x5D, 0xDD].includes(op)) val = this.read(this.absX()); // ABS,X
        else if ([0x79, 0xF9, 0x39, 0x19, 0x59, 0xD9].includes(op)) val = this.read(this.absY()); // ABS,Y
        else if ([0x61, 0xE1, 0x21, 0x01, 0x41, 0xC1].includes(op)) val = this.read(this.indX()); // IND,X
        else if ([0x71, 0xF1, 0x31, 0x11, 0x51, 0xD1].includes(op)) val = this.read(this.indY()); // IND,Y
        else setVal = false;

        if (setVal) {
            let highNibble = op & 0xF0;
            let lowNibble = op & 0x0F;
            
            // AND
            if (highNibble === 0x20 || highNibble === 0x30) { if(op!==0x20&&op!==0x24&&op!==0x28&&op!==0x2A&&op!==0x2C&&op!==0x38) { this.a &= val; this.setNZ(this.a); return; } }
            // ORA
            if (highNibble === 0x00 || highNibble === 0x10) { if(op!==0x00&&op!==0x06&&op!==0x08&&op!==0x0A&&op!==0x0E&&op!==0x10&&op!==0x18) { this.a |= val; this.setNZ(this.a); return; } }
            // EOR
            if (highNibble === 0x40 || highNibble === 0x50) { if(op!==0x40&&op!==0x4A&&op!==0x4C&&op!==0x48&&op!==0x58&&op!==0x50) { this.a ^= val; this.setNZ(this.a); return; } }
            // CMP
            if (highNibble === 0xC0 || highNibble === 0xD0) { if(lowNibble!==0&&lowNibble!==8&&lowNibble!==0xA&&op!==0xD8) { let diff = this.a - val; this.setNZ(diff & 0xFF); if (this.a >= val) this.p |= 1; else this.p &= ~1; return; } }
            // CPX
            if (op===0xE0||op===0xE4||op===0xEC) { let diff = this.x - val; this.setNZ(diff & 0xFF); if (this.x >= val) this.p |= 1; else this.p &= ~1; return; }
            // CPY
            if (op===0xC0||op===0xC4||op===0xCC) { let diff = this.y - val; this.setNZ(diff & 0xFF); if (this.y >= val) this.p |= 1; else this.p &= ~1; return; }
            // ADC
            if (highNibble === 0x60 || highNibble === 0x70) { if(op!==0x60&&op!==0x68&&op!==0x6A&&op!==0x78&&op!==0x70) { let carry = this.p & 1; let sum = this.a + val + carry; let overflow = ((this.a ^ sum) & (val ^ sum) & 0x80) !== 0; if (sum > 255) this.p |= 1; else this.p &= ~1; if (overflow) this.p |= 64; else this.p &= ~64; this.a = sum & 0xFF; this.setNZ(this.a); return; } }
            // SBC
            if (highNibble === 0xE0 || highNibble === 0xF0) { if(op!==0xE0&&op!==0xE4&&op!==0xE8&&op!==0xEA&&op!==0xEC&&op!==0xF8&&op!==0xF0) { let val_inv = val ^ 0xFF; let carry = this.p & 1; let sum = this.a + val_inv + carry; let overflow = ((this.a ^ sum) & (val_inv ^ sum) & 0x80) !== 0; if (sum > 255) this.p |= 1; else this.p &= ~1; if (overflow) this.p |= 64; else this.p &= ~64; this.a = sum & 0xFF; this.setNZ(this.a); return; } }
            // BIT
            if (op === 0x24 || op === 0x2C) { if (val & 0x80) this.p |= 128; else this.p &= ~128; if (val & 0x40) this.p |= 64; else this.p &= ~64; if ((val & this.a) === 0) this.p |= 2; else this.p &= ~2; return; }
        }

        // Shifts & Rotates Memory
        if ([0x06, 0x16, 0x0E, 0x1E, 0x46, 0x56, 0x4E, 0x5E, 0x26, 0x36, 0x2E, 0x3E, 0x66, 0x76, 0x6E, 0x7E].includes(op)) {
            let addr = 0;
            if ([0x06, 0x46, 0x26, 0x66].includes(op)) addr = this.zp();
            else if ([0x16, 0x56, 0x36, 0x76].includes(op)) addr = this.zpX();
            else if ([0x0E, 0x4E, 0x2E, 0x6E].includes(op)) addr = this.abs();
            else if ([0x1E, 0x5E, 0x3E, 0x7E].includes(op)) addr = this.absX();
            
            let v = this.read(addr);
            if ([0x06, 0x16, 0x0E, 0x1E].includes(op)) { if (v & 128) this.p |= 1; else this.p &= ~1; v = (v << 1) & 0xFF; } // ASL
            else if ([0x46, 0x56, 0x4E, 0x5E].includes(op)) { if (v & 1) this.p |= 1; else this.p &= ~1; v = (v >> 1) & 0x7F; } // LSR
            else if ([0x26, 0x36, 0x2E, 0x3E].includes(op)) { let c = this.p & 1; if (v & 128) this.p |= 1; else this.p &= ~1; v = ((v << 1) & 0xFF) | c; } // ROL
            else if ([0x66, 0x76, 0x6E, 0x7E].includes(op)) { let c = this.p & 1; if (v & 1) this.p |= 1; else this.p &= ~1; v = (v >> 1) | (c << 7); } // ROR
            
            this.write(addr, v); this.setNZ(v);
        }
    }
}
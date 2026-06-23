// =========================================================
// DYNAMIC STAGING MODULE
// Analysiert Atari-Register und berechnet fließend X/Y/Z-Bühnenwerte
// =========================================================

export class DynamicStaging {
    constructor() {
        this.state = {
            A: { pan: 0.5, sub: 0.0, rev: 0.2 },
            B: { pan: 0.5, sub: 0.0, rev: 0.2 },
            C: { pan: 0.5, sub: 0.0, rev: 0.2 }
        };
    }

    // speed = 0.002 (Standard), kann für BladeRunner angepasst werden
    update(pA, pB, pC, nA, nB, nC, speed = 0.002) {
        let tPanA = 0.2; let tSubA = 0.0; let tRevA = 0.3;
        let tPanB = 0.8; let tSubB = 0.0; let tRevB = 0.6; 
        let tPanC = 0.5; let tSubC = 0.0; let tRevC = 0.3;

        // Bass Detection (>800 is below ~156Hz)
        if (pA > 800 && !nA) { tPanA = 0.5; tSubA = 1.0; tRevA = 0.0; } 
        if (pB > 800 && !nB) { tPanB = 0.5; tSubB = 1.0; tRevB = 0.0; }
        if (pC > 800 && !nC) { tPanC = 0.5; tSubC = 1.0; tRevC = 0.0; }

        // Percussion Override (Noise zentriert den Sound)
        if (nA) { tPanA = 0.5; tSubA = 0.0; tRevA = 0.1; }
        if (nB) { tPanB = 0.5; tSubB = 0.0; tRevB = 0.1; }
        if (nC) { tPanC = 0.5; tSubC = 0.0; tRevC = 0.1; }

        // Slew Limiting (Weiches Morphing)
        this.state.A.pan += (tPanA - this.state.A.pan) * speed; 
        this.state.A.sub += (tSubA - this.state.A.sub) * speed; 
        this.state.A.rev += (tRevA - this.state.A.rev) * speed;
        
        this.state.B.pan += (tPanB - this.state.B.pan) * speed; 
        this.state.B.sub += (tSubB - this.state.B.sub) * speed; 
        this.state.B.rev += (tRevB - this.state.B.rev) * speed;
        
        this.state.C.pan += (tPanC - this.state.C.pan) * speed; 
        this.state.C.sub += (tSubC - this.state.C.sub) * speed; 
        this.state.C.rev += (tRevC - this.state.C.rev) * speed;

        return this.state;
    }
}
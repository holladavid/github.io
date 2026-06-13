// ==========================================
// YM2149 (Atari ST) AudioWorkletProcessor
// ==========================================

class YMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        
        // Die 14 klassischen Hardware-Register des YM2149
        // 0-1: Kanal A Periode (Tonhöhe)
        // 2-3: Kanal B Periode
        // 4-5: Kanal C Periode
        // 6:   Rauschen Periode
        // 7:   Mixer (Schaltet Ton/Rauschen für A, B, C an/aus)
        // 8-10: Lautstärke (Amplituden) für A, B, C
        // 11-13: Hüllkurven-Register (lassen wir für diesen Basic-Core erstmal vereinfacht)
        this.regs = new Uint8Array(14);
        
        // Atari ST YM2149 Taktfrequenz in Hertz (2 MHz)
        this.clock = 2000000;
        
        // Oszillator-Zustände (Phase Accumulators für die Rechteckwellen)
        this.phaseA = 0;
        this.phaseB = 0;
        this.phaseC = 0;
        
        // Rauschgenerator (Linear Feedback Shift Register - LFSR)
        this.noiseLfsr = 1; // Darf nie 0 sein!
        this.noisePhase = 0;
        this.noiseOutput = 1;
        
        // Hört auf Nachrichten vom Haupt-Thread (z.B. Register-Updates vom Player)
        this.port.onmessage = (event) => {
            if (event.data.type === 'WRITE_REG') {
                this.regs[event.data.reg] = event.data.val;
            }
        };
    }

    // Hilfsfunktion: Berechnet die echte Frequenz aus den 12-Bit YM-Registern
    getFrequency(coarseReg, fineReg) {
        // YM kombiniert zwei Register (Grob & Fein) zu einem 12-Bit Wert
        let period = ((this.regs[coarseReg] & 0x0F) << 8) | this.regs[fineReg];
        if (period === 0) period = 1; // Division durch Null verhindern
        
        // Formel des YM2149: Frequenz = Clock / (16 * Periode)
        return this.clock / (16 * period);
    }

    // Hilfsfunktion: Generiert eine Rechteckwelle (Square Wave)
    getSquareWave(phase) {
        // Phase läuft von 0.0 bis 1.0. 
        // 1. Hälfte ist positiv (+1), 2. Hälfte ist negativ (-1)
        return phase < 0.5 ? 1.0 : -1.0;
    }

    // Die Kern-Schleife der Web Audio API. 
    // Wird ca. 344 Mal pro Sekunde aufgerufen und muss 128 Samples berechnen.
    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channelLeft = output[0];  // Linker Lautsprecher
        const channelRight = output[1] || output[0]; // Rechter (Fallback auf Mono)
        
        // Aktuelle Frequenzen für diesen Frame berechnen
        const freqA = this.getFrequency(1, 0);
        const freqB = this.getFrequency(3, 2);
        const freqC = this.getFrequency(5, 4);
        
        // Rauschfrequenz (Register 6, nur 5 Bits)
        let noisePeriod = this.regs[6] & 0x1F;
        if (noisePeriod === 0) noisePeriod = 1;
        const noiseFreq = this.clock / (16 * noisePeriod);
        
        // Mixer-Register auslesen (Bit = 0 bedeutet EINGESCHALTET, historisch invertiert!)
        const mix = this.regs[7];
        const toneEnableA = (mix & 0x01) === 0;
        const toneEnableB = (mix & 0x02) === 0;
        const toneEnableC = (mix & 0x04) === 0;
        const noiseEnableA = (mix & 0x08) === 0;
        const noiseEnableB = (mix & 0x10) === 0;
        const noiseEnableC = (mix & 0x20) === 0;

        // Array für unsere Oszilloskop-Visualisierung später
        let currentVisualValue = 0;

        // 128 Samples für den Audio-Puffer generieren
        for (let i = 0; i < channelLeft.length; i++) {
            
            // 1. Phasen (Zeitzähler) weiterschieben (abhängig von der SampleRate, meist 48kHz)
            this.phaseA += freqA / sampleRate;
            this.phaseB += freqB / sampleRate;
            this.phaseC += freqC / sampleRate;
            this.noisePhase += noiseFreq / sampleRate;
            
            // Phasen bei 1.0 umbrechen
            if (this.phaseA >= 1.0) this.phaseA -= 1.0;
            if (this.phaseB >= 1.0) this.phaseB -= 1.0;
            if (this.phaseC >= 1.0) this.phaseC -= 1.0;
            
            // 2. Rausch-Logik (LFSR Taktung)
            if (this.noisePhase >= 1.0) {
                this.noisePhase -= 1.0;
                // 17-Bit LFSR Shift (historisch korrekt für YM2149)
                this.noiseLfsr ^= (((this.noiseLfsr & 1) ^ ((this.noiseLfsr >> 3) & 1)) << 17);
                this.noiseLfsr >>= 1;
                this.noiseOutput = (this.noiseLfsr & 1) ? 1.0 : -1.0;
            }

            // 3. Oszillatoren auslesen (Rechteckwelle)
            let outA = toneEnableA ? this.getSquareWave(this.phaseA) : 1.0;
            let outB = toneEnableB ? this.getSquareWave(this.phaseB) : 1.0;
            let outC = toneEnableC ? this.getSquareWave(this.phaseC) : 1.0;
            
            // Rauschen dazumischen (Logical AND, wie im Original-Chip)
            if (noiseEnableA) outA = (outA === 1.0 && this.noiseOutput === 1.0) ? 1.0 : -1.0;
            if (noiseEnableB) outB = (outB === 1.0 && this.noiseOutput === 1.0) ? 1.0 : -1.0;
            if (noiseEnableC) outC = (outC === 1.0 && this.noiseOutput === 1.0) ? 1.0 : -1.0;

            // 4. Lautstärken (Register 8, 9, 10 - Werte 0-15) anwenden
            // YM2149 Amplitude ist nicht linear! (Später optimieren wir das auf eine Lookup-Table)
            let volA = (this.regs[8] & 0x0F) / 15.0;
            let volB = (this.regs[9] & 0x0F) / 15.0;
            let volC = (this.regs[10] & 0x0F) / 15.0;

            // 5. Kanäle zusammenmischen
            // Zur Sicherheit dämpfen wir das Gesamtsignal (/3), um Übersteuern (Clipping) zu verhindern
            let mixedOutput = ((outA * volA) + (outB * volB) + (outC * volC)) / 3.0;

            // Mono-Signal auf beide Boxen legen
            channelLeft[i] = mixedOutput;
            if (channelRight) channelRight[i] = mixedOutput;

            // Speichern wir einen Sample-Wert für das Oszilloskop im Haupt-Thread ab
            if (i === 0) currentVisualValue = mixedOutput;
        }

        // Sende die Daten für das Demoscene-Oszilloskop an die app.js
        this.port.postMessage({
            type: 'VISUAL_DATA',
            value: currentVisualValue,
            regs: this.regs // Die Register schicken wir mit, falls wir sie anzeigen wollen
        });

        return true; // Hält den Processor am Leben
    }
}

// Worklet registrieren
registerProcessor('ym-processor', YMProcessor);
// ==========================================
// PAULA 8364 (Amiga) AudioWorkletProcessor
// ==========================================

class PaulaProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        
        // Die Amiga PAL Taktfrequenz (3.546895 MHz)
        this.clock = 3546895; 
        
        // Paula hat 4 Hardware-Kanäle mit extremem Hard-Panning (Left/Right)
        this.channels = [
            { pos: 0, period: 0, vol: 0, data: null, loopStart: 0, loopLen: 0, pan: -1 }, // Kanal 1: 100% Links
            { pos: 0, period: 0, vol: 0, data: null, loopStart: 0, loopLen: 0, pan: 1 },  // Kanal 2: 100% Rechts
            { pos: 0, period: 0, vol: 0, data: null, loopStart: 0, loopLen: 0, pan: 1 },  // Kanal 3: 100% Rechts
            { pos: 0, period: 0, vol: 0, data: null, loopStart: 0, loopLen: 0, pan: -1 }  // Kanal 4: 100% Links
        ];

        this.port.onmessage = (e) => {
            const msg = e.data;
            const ch = this.channels[msg.channel];
            if (!ch) return;
            
            if (msg.type === 'SET_SAMPLE') {
                // Ein Instrument (Array aus Float-Werten) in den RAM des Kanals laden
                ch.data = msg.data;
                ch.loopStart = msg.loopStart || 0;
                ch.loopLen = msg.loopLen || 0;
                ch.pos = 0; 
            } else if (msg.type === 'SET_REG') {
                // Register beschreiben (Periode & Lautstärke)
                if (msg.period !== undefined) ch.period = msg.period;
                // Amiga Lautstärke geht von 0 bis 64
                if (msg.vol !== undefined) ch.vol = msg.vol / 64.0; 
                // Wenn Trigger gesetzt ist, startet das Sample von vorne
                if (msg.trigger) ch.pos = 0;
            }
        };
    }

    process(inputs, outputs, parameters) {
        const outL = outputs[0][0]; // Linker Lautsprecher
        const outR = outputs[0][1] || outputs[0][0]; // Rechter Lautsprecher

        let oscValue = 0;

        for (let i = 0; i < outL.length; i++) {
            let mixedL = 0;
            let mixedR = 0;

            // Alle 4 Amiga Kanäle berechnen
            for (let c = 0; c < 4; c++) {
                const ch = this.channels[c];
                
                // Nur abspielen, wenn Daten da sind und Periode > 0 (Schutz vor Division durch 0)
                if (ch.data && ch.period > 0 && ch.vol > 0) {
                    
                    // Nearest-Neighbor Interpolation (Der raue Amiga-Klang!)
                    let posInt = Math.floor(ch.pos);
                    
                    if (posInt < ch.data.length) {
                        let sampleVal = ch.data[posInt] * ch.vol;
                        
                        // Hard-Panning auf die Lautsprecher verteilen
                        if (ch.pan < 0) mixedL += sampleVal;
                        else mixedR += sampleVal;
                    }

                    // Die Formel für die Abspielgeschwindigkeit im Amiga:
                    // Sample-Frequenz = Amiga Clock / Period
                    let playbackFreq = this.clock / ch.period;
                    
                    // Zeiger im Sample-Array vorwärts bewegen
                    ch.pos += playbackFreq / sampleRate;

                    // Hardware-Looping Logik
                    if (ch.pos >= ch.data.length) {
                        if (ch.loopLen > 2) {
                            // Zurück zum Loop-Punkt springen
                            ch.pos = ch.loopStart + (ch.pos - ch.data.length);
                        } else {
                            // Kein Loop -> Stille
                            ch.data = null; 
                        }
                    }
                }
            }
            
            // Ausgabe dämpfen, damit es bei 4 Kanälen nicht übersteuert
            outL[i] = mixedL / 2.0;
            outR[i] = mixedR / 2.0;
            
            if (i === 0) oscValue = (mixedL + mixedR) / 2.0;
        }

        // Für unser Oszilloskop im Haupt-Thread
        this.port.postMessage({ type: 'VISUAL_DATA', value: oscValue });

        return true;
    }
}

registerProcessor('paula-processor', PaulaProcessor);
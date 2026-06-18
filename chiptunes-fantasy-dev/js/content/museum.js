// ==========================================
// DAS DIGITALE MUSEUM (Texte & Handbücher)
// ==========================================

export const systemDescriptions = {
    c64: `
        <div style="border: 1px solid var(--text-color); padding: 10px; margin-bottom: 15px; background: rgba(0,0,0,0.2);">
            <h3 style="color: var(--highlight-color); margin-bottom: 5px;">[ CHIP-SPECS: MOS SID 6581 ]</h3>
            <p>Ein echter, analoger subtraktiver Synthesizer auf einem Silizium-Chip. Besitzt 3 Oszillatoren, Hardware-ADSR-Hüllkurven und ein legendäres, rein analoges Multimode-Filter.</p>
            <p style="margin-top: 8px;"><strong>🔥 Szene-Hack (PWM):</strong> Da der C64 nur 3 Stimmen hat, modulierten Coder die Pulsweite der Rechteckwelle (PWM) in rasender Geschwindigkeit, um wabernde, extrem "dicke" Bässe zu erzeugen, die klingen, als liefen mehrere Oszillatoren gleichzeitig.</p>
        </div>
    `,
    amiga: `
        <div style="border: 1px solid var(--text-color); padding: 10px; margin-bottom: 15px; background: rgba(0,0,0,0.2);">
            <h3 style="color: var(--highlight-color); margin-bottom: 5px;">[ CHIP-SPECS: MOS PAULA 8364 ]</h3>
            <p>Paula revolutionierte den Sound durch Direct Memory Access (DMA). Anstatt Töne zu generieren, liest Paula 4 eigenständige 8-Bit PCM-Samples direkt aus dem RAM und pitcht sie in Hardware stufenlos hoch und runter.</p>
            <p style="margin-top: 8px;"><strong>🔥 Szene-Hack (Software-Mixing):</strong> Um das starre Hard-Panning (1&4 links, 2&3 rechts) und das 4-Kanal-Limit zu überwinden, mischten geniale Programmierer (wie Chris Hülsbeck) per CPU mehrere Samples zusammen, um 7-stimmige Polyphonie zu erreichen.</p>
        </div>
    `,
    atari: `
        <div style="border: 1px solid var(--text-color); padding: 15px; margin-bottom: 15px; background: rgba(0,0,0,0.3); line-height: 1.6;">
            <h3 style="color: var(--highlight-color); margin-bottom: 15px; border-bottom: 1px dashed var(--text-color); padding-bottom: 5px;">[ DEEP DIVE: YM2149F ARCHITEKTUR ]</h3>
            <p>Der Yamaha YM2149 (im Atari ST mit 2 MHz getaktet) ist ein puristischer Rechteck-Synthesizer. Er hat keine analogen Filter, aber eine geniale, rohe digitale Architektur. Hier erfährst du, was die Live-Werte im DSP-Analyzer (oben rechts) bedeuten:</p>

            <h4 style="color: var(--highlight-color); margin: 20px 0 5px 0;">> DIE OSZILLATOREN (CH A, B, C)</h4>
            <p>Drei reine Rechteckwellen. Die Tonhöhe (Pitch) wird über einen 12-Bit Timer gesteuert. <em>Vorsicht, Counter-Logic:</em> Es ist ein Teiler-Wert! Je kleiner die Zahl im Register, desto höher der Ton (Hertz = Takt / (16 * Period)).</p>

            <h4 style="color: var(--highlight-color); margin: 20px 0 5px 0;">> DER NOISE-GENERATOR (N-FREQ)</h4>
            <p>Ein 5-Bit Linear Feedback Shift Register (LFSR), das pseudozufälliges "weißes Rauschen" generiert. Die Frequenz bestimmt, wie "hell" oder "dumpf" das Rauschen klingt.<br>
            <strong>🎵 Szene-Trick:</strong> Musiker änderten die Noise-Frequenz rasend schnell, um aus dem statischen Rauschen knackige Snare-Drums und zischende Hi-Hats zu formen.</p>

            <h4 style="color: var(--highlight-color); margin: 20px 0 5px 0;">> DER MIXER (TONE & NOISE)</h4>
            <p>Das logische Herz des Chips. Für jeden der 3 Kanäle kann man Rechteckwelle (Tone) und Rauschen (Noise) separat ein- oder ausschalten.<br>
            <strong>🎵 Szene-Trick:</strong> Legt man auf einen Kanal Tone UND Noise gleichzeitig, entsteht ein rauer, metallischer Klang – perfekt für elektronische Percussion.</p>

            <h4 style="color: var(--highlight-color); margin: 20px 0 5px 0;">> HARDWARE ENVELOPE GENERATOR (HEG)</h4>
            <p>Eigentlich gedacht, die Lautstärke ohne CPU-Last zu formen (16 feste Shapes). Ein Kanal nutzt den HEG, wenn die <strong>HEG-LED</strong> im HUD leuchtet.<br>
            <strong>🔥 Der Hippel-Hack:</strong> Jochen Hippel setzte die HEG-Frequenz so extrem hoch an, dass die Hüllkurve selbst hörbar wurde! Er nutzte die wilden HEG-Shapes, um die menschliche Stimme ("Tha-li-on" Intro) zu simulieren.</p>

            <h4 style="color: var(--highlight-color); margin: 20px 0 5px 0;">> PCM SAMPLES (DIGI HACK)</h4>
            <p>Hardwareseitig unterstützt der Chip <strong>keine</strong> Sprachsamples. Coder nutzten CPU-Timer, um 12.000 Mal pro Sekunde das Lautstärkeregister direkt zu überschreiben.<br>
            <strong>💾 Format-Geheimnis:</strong> Um diese PCM-Trigger in kleinen <code>.ym</code> Dateien zu speichern, versteckte Arnaud Carré (Leonard) die Sample-Nummer genial in den physikalisch ungenutzten Bits (Bit 4-7) der Pitch-Register.</p>
        </div>
    `
};

export const chipCheatSheets = {
    atari: `
        <strong>YM2149 Cheat Sheet:</strong><br>
        <span style="color:#fff">R00-R05:</span> Pitch A/B/C (Fine & Coarse)<br>
        <span style="color:#fff">R06:</span> Noise Frequency<br>
        <span style="color:#fff">R07:</span> Mixer (Bit 0-2 Tone, 3-5 Noise)<br>
        <span style="color:#fff">R08-R0A:</span> Volume A/B/C (Bit 4 = HEG Mode)<br>
        <span style="color:#fff">R0B-R0C:</span> Hardware Envelope (HEG) Period<br>
        <span style="color:#fff">R0D:</span> HEG Shape (Saw, Triangle, etc.)<br>
        <span style="color:#fff">R0F:</span> Geheimer Digidrum-Trigger!
    `,
    c64: `
        <strong>SID 6581 Cheat Sheet:</strong><br>
        <span style="color:#fff">R00-R06:</span> Voice 1 (Freq, PW, Ctrl, AD, SR)<br>
        <span style="color:#fff">R07-R0D:</span> Voice 2 (Freq, PW, Ctrl, AD, SR)<br>
        <span style="color:#fff">R0E-R14:</span> Voice 3 (Freq, PW, Ctrl, AD, SR)<br>
        <span style="color:#fff">R15-R16:</span> Filter Cutoff Frequency<br>
        <span style="color:#fff">R17:</span> Resonance & Voice Routing<br>
        <span style="color:#fff">R18:</span> Filter Mode & Master Volume
    `,
    amiga: `
        <strong>PAULA DMA Cheat Sheet:</strong><br>
        (Hardware via Software repräsentiert)<br>
        <span style="color:#fff">CH1-CH4 (je 4 Bytes):</span><br>
        [0-1]: Periode (Pitch)<br>
        [2]: Volume (0-64)<br>
        [3]: Trigger-Status (Aktiv/Inaktiv)
    `
};
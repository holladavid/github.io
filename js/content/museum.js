// === js/content/museum.js ===
// ==========================================
// DAS DIGITALE MUSEUM (Texte & Handbücher)
// Mit integrierten Hardware-Spezifikations-Tabellen
// ==========================================

export const systemDescriptions = {
c64: `
        <!-- === TECHNICAL SPECIFICATION GRID (C64 SID 6581) === -->
        <div style="padding: 8px 12px; margin-bottom: 20px; font-size: calc(var(--font-size-base) * 0.85); background: rgba(0,0,0,0.3); font-family: inherit;">
            <p style="color: var(--highlight-color); margin-bottom: 8px; font-weight: bold; border-bottom: 1px dashed var(--text-color); padding-bottom: 4px;">>>> HARDWARE SPECIFICATIONS:</p>
            <div style="display: grid; grid-template-columns: 140px 1fr; gap: 6px; line-height: 1.4;">
                <div><strong>Kanäle:</strong></div><div>3 unabhängige Synthesestimmen + 1 routbares analoges VCF</div>
                <div><strong>Taktfrequenz:</strong></div><div>985.248 Hz (PAL) / 1.022.727 Hz (NTSC)</div>
                <div><strong>Wellenformen:</strong></div><div>Dreieck, Sägezahn, PWM, Rauschen (23-Bit LFSR), analoge Gatter-Mischungen</div>
                <div><strong>Analog-Filter:</strong></div><div>12dB/Okt Multimode-Filter (LP/BP/HP/Notch) mit frei wählbarer Stimmen-Zuweisung</div>
                <div><strong>Hüllkurven:</strong></div><div>3 x ADSR (15-Bit Rate-Counter, exponentielle Kondensator-Entladung)</div>
                <div><strong>Sequenzierung:</strong></div><div>Freie 6502-Assembler-Player via PAL-VBLANK (50Hz) o. CIA-Timer</div>
            </div>
        </div>

        <div style="border-left: 4px solid var(--text-color); padding: 10px 15px; margin-bottom: 15px; background: rgba(0,0,0,0.2); line-height: 1.6;">
            <h3 style="color: var(--highlight-color); margin-bottom: 15px;">[ DEEP DIVE: MOS TECHNOLOGY SID 6581 ]</h3>
            <p>Der Sound Interface Device (SID), 1981 von Bob Yannes entworfen, ist ein analoger subtraktiver Synthesizer auf einem einzigen Silizium-Chip. Er besitzt 3 Oszillatoren (Sägezahn, Dreieck, Rechteck, Rauschen), individuelle ADSR-Generatoren und ein analoges Multimode-Filter.</p>

            <h4 style="color: var(--highlight-color); margin: 25px 0 5px 0;">> HISTORIE: DER 24-JÄHRIGE REBELL & DAS JUBILÄUM DES SIDS</h4>
            <p>In der zweiten Hälfte des Jahres 1981 stand der erst 24-jährige Robert "Bob" Yannes vor einer monumentalen Aufgabe. Commodore-Gründer Jack Tramiel gab der Halbleiter-Sparte MOS Technology ein knallhartes Ultimatum: Der Sound- und Grafikchip für das geplante "Project Red" (den späteren Commodore 64) musste in genau <strong>fünf Monaten</strong> fertig sein, um pünktlich zur Consumer Electronics Show (CES) im Januar 1982 präsentiert werden zu können.</p>
            <p>Yannes, der kurz zuvor als junger Absolvent eingestellt worden war, verabscheute die damals typischen simplen Soundchips der Spielhallen-Ära (die er als "primitive Beep-Generatoren" bezeichnete). Da er in seiner Freizeit hobbymäßig eigene Synthesizer gebaut hatte, beschloss er, das Unmögliche zu wagen: Er wollte einen vollwertigen, professionellen subtraktiven Synthesizer auf ein winziges Stück Silizium bannen. Unter extremem Zeitdruck entwarf er ein revolutionäres Design mit drei physisch getrennten Stimmen, flexiblen ADSR-Hüllkurven und einem echten analogen Multimode-Filter.</p>

            <h4 style="color: var(--highlight-color); margin: 25px 0 5px 0;">> DIE ANOMALIEN: WARUM DER SID SCHWER ZU EMULIEREN IST</h4>
            <p>Die unerreichte Seele des SID-Klangs liegt in seinen physikalischen "Fehlern" und analogen Imperfektionen begründet. Das ist auch der Grund, weshalb einfache Emulationen oft steril und flach klingen. Unser cycle-genauer Mischer bildet diese Anomalien präzise ab:</p>
            <ul>
                <li><strong>NMOS Transistor Sättigung:</strong> Wenn Musiker mehrere Wellenformen auf einem Kanal mischten (z. B. Dreieck + Sägezahn), war dies kein logisches digitales ODER. Die analogen Signalströme belasteten sich auf dem Silizium physisch gegenseitig, was zu nicht-linearen harmonischen Verzerrungen (Sättigung) führte.</li>
                <li><strong>DC-Leakage & der Galway-Hack ($D418):</strong> Die analoge VCA-Lautstärkeregelung hatte ein leichtes Gleichspannungs-Leck. Martin Galway (Komponist von <em>Wizball</em>) fand heraus, dass man dieses Leck ausnutzen konnte: Durch blitzschnelles Beschreiben des Lautstärkeregisters mit mehreren Kilohertz erzeugte die CPU eine hörbare DC-Spannungsschwankung – der berühmte 4-Bit-Sample-Hack war geboren, den unser neuer 1-MHz-Mischer detailgetreu wiedergibt.</li>
                <li><strong>Thermal Cutoff Drift:</strong> Der analoge Filter besaß keine Temperaturkompensation. Wenn sich der Rechner im Betrieb erwärmte, sank der Widerstand der internen FET-Transistoren, wodurch die Filter-Grenzfrequenz (Cutoff) dramatisch abrutschte. Ein Track, der nachmittags im heißen Studio warm klang, klang morgens eisig und schrill. (Dies lässt sich über unseren <em>TEMP</em>-Regler manuell nachstellen).</li>
            </ul>

            <h4 style="color: var(--highlight-color); margin: 25px 0 5px 0;">> DIE ANALOGE FILTER-ROUTING-MATRIX ($D417)</h4>
            <p>Der SID besitzt auf dem Silizium genau einen physischen Filter-Schaltkreis (VCF). Coder konnten in Register <strong>$D417</strong> über einzelne Schalter (Bits) für jede der 3 Stimmen entscheiden, ob sie den Filter durchlaufen oder ihn umgehen (Bypass).<br>
            <strong>🎵 Szene-Trick:</strong> Komponisten schickten oft nur die fette Bassline (Stimme 1) in den Filter, um sie per LFO "wabbeln" zu lassen, während die schnellen Arpeggios und Drums (Stimme 2 & 3) ungefiltert direkt zum Master-Out liefen, um kristallklar und aggressiv zu bleiben. (Tipp: Beobachte im HUD die LEDs unter <em>Routing (V1/V2/V3)</em>!)</p>

            <h4 style="color: var(--highlight-color); margin: 25px 0 5px 0;">> DIE 3-STIMMEN-POLYPHONIE-FALLE (ARPEGGIOS)</h4>
            <p>Da der SID nur über 3 Stimmen verfügt, mussten Musiker tricksen, um dreistimmige Akkorde plus Bass und Melodie abzubilden. Sie koppelten die Akkord-Noten (z. B. Grundton, kleine Terz, Quinte) in einer schnellen 50Hz-VBLANK-Routine auf einer einzigen Stimme. Durch das rasant schnelle Umschalten der Frequenz entsteht das berühmte "Flirren" (Arpeggio), das dem menschlichen Ohr einen echten, dreistimmigen Akkord vorgaukelt.</p>

            <h4 style="color: var(--highlight-color); margin: 25px 0 5px 0;">> DYNAMISCHE PULSWEITENMODULATION (PWM)</h4>
            <p>Um dünne Synth-Klänge extrem "fett" und schwebend klingen zu lassen, modulierten Coder die Rechteckbreite (Pulse Width) über sinusförmige Software-LFOs. Das erzeugte ein sattes chorusschwebendes Klangbild, das klingt, als spielten mehrere Oszillatoren gleichzeitig.</p>
        </div>
    `,
    amiga: `
        <!-- === TECHNICAL SPECIFICATION GRID (AMIGA MOS PAULA 8364) === -->
        <div style="padding: 4px 0; margin-bottom: 20px; font-size: calc(var(--font-size-base) * 0.85); background: transparent; font-family: inherit;">
            <p style="color: var(--highlight-color); margin-bottom: 12px; font-weight: bold; border-bottom: 1px dashed var(--text-color); padding-bottom: 4px;">>>> HARDWARE SPECIFICATIONS:</p>
            <div style="display: grid; grid-template-columns: 140px 1fr; gap: 6px; line-height: 1.4;">
                <div><strong>Kanäle:</strong></div><div>4 x DMA-PCM-Kanäle (L-R-R-L Hard-Panning mit 3.5% Crosstalk)</div>
                <div><strong>Taktfrequenz:</strong></div><div>3.546.895 Hz (PAL) / Internes 4x Oversampling (192 kHz)</div>
                <div><strong>D/A-Wandlung:</strong></div><div>Zero-Order Hold (ZOH) ohne Interpolation + Sinc-FIR Decimator</div>
                <div><strong>Audioauflösung:</strong></div><div>8-Bit Sample × 6-Bit Volume = 14-Bit Multiplying DAC (MDAC)</div>
                <div><strong>Analog-Filter:</strong></div><div>6dB/Okt statischer Lowpass (4.42kHz) + 12dB/Okt LED-Butterworth (3.09kHz)</div>
                <div><strong>Sequenzierung:</strong></div><div>ProTracker (MOD) o. FastTracker (XM) Patterns via CIA-A-BPM-Timer</div>
            </div>
        </div>

        <div style="border-left: 4px solid var(--text-color); padding: 10px 15px; margin-bottom: 15px; background: rgba(0,0,0,0.2); line-height: 1.6;">
            <h3 style="color: var(--highlight-color); margin-bottom: 15px;">[ DEEP DIVE: MOS TECHNOLOGY PAULA 8364 ]</h3>
            <p>Paula war das Herzstück des Amiga-Audiosystems und einer der fortschrittlichsten Soundchips seiner Epoche. Während die Konkurrenz noch Töne synthetisierte, brachte Paula echten Direct Memory Access (DMA) PCM-Sound in die Wohnzimmer.</p>

            <h4 style="color: var(--highlight-color); margin: 25px 0 5px 0;">> HISTORIE: JAY MINERS MENTORSHIP & GLENN KELLERS ERSTER CHIP</h4>
            <p>In der frühen Entwicklungsphase der Amiga-Lorraine-Prototypen trug Paula den internen Namen <strong>Portia</strong> (abgeleitet von I/O "Ports"). Die Schaltung wurde vom jungen Ingenieur <strong>Glenn Keller</strong> entworfen, der von Amiga-Urvater Jay Miner persönlich betreut wurde. Faszinierend dabei: Paula war Glenn Kellers <strong>allerliebstes und erstes Chip-Design überhaupt</strong>! Und er lieferte ein absolutes Meisterwerk ab. Während der Amiga im Laufe der Jahre technologisch weiterentwickelt wurde und Chips wie Agnus oder Denise mehrfach neu designt wurden, blieb Paula über die gesamte Lebensspanne des Amiga von 1985 bis 1992 <strong>völlig unverändert</strong>.</p>

            <h3 style="color: var(--highlight-color); margin: 30px 0 15px 0;">[ CHIP-SPECS: EMULIERTE HARDWARE-KOMPONENTEN ]</h3>
            <p>Um den typischen, druckvollen "Amiga 500 Sound" exakt nachzubilden, bricht unser <em>Exact-Core</em> mit modernen Konventionen und emuliert die physikalischen Limitationen des Chips:</p>

            <h4 style="color: var(--highlight-color); margin: 20px 0 5px 0;">> ZERO-ORDER HOLD (ZOH) & OVERSAMPLING</h4>
            <p>Paula kennt keine Interpolation. Ein über DMA ausgelesener 8-Bit-Wert wird als analoge Spannung exakt so lange gehalten (Zero-Order Hold), bis der nächste Fetch kommt. Diese eckigen Treppenstufen erzeugen massive Spiegelfrequenzen im Ultraschallbereich – den berühmten perlenden <strong>Amiga-Schimmer</strong>. Normale Emulatoren falten diese Frequenzen klirrend in den hörbaren Bereich zurück (Aliasing). Unser Core taktet die D/A-Wandlung deshalb mit <strong>192 kHz (4x Oversampling)</strong>, jagt die ZOH-Treppen durch die echten analogen Filter-Gleichungen und dezimiert sie danach mit einem 255-Tap Sinc-FIR Filter aliasing-frei auf 48 kHz.</p>

            <h4 style="color: var(--highlight-color); margin: 15px 0 5px 0;">> L-R-R-L HARD-PANNING & CROSSTALK</h4>
            <p>Der Amiga 500 besitzt keinen Panning-Mixer. Die Ausgabe ist physisch auf dem Mainboard verlötet: Kanäle 0 und 3 gehen zu 100% auf den linken Cinch-Ausgang, 1 und 2 zu 100% auf den rechten. Unser <em>Exact-Core</em> ignoriert moderne Tracker-Panning-Befehle rigoros und simuliert stattdessen nur ein winziges induktives Übersprechen (Crosstalk von 3,5%) der Motherboard-Leiterbahnen. Das garantiert die gnadenlose, breite Stereo-Trennung, die das Mischen von Amiga-MODs damals so unglaublich schwer machte.</p>

            <h4 style="color: var(--highlight-color); margin: 15px 0 5px 0;">> DMA WORD ALIGNMENT</h4>
            <p>Paula greift über den Systembus (gesteuert durch Agnus) immer im 16-Bit-Raster (Words = 2 Bytes) auf das Chip-RAM zu. Moderne PC-Tracker erlauben oft ungerade Loop-Marker oder Sample-Offsets. Unsere Engine zwingt alle Speicher-Pointer physikalisch korrekt per Bitmaske (<code>& ~1</code>) auf gerade Adressen. Nur so "snappen" die Loops historisch akkurat.</p>

            <h4 style="color: var(--highlight-color); margin: 15px 0 5px 0;">> DIE ANALOGEN FILTER-STUFEN</h4>
            <p>Das Signal passiert nach dem D/A-Wandler zwei analoge Hürden:<br>
            1. Einen permanenten <strong>RC-Tiefpass (6 dB/oct)</strong> bei 4.42 kHz, der hochfrequentes Digitalrauschen sachte abfedert.<br>
            2. Einen zuschaltbaren <strong>LED-Filter (12 dB/oct Butterworth)</strong> bei 3.09 kHz, der an die Helligkeit der Power-LED gekoppelt war und den Klang extrem "dumpf" und warm abdunkeln konnte.</p>
        </div>
    `,
    atari: `
        <!-- === TECHNICAL SPECIFICATION GRID (ATARI YM2149F) === -->
        <div style="padding: 4px 0; margin-bottom: 20px; font-size: calc(var(--font-size-base) * 0.85); background: transparent; font-family: inherit;">
            <p style="color: var(--highlight-color); margin-bottom: 8px; font-weight: bold; border-bottom: 1px dashed var(--text-color); padding-bottom: 4px;">>>> HARDWARE SPECIFICATIONS:</p>
            <div style="display: grid; grid-template-columns: 140px 1fr; gap: 6px; line-height: 1.4;">
                <div><strong>Kanäle:</strong></div><div>3 Oszillatoren (Rechteck) + 1 LFSR Noise-Generator</div>
                <div><strong>Taktfrequenz:</strong></div><div>2.000.000 Hz (2.0 MHz True Lockstep Emulation)</div>
                <div><strong>D/A-Wandler:</strong></div><div>Logarithmisch, 32 diskrete Stufen (-1.5dB pro Stufe)</div>
                <div><strong>Hüllkurven:</strong></div><div>1x Hardware Envelope Generator (HEG) mit echter 5-Bit Auflösung</div>
                <div><strong>Motherboard:</strong></div><div>RC-Tiefpass (~15.9 kHz) + Sinc-FIR Decimator (Zero Aliasing)</div>
                <div><strong>Sequenzierung:</strong></div><div>Register-Logging via 50Hz-VBLANK & CPU Timer-B (YM5/YM6)</div>
            </div>
        </div>

        <div style="border-left: 4px solid var(--text-color); padding: 10px 15px; margin-bottom: 15px; background: rgba(0,0,0,0.2); line-height: 1.6;">
            <h3 style="color: var(--highlight-color); margin-bottom: 15px;">[ DEEP DIVE: YAMAHA YM2149F (ATARI ST) ]</h3>
            <p>Der Yamaha YM2149F war der akustische Herzschlag der 16-Bit Atari ST Serie. Oft fälschlicherweise für einen simplen Klon des GI AY-3-8910 gehalten, barg der Yamaha-Chip ein massives Geheimnis, das ihn klanglich überlegen machte.</p>

            <h4 style="color: var(--highlight-color); margin: 25px 0 5px 0;">> HISTORIE: SHIRAZ SHIVJIS COST-CUT-HACK & DIE RETTUNG DES 'JACKINTOSH'</h4>
            <p>Als Jack Tramiel Commodore im Streit verließ und 1984 die Reste von Atari kaufte, beauftragte er seinen genialen Chefdesigner <strong>Shiraz Shivji</strong> (der zuvor am C64 mitgearbeitet hatte), in weniger als einem Jahr einen extrem günstigen Macintosh-Killer (den "Atari ST") zu entwerfen. Jedes Bauteil musste auf den Cent genau kalkuliert werden. Um den Preis für teure dedizierte I/O-Controller-Chips zu sparen, vollbrachte Shivji einen legendären Hacker-Trick: Er wählte den spottbilligen Yamaha YM2149 und <strong>missbrauchte dessen freie I/O-Ports als System-Rückgrat</strong>.</p>
            <p>Auf dem Atari ST steuert der Soundchip deshalb nicht nur Töne, sondern über seine physischen Pins (I/O Port A) direkt das Diskettenlaufwerk, den Druckerport, die RS-232-Schnittstelle und die Tastatur! Ein Ausfall des Soundchips führte somit zum sofortigen Stillstand des gesamten Computers.</p>

            <h4 style="color: var(--highlight-color); margin: 25px 0 5px 0;">> DER 32-STEP LOG-DAC SKANDAL</h4>
            <p>Während Konkurrenz-Chips (wie im ZX Spectrum) Lautstärken in simplen 16 Stufen linear auflösten, verbaute Yamaha im YM2149 einen <strong>echten 32-stufigen logarithmischen D/A-Wandler</strong>. Die Dämpfung beträgt exakt -1.5dB pro Stufe. <br>
            <strong>Hardware-Hacking:</strong> Die normalen Lautstärkeregister des Chips akzeptieren zwar nur 4-Bit Werte (0-15), aber die Hardware mappt diese intern auf die 5-Bit Struktur via <code>(Vol * 2) + 1</code>. Unser Core bildet diesen physikalischen Schaltplan bitgenau nach. Dadurch klingen die Drums fetter, und die berüchtigten Hardware-Envelopes nutzen die vollen 32 Sub-Stufen für butterweiche Volume-Sweeps ("Zipper-Noise").</p>

            <h3 style="color: var(--highlight-color); margin: 30px 0 15px 0;">[ CHIP-SPECS: EMULIERTE HARDWARE-KOMPONENTEN & SCENE-TRICKS ]</h3>
            <p>Der YM2149 besitzt keinerlei analoge Filter oder native PCM-Sample-Wandler. Um dem Chip dennoch komplexe Klänge zu entlocken, mussten die Musik-Magier der ST-Demoszene tief in die Trickkiste greifen. Unsere Synthese-Cores emulieren diese Hardware-Kniffe auf der 2-MHz-Ebene detailgetreu:</p>

            <h4 style="color: var(--highlight-color); margin: 20px 0 5px 0;">> SYNC-BUZZER & HIPPEL-ARPEGGIOS</h4>
            <p>Da der Chip nur simple Rechteckwellen ausspuckt, programmierten Coder wie Jochen Hippel hochfrequente CPU-Interrupts (Timer-B). Indem sie die Register hunderte Male pro Frame überschrieben, erzwangen sie Oszillator-Resets und mischten Rechteck mit Noise in aberwitzigen Geschwindigkeiten. Dadurch entstanden die berühmten rasselnden "ST-SID-Voices". Da unsere Engine mit <strong>2.000.000 Hz Lockstep</strong> läuft, schwingen diese Interrupt-Hacks phasenstarr und ohne digitales Artefakt-Zittern.</p>

            <h4 style="color: var(--highlight-color); margin: 20px 0 5px 0;">> ZERO ALIASING (SINC-FIR DECIMATION)</h4>
            <p>Rechteckwellen produzieren theoretisch unendlich hohe Obertöne. Wenn wir 2 MHz auf die 48 kHz der Soundkarte komprimieren, würde das ohne Schutz grauenhaft klirren (Aliasing). Unser Core jagt das rohe Signal deshalb in Echtzeit durch einen 255-Tap Polyphase Sinc-FIR Filter. Das wirkt wie eine analoge "Brickwall" bei 12.5 kHz – der Sound bleibt warm, druckvoll und kristallklar.</p>

            <h4 style="color: var(--highlight-color); margin: 20px 0 5px 0;">> YM6 SPEC: DIE DIGIDRUMS (DAC INJECTION)</h4>
            <p>Da der YM2149 keine D/A-Wandler für Samples besitzt, missbrauchten die Coder die 4-Bit-Lautstärkeregister. In unserem <em>Exact-Core</em> mischen wir Digidrums nicht einfach linear als Audio dazu. Wir injizieren die PCM-Samples "virtuell" in das Volume-Register der Oszillatoren. Dadurch werden sie durch die logarithmische 32-Step Yamaha-Tabelle gepresst, was ihnen den absolut rohen, verzerrten 4-Bit Atari-Crunch verleiht.</p>
        </div>
    `
};
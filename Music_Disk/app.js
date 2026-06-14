// Globale Variablen für unser Audio-System
let audioCtx;
let ymNode;
let paulaNode; 
let sidNode; // NEU: Der C64 Endgegner
let currentOscValue = 0; 
let activeSystem = 'atari'; // Merkt sich, welcher Chip gerade aktiv ist
let masterGain; // NEU: Der Master-Mischer

document.addEventListener("DOMContentLoaded", () => {
    const bootScreen = document.getElementById("boot-screen");
    const demoContainer = document.getElementById("demo-container");

    bootScreen.addEventListener("click", async () => {
        bootScreen.classList.add("hidden");
        demoContainer.classList.remove("hidden");
        
        console.log("Audio Engine Booting...");
        
        await initAudioEngine();
        initVisuals(); 
        initScroller(); 
        
        // BUGFIX: Initialisiere sofort das C64 Theme und lade den ersten Track!
        setTheme('theme-c64');
        selectAndPlayTrack(0, 'c64'); // Auto-Play startet!
    });
});

async function initAudioEngine() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try {
        await audioCtx.audioWorklet.addModule('ym-worklet.js');
        await audioCtx.audioWorklet.addModule('paula-worklet.js');
        await audioCtx.audioWorklet.addModule('sid-worklet.js'); // NEU
        
        ymNode = new AudioWorkletNode(audioCtx, 'ym-processor');
        paulaNode = new AudioWorkletNode(audioCtx, 'paula-processor');
        sidNode = new AudioWorkletNode(audioCtx, 'sid-processor'); // NEU
        
        const amigaFilter = audioCtx.createBiquadFilter();
        amigaFilter.type = 'lowpass';
        amigaFilter.frequency.value = 6000; 
        
        // --- MASTER VOLUME SETUP ---
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.5; // Startlautstärke (50%)
        masterGain.connect(audioCtx.destination);
        
        // Alle Chips gehen jetzt in den MasterGain statt direkt zum Ausgang!
        ymNode.connect(masterGain);
        paulaNode.connect(amigaFilter).connect(masterGain);
        sidNode.connect(masterGain);        
        const visualHandler = (e) => {
            if (e.data.type === 'VISUAL_DATA') currentOscValue = e.data.value;
        };
        ymNode.port.onmessage = visualHandler;
        paulaNode.port.onmessage = visualHandler;
        sidNode.port.onmessage = visualHandler; // NEU

        console.log("ALLE 3 SOUNDCHIPS SIND ONLINE! (YM, PAULA, SID)");
        uploadAmigaSamples();

    } catch (e) { console.error("AudioWorklet Fehler:", e); }
}

// --- SAMPLES INS PAULA-RAM LADEN ---
function uploadAmigaSamples() {
    AMIGA_SAMPLES.kick = createKickSample();
    AMIGA_SAMPLES.bass = createBassSample();
    AMIGA_SAMPLES.chord = createChordSample();
    
    // Wir senden die echten Sample-Daten VORAB in den Speicher des Worklets!
    if (paulaNode) {
        paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'kick', data: AMIGA_SAMPLES.kick });
        paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'bass', data: AMIGA_SAMPLES.bass });
        paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'chord', data: AMIGA_SAMPLES.chord });
    }
    console.log("Amiga Samples ins Paula-RAM hochgeladen!");
}

// --- DER NEUE HIGH-PRECISION PLAYER (Jetzt Browser-sicher!) ---
function startPlayback() {
    if (isPlaying || trackData.length === 0) return;
    
    // WICHTIG: Den AudioContext aufwecken, falls der Browser ihn 
    // aus Sicherheitsgründen ("Autoplay Policy") eingefroren hat!
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => console.log("AudioContext aufgeweckt!"));
    }

    isPlaying = true;
    
    let isAmiga = trackData[0] && trackData[0].isAmiga;
    let isC64 = trackData[0] && trackData[0].isC64;
    
    // Wir senden das GESAMTE Lied an den entsprechenden Chip.
    if (isAmiga) {
        paulaNode.port.postMessage({ type: 'PLAY_TRACK', track: trackData });
    } else if (isC64) {
        sidNode.port.postMessage({ type: 'PLAY_TRACK', track: trackData });
    } else {
        ymNode.port.postMessage({ type: 'PLAY_TRACK', track: trackData });
    }
}

function stopPlayback() {
    if (!isPlaying) return;
    isPlaying = false;
    
    // Allen Chips den Befehl geben, das Lied zu stoppen und sich stumm zu schalten
    if (ymNode) ymNode.port.postMessage({ type: 'STOP_TRACK' });
    if (paulaNode) paulaNode.port.postMessage({ type: 'STOP_TRACK' });
    if (sidNode) sidNode.port.postMessage({ type: 'STOP_TRACK' });
}

// --- DER PROOF OF CONCEPT BEEP (C-Dur Akkord) ---
function playProofOfConceptBeep() {
    // Die Mathematik des Atari ST: 
    // Takt = 2.000.000 Hz. Formel: Periode = 125000 / Wunschfrequenz
    
    // Kanal A: Note C4 (261.63 Hz) -> Periode 478 (Hex: 0x01DE)
    writeYMReg(0, 0xDE); // Fine Tune A
    writeYMReg(1, 0x01); // Coarse Tune A
    
    // Kanal B: Note E4 (329.63 Hz) -> Periode 379 (Hex: 0x017B)
    writeYMReg(2, 0x7B); // Fine Tune B
    writeYMReg(3, 0x01); // Coarse Tune B
    
    // Kanal C: Note G4 (392.00 Hz) -> Periode 319 (Hex: 0x013F)
    writeYMReg(4, 0x3F); // Fine Tune C
    writeYMReg(5, 0x01); // Coarse Tune C

    // Mixer (Reg 7): Schalte Töne auf A, B, C ein (0 = an, 1 = aus). 
    // Rauschen (Bits 3-5) aus (1), Ton (Bits 0-2) an (0). Ergibt Binär: 11111000 = 0xF8
    writeYMReg(7, 0xF8);

    // Lautstärke: Setze A, B, C auf Level 10 von 15 (0x0A)
    writeYMReg(8, 0x0A);
    writeYMReg(9, 0x0A);
    writeYMReg(10, 0x0A);

    // Mache den Ton nach 2 Sekunden wieder aus, sonst platzt uns der Kopf!
    setTimeout(() => {
        writeYMReg(8, 0x00);
        writeYMReg(9, 0x00);
        writeYMReg(10, 0x00);
        console.log("Beep beendet.");
    }, 2000);
}


// --- BUGFIX: Sicheres Umschalten der Themes ---
function setTheme(themeName) {
    document.body.className = themeName;
    
    // Die Tabs visuell umschalten (Ohne das veraltete 'event.target')
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.classList.remove('active');
        // Wir prüfen, ob der Button-Code den Namen unseres Themes enthält
        if (tab.getAttribute('onclick').includes(themeName)) {
            tab.classList.add('active');
        }
    });

    // Das aktive System global merken
    activeSystem = themeName === 'theme-atari' ? 'atari' : 
                   themeName === 'theme-amiga' ? 'amiga' : 'c64';

    // Die korrekte Liste in das UI rendern
    renderTracklist(activeSystem);
    
    // Beim Umschalten des Systems das alte Playback stoppen
    stopPlayback(); 
}

// --- ZONE 1: HIGH-PERFORMANCE OSZILLOSKOP & RASTERBARS ---
function initVisuals() {
    const canvas = document.getElementById('demo-canvas');
    // alpha: false signalisiert dem Browser, dass der Canvas-Hintergrund deckend ist (Hardware-Boost!)
    const ctx = canvas.getContext('2d', { alpha: false }); 
    
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const historyLength = canvas.width; 
    
    // FIX 1: Float32Array statt normalem Array (Perfektes Speichermanagement)
    const oscHistory = new Float32Array(historyLength);
    let oscIndex = 0; // Der Ringpuffer-Zeiger

    let startTime = performance.now();

    function drawCopperBar(yCenter, thickness, color1, color2) {
        let grad = ctx.createLinearGradient(0, yCenter - thickness, 0, yCenter + thickness);
        grad.addColorStop(0, `rgba(0,0,0,0)`);
        grad.addColorStop(0.2, color1);
        grad.addColorStop(0.5, `rgba(255,255,255, 1)`); 
        grad.addColorStop(0.8, color2);
        grad.addColorStop(1, `rgba(0,0,0,0)`);
        
        ctx.fillStyle = grad;
        ctx.fillRect(0, yCenter - thickness, canvas.width, thickness * 2);
    }

    function draw() {
        let now = performance.now();
        let t = (now - startTime) * 0.001; 

        // Hintergrund
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        let audioPunch = Math.abs(currentOscValue) * 40; 
        
        const isAmiga = document.body.classList.contains('theme-amiga');
        const isAtari = document.body.classList.contains('theme-atari');
        
        let pal1 = isAtari ? ['#005500', '#00aa00'] : isAmiga ? ['#0000aa', '#0055ff'] : ['#352879', '#6c5eb5'];
        let pal2 = isAtari ? ['#555500', '#aaaa00'] : isAmiga ? ['#aa5500', '#ff8800'] : ['#aa0055', '#ff00aa'];
        let pal3 = isAtari ? ['#005555', '#00aaaa'] : isAmiga ? ['#5500aa', '#aa00ff'] : ['#555555', '#aaaaaa'];

        ctx.globalCompositeOperation = "screen"; 
        
        let y1 = (canvas.height / 2) + Math.sin(t * 1.2) * (canvas.height * 0.3);
        drawCopperBar(y1, 25 + audioPunch, pal1[0], pal1[1]);

        let y2 = (canvas.height / 2) + Math.sin(t * 1.8 + 2.0) * (canvas.height * 0.35);
        drawCopperBar(y2, 20 + (audioPunch * 0.8), pal2[0], pal2[1]);

        let y3 = (canvas.height / 2) + Math.sin(t * 1.5 + 4.0) * (canvas.height * 0.25);
        drawCopperBar(y3, 15 + (audioPunch * 0.5), pal3[0], pal3[1]);

        ctx.globalCompositeOperation = "source-over";

        const lineColor = isAtari ? '#55ff55' : isAmiga ? '#ff8800' : '#6c5eb5';
        
        // FIX 2: Ringpuffer füllen (Kein Array.shift() mehr!)
        oscHistory[oscIndex] = currentOscValue;
        oscIndex = (oscIndex + 1) % historyLength; // Zeiger wandert im Kreis

        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        
        // Ringpuffer zeichnen (Vom ältesten bis zum neuesten Wert iterieren)
        for (let x = 0; x < historyLength; x++) {
            // Reale Position im Puffer berechnen
            let actualIndex = (oscIndex + x) % historyLength; 
            let val = oscHistory[actualIndex];
            let y = (canvas.height / 2) - (val * (canvas.height * 0.4)); 
            
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        
        // FIX 3: Fake Glow statt GPU-fressendem shadowBlur
        ctx.lineWidth = 6;
        ctx.globalAlpha = 0.3; // Äußere weiche Kante
        ctx.stroke();

        ctx.lineWidth = 2;
        ctx.globalAlpha = 1.0; // Innerer harter Kern
        ctx.stroke();

        requestAnimationFrame(draw);
    }
    
    draw();
}

// Globale Variable, damit wir den Text von außen updaten können
let currentScrollerText = "+++ INITIALIZING DEMO ENGINE... +++";

// --- ZONE 4: DER SINUS-SCROLLER ---
function initScroller() {
    const canvas = document.getElementById('scroller-canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    
    let offset = 0;          
    const speed = 2.5; // Etwas zackiger!         
    const frequency = 0.015; 
    const amplitude = canvas.height / 3; 
    
    // Die Basis-Nachricht (Der "Swagger" - ohne echte Gruppen, fokussiert auf den Spirit)
    const baseGreets = " +++ AT LAST, THE ULTIMATE HTML5 MUSIC DISK IS COMPLETE +++ CODE & DSP MAGIK RUNNING AT A SOLID 50 HZ VBLANK +++ DEEP CHIP EMULATION VIA AUDIOWORKLETS +++ NO MP3, NO BULLSHIT, JUST PURE MATHEMATICS +++ GREETS FLY OUT TO ALL THE PIXEL PUSHERS, CYCLE CRUNCHERS AND WAVEFORM WIZARDS OUT THERE +++ TO EVERYONE WHO STILL KEEPS THE SPIRIT OF THE 8-BIT AND 16-BIT ERA ALIVE +++ TO THE TRUE LOVERS OF DEMOSCENE ART AND CHIPTUNE MAGIC +++ LET THE ANALOG FILTERS BURN +++ WRAP AROUND +++ ";  
    
    function draw() {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const isAmiga = document.body.classList.contains('theme-amiga');
        const isAtari = document.body.classList.contains('theme-atari');
        
        ctx.fillStyle = isAtari ? '#55ff55' : isAmiga ? '#ff8800' : '#6c5eb5';
        ctx.font = isAmiga || isAtari ? "24px 'VT323', monospace" : "16px 'Press Start 2P', monospace";
        ctx.textBaseline = "middle";
        
        const charWidth = ctx.measureText("A").width;
        
        // Dynamisch den vollen Text zusammenbauen
        let fullText = currentScrollerText + baseGreets;
        const totalTextWidth = charWidth * fullText.length;
        
        let startX = canvas.width - offset;
        
        for (let i = 0; i < fullText.length; i++) {
            let char = fullText[i];
            let x = startX + (i * charWidth);
            if (x > -50 && x < canvas.width + 50) {
                let y = (canvas.height / 2) + Math.sin((x * frequency) + (offset * 0.05)) * amplitude;
                ctx.fillText(char, x, y);
            }
        }
        
        offset += speed;
        if (offset > totalTextWidth + canvas.width) offset = 0;
        
        requestAnimationFrame(draw);
    }
    draw();
}

// ==========================================
// PLAYLIST & SPIELDATEN-LOGIK (50 Hz PLAYER)
// ==========================================

// --- DAS TIEFE TECHNIK-MUSEUM & TRACK REGISTRY ---
const trackRegistry = {
    c64: [
        { 
            title: "1. Rob Hubbard - Commando (Style)", 
            generator: generateHubbardStyleTrack, 
            composerInfo: `
                <h3>MOS Technology 6581 (SID)</h3>
                <p>Der Sound Interface Device (SID), 1981 von Bob Yannes entworfen, ist eine absolute Ausnahmeerscheinung in der Welt der Homecomputer. Während andere Chips nur starre Töne abspielten, ist der SID ein echter, subtraktiver Analogsynthesizer in einem einzigen Silizium-Chip.</p>
                <p><strong>Tech-Deep-Dive:</strong><br>
                Der Chip besitzt 3 Oszillatoren mit Dreieck, Sägezahn, Rechteck und Noise. Das Geheimnis des fetten Sounds ist die <em>Pulsweitenmodulation (PWM)</em>. Durch dynamisches Verändern der Rechteckbreite entsteht ein "wabernder", schwebender Klang. Das Herzstück ist jedoch das analoge Multimode-Filter. Da die Filterkondensatoren analog waren, klang der 6581 in jedem C64 minimal anders, abhängig von Raumtemperatur und Fertigungstoleranz!</p>
                <hr style="border:1px dashed var(--text-color); margin: 10px 0;">
                <h3>Composer: Rob Hubbard</h3>
                <p>Der britische Komponist Rob Hubbard ist der unangefochtene Rockgott des C64. Er ignorierte die von Commodore gelieferten Sound-Routinen und schrieb eigene, pfeilschnelle Maschinencode-Treiber. Er quetschte aus den 3 Stimmen ganze Rock-Bands heraus, inklusive virtuosem Einsatz von Hard-Sync und Ringmodulation.</p>
            ` 
        }
    ],
    atari: [
        { 
            title: "1. Jochen Hippel - Wings of Death (Style)", 
            generator: generateHippelStyleTrack, 
            composerInfo: `
                <h3>Yamaha YM2149 (Atari ST)</h3>
                <p>Der YM2149 (ein Klon des General Instrument AY-3-8910) ist ein rudimentärer Programmable Sound Generator (PSG). Er besitzt 3 reine Rechteckwellen-Kanäle und einen Noise-Generator (LFSR).</p>
                <p><strong>Tech-Deep-Dive:</strong><br>
                Auf dem Papier war der Chip dem C64 oder Amiga gnadenlos unterlegen. Es gab keine analogen Filter und keine Pulsweitenmodulation. Demoscene-Coder fanden jedoch einen Hack: Sie nutzten die CPU-Timer-Interrupts (Timer A/B/C) des Motorola 68000 Prozessors. Indem sie hunderte Male pro Sekunde die Lautstärkeregister des YM-Chips manuell via CPU veränderten, simulierten sie komplexe Hüllkurven und sogar digitale Samples. Die sogenannte <em>"SID-Voice" (Sync-Buzzer)</em> zwang die Rechteckwelle durch rohe CPU-Gewalt dazu, wie der C64 zu klingen.</p>
                <hr style="border:1px dashed var(--text-color); margin: 10px 0;">
                <h3>Composer: Jochen Hippel (Mad Max)</h3>
                <p>Als Mitglied der Gruppe 'The Carebears' dominierte Hippel die Atari-Szene. Er war einer der wenigen, die den starren Atari-Chip durch brutale Interrupt-Programmierung zum "Singen" und "Wabern" brachten.</p>
            ` 
        },
        { 
            title: "2. Big Alec - Syntax Terror (Style)", 
            generator: generateBigAlecStyleTrack, 
            composerInfo: `
                <h3>Der Sound der Megademos</h3>
                <p>Während viele versuchten, den YM2149 sanft klingen zu lassen, umarmte Big Alec (Delta Force) den rohen, aggressiven Charakter der Chiptune-Rechteckwellen. Seine treibenden Basslines nutzen rasend schnelle Oktavsprünge, die sofort ins Ohr gehen.</p>
                <p>Besonders brillant war seine Nutzung des 5-Bit-Rauschgenerators (Noise). Durch exaktes Umschalten der Noise-Frequenzen schuf er knackige Snare-Drums und feine Hi-Hats, die den typischen Vorwärtsdrang der Atari-Demos (wie der "Syntax Terror") ausmachten.</p>
            ` 
        }
    ],
    amiga: [
        { 
            title: "1. Jester (Sanity) - Elysium (Style)", 
            generator: generateJesterStyleTrack, 
            composerInfo: `
                <h3>MOS Paula 8364 (Amiga)</h3>
                <p>1985 veränderte der Commodore Amiga alles. Anstatt Töne zu synthetisieren, war der Paula-Chip ein reiner PCM-Sample-Player mit DMA (Direct Memory Access). Er griff völlig autark auf den Arbeitsspeicher zu und spielte echte, digitalisierte Klänge ab.</p>
                <p><strong>Tech-Deep-Dive:</strong><br>
                Paula hat 4 Kanäle mit 8-Bit Auflösung. Auffällig war das extreme Hard-Panning: Kanal 1 & 4 lagen zu 100% auf dem linken Lautsprecher, Kanal 2 & 3 zu 100% auf dem rechten. Die Abspielrate war nicht fix (wie bei heutigen MP3s), sondern direkt an den Video-Takt (ca. 3.5 MHz) gekoppelt. Ein interessantes Hardware-Feature war der LED-Filter: Ein analoges Tiefpassfilter bei ca. 3.3 kHz, das oft physisch an die rote "Power-LED" des Amigas gekoppelt war (LED hell = Filter aus, LED gedimmt = Filter an)!</p>
                <hr style="border:1px dashed var(--text-color); margin: 10px 0;">
                <h3>Composer: Jester (Volker Tripp)</h3>
                <p>Jester von der Demogroup 'Sanity' war ein absoluter Meister des 4-Kanal MOD-Formats. Seine Tracks, wie in der legendären "Arte" Demo, überzeugten durch extrem saubere, perkussive Samples und funkige Grooves, die das starke Stereo-Panning des Amigas virtuos ausnutzten.</p>
            ` 
        }
    ]
};

// ==========================================
// TRACK GENERATOR 4: C64 SID "Hubbard" Style
// ==========================================
function generateHubbardStyleTrack() {
    let data = [];
    let frames = 400; // 8 Sekunden Loop bei 50Hz
    
    // Hilfsfunktion: Note zu SID-Frequenz
    // C-2 = 130.81Hz -> SID Freq = Hz * 16777216 / 985248
    const fC2 = 2227, fDs2 = 2649, fG2 = 3337; 
    const fC3 = 4454, fDs3 = 5298, fF3 = 5947, fG3 = 6675;

    for (let i = 0; i < frames; i++) {

        let frame = { isC64: true, regs: new Uint8Array(29) };
        
        // --- FILTER SETUP (Register 21-24) ---
        // Hubbard liebte wabernde Lowpass-Filter. Wir sweepen den Cutoff hoch und runter.
        let cutoff = 50 + Math.floor(Math.sin(i * 0.05) * 40); 
        frame.regs[21] = cutoff & 7; // Cutoff Lo
        frame.regs[22] = cutoff >> 3; // Cutoff Hi
        // Resonanz mittel (Bit 4-7) und Voice 1+2 ins Filter schicken (Bit 0-1)
        frame.regs[23] = (8 << 4) | 3; 
        // Volume max (15), Mode: Lowpass (Bit 4 = 16)
        frame.regs[24] = 16 | 15; 

        // --- KANAL 1: DER WABERNDE PWM-BASS ---
        let bassNote = (Math.floor(i / 20) % 2 === 0) ? fC2 : fDs2;
        frame.regs[0] = bassNote & 0xFF; // Freq Lo
        frame.regs[1] = (bassNote >> 8) & 0xFF; // Freq Hi
        
        // PWM (Pulse Width) LFO: Das Geheimnis des fetten C64 Sounds!
        let pw = 2048 + Math.floor(Math.sin(i * 0.1) * 1500);
        frame.regs[2] = pw & 0xFF;
        frame.regs[3] = (pw >> 8) & 0x0F;
        
        // Control Reg: Pulse (64) + Gate an (1) -> 65 (0x41)
        // Um einen harten Attack zu triggern, schalten wir Gate bei jedem 10. Frame kurz ab.
        frame.regs[4] = (i % 10 === 9) ? 64 : 65; 

        // --- KANAL 2: DIE LEAD MELODIE (Sawtooth) ---
        let leadNotes = [fC3, fC3, fDs3, fG3, fF3, fDs3];
        let leadNote = leadNotes[Math.floor(i / 15) % leadNotes.length];
        frame.regs[7] = leadNote & 0xFF;
        frame.regs[8] = (leadNote >> 8) & 0xFF;
        frame.regs[11] = (i % 15 === 14) ? 32 : 33; // Sawtooth (32) + Gate (1)

        // --- KANAL 3: DRUMS (Noise) ---
        // Hubbard machte Drums durch extrem kurze Noise-Bursts
        if (i % 20 === 0) { // Kick
            frame.regs[14] = 0; frame.regs[15] = 10; // Tiefe Frequenz
            frame.regs[18] = 129; // Noise (128) + Gate (1)
        } else if ((i + 10) % 20 === 0) { // Snare
            frame.regs[14] = 0; frame.regs[15] = 40; // Hohe Frequenz
            frame.regs[18] = 129; // Noise + Gate
        } else {
            frame.regs[18] = 128; // Gate aus
        }

        data.push(frame);
    }
    return data;
}

let trackData = [];    
let currentFrame = 0;  
let isPlaying = false; 
let currentTrackIndex = 0;

// Render-Funktion für die Trackliste
function renderTracklist(system) {
    const listElement = document.getElementById('tracklist');
    listElement.innerHTML = ''; // Liste leeren
    
    // Aktuelle Songs für das System laden
    const songs = trackRegistry[system];
    
    if (!songs) {
        listElement.innerHTML = '<li>[ NO DISK INSERTED ]</li>';
        return;
    }

    songs.forEach((song, index) => {
        const li = document.createElement('li');
        li.textContent = song.title;
        if (index === currentTrackIndex) li.classList.add('active-track');
        
        // Klick-Event für das Wechseln des Songs
        li.addEventListener('click', () => {
            selectAndPlayTrack(index, system);
        });
        listElement.appendChild(li);
    });
}

// Lade und spiele einen bestimmten Track
function selectAndPlayTrack(index, system) {
    const songs = trackRegistry[system];
    if (!songs || !songs[index]) return;

    // Vorheriges Playback stoppen
    stopPlayback();
    
    currentTrackIndex = index;
    const selectedSong = songs[index];
    
    // Daten generieren/laden
    trackData = selectedSong.generator();
    currentFrame = 0;

    // Update den Scroller!
    currentScrollerText = "+++ NOW PLAYING: " + selectedSong.title + " +++";
   
    // UI updaten
    renderTracklist(system); 

    // UI updaten mit dem neuen tiefgreifenden Museumstext
    document.getElementById('info-text').innerHTML = `
        <div style="margin-bottom: 20px;">
            <h2 style="color: var(--highlight-color);">> NOW PLAYING:</h2>
            <p style="font-size: 1.2em; border-bottom: 1px solid currentColor; padding-bottom: 5px;">${selectedSong.title}</p>
        </div>
        ${selectedSong.composerInfo}
        <p class="blinking-cursor" style="margin-top: 15px;">_</p>
    `;    
    // Direkt abspielen
    startPlayback();
}

// --- BUTTONS BINDEN ---
document.getElementById('btn-play').addEventListener('click', () => {
    if (isPlaying) {
        stopPlayback();
    } else {
        // Falls noch nichts ausgewählt ist, nimm den ersten Track des aktuellen Systems
        if (trackData.length === 0) {
            selectAndPlayTrack(0, activeSystem); 
        } else {
            startPlayback();
        }
    }
});

document.getElementById('btn-next').addEventListener('click', () => {
    let nextIdx = (currentTrackIndex + 1) % trackRegistry[activeSystem].length;
    selectAndPlayTrack(nextIdx, activeSystem);
});

document.getElementById('btn-prev').addEventListener('click', () => {
    let prevIdx = currentTrackIndex - 1;
    if (prevIdx < 0) prevIdx = trackRegistry[activeSystem].length - 1;
    selectAndPlayTrack(prevIdx, activeSystem);
});

// Lautstärke ändern
document.getElementById('volume-slider').addEventListener('input', (e) => {
    if (masterGain) {
        masterGain.gain.value = e.target.value;
    }
});

// ==========================================
// TRACK GENERATOR: "The Hippel Arpeggio"
// ==========================================
// Baut ein Array von Frames (14 Register pro Frame) für 4 Sekunden (200 Frames)
function generateHippelStyleTrack() {
    let data = [];
    let frames = 200; // 200 Frames bei 50Hz = 4 Sekunden Loop
    
    // Noten-Perioden für Atari (2 MHz Takt)
    // Akkordfolge: C-Moll -> Dis-Dur
    const arpCMinor = [478, 401, 318]; // C4, D#4, G4
    const arpDSharp = [401, 318, 253]; // D#4, G4, A#4
    const bassC = [955]; // C3
    const bassDSharp = [803]; // D#3

    for (let i = 0; i < frames; i++) {
        let frame = new Uint8Array(14);
        
        // --- MIXER REGISTER (Reg 7) ---
        // Wir aktivieren Töne auf A (Bass) und B (Arp), Rauschen auf C (Drums)
        // Bit 0=A-Ton, 1=B-Ton, 2=C-Ton (0=an). Bit 3,4,5 = Rauschen (0=an).
        // Binär: 1101 1100 = 0xDC (C-Noise an, C-Ton aus, B-Ton an, A-Ton an)
        frame[7] = 0xDC;
        
        // --- RHYTHMUS & TAKT ---
        let beat = Math.floor(i / 12) % 4; // 12 Frames pro Beat
        let bar = Math.floor(i / 100);     // 100 Frames pro Takt
        
        // --- KANAL A: BASSLINE ---
        let currentBass = bar === 0 ? bassC[0] : bassDSharp[0];
        frame[0] = currentBass & 0xFF;        // Fine Tune
        frame[1] = (currentBass >> 8) & 0x0F; // Coarse Tune
        
        // Bass-Hüllkurve (Lautstärke nimmt ab)
        let bassVol = 15 - (i % 12); 
        if (bassVol < 0) bassVol = 0;
        frame[8] = bassVol; // Reg 8 = Vol A
        
        // --- KANAL B: DER DEMOSCENE ARPEGGIATOR ---
        // Das Arpeggio wechselt JEDEN Frame die Note! (Das typische Atari-Flimmern)
        let currentArpChord = bar === 0 ? arpCMinor : arpDSharp;
        let arpNote = currentArpChord[i % 3];
        
        frame[2] = arpNote & 0xFF;
        frame[3] = (arpNote >> 8) & 0x0F;
        frame[9] = 10; // Vol B immer auf 10 (konstant)
        
        // --- KANAL C: DRUMS (NOISE) ---
        // Rauschfrequenz (Reg 6)
        frame[6] = 15; 
        
        // Drum-Pattern (Hi-Hat auf jedem Offbeat, Kick auf dem Beat)
        let drumVol = 0;
        if (i % 24 === 0) drumVol = 15; // Fette Kick
        else if (i % 12 === 0) drumVol = 8; // Leichte Snare/Hihat
        
        frame[10] = drumVol; // Reg 10 = Vol C
        
        data.push(frame);
    }
    
    return data;
}

// ==========================================
// TRACK GENERATOR 2: "The Big Alec Drive"
// ==========================================
// Baut ein Array von Frames für einen treibenden Chiptune im Stil von Delta Force
function generateBigAlecStyleTrack() {
    let data = [];
    let frames = 320; // 320 Frames = ca. 6.4 Sekunden (etwas längerer Loop)
    
    // Perioden für eine treibende E-Moll Melodie (Atari 2 MHz Takt)
    const e2 = 1432, e3 = 716, g3 = 601, a3 = 536, b3 = 477;
    const melody = [e3, g3, a3, b3, e3, b3, a3, g3];

    for (let i = 0; i < frames; i++) {
        let frame = new Uint8Array(14);
        
        let beat16th = Math.floor(i / 5) % 16; // Schnelle 16tel Noten (alle 5 Frames)
        
        // --- KANAL A: TREIBENDER OKTAV-BASS ---
        // Spielt E2 auf dem Beat, E3 auf dem Offbeat (klassischer Euro-Chiptune Bass)
        let isOffbeat = (i % 10) >= 5;
        let bassNote = isOffbeat ? e3 : e2;
        frame[0] = bassNote & 0xFF;
        frame[1] = (bassNote >> 8) & 0x0F;
        
        // Knackige Bass-Hüllkurve
        let bassVol = 15 - (i % 5) * 2; 
        if (bassVol < 0) bassVol = 0;
        frame[8] = bassVol;
        
        // --- KANAL B: DIE LEAD-MELODIE ---
        let leadNote = melody[Math.floor(i / 10) % melody.length];
        frame[2] = leadNote & 0xFF;
        frame[3] = (leadNote >> 8) & 0x0F;
        
        // Melodie-Lautstärke (etwas Echo/Delay simulieren)
        let leadVol = 12 - (i % 10);
        if (leadVol < 0) leadVol = 0;
        frame[9] = leadVol;
        
        // --- KANAL C: NOISE DRUMS ---
        // Big Alec nutzte viel hochfrequentes Rauschen für Snare & HiHat
        let drumVol = 0;
        let noisePitch = 0;
        let mixer = 0xFC; // Default: A-Ton, B-Ton an (1111 1100)
        
        if (i % 20 === 0) {
            // Kick Drum (Tiefer Ton + etwas Rauschen)
            drumVol = 15; noisePitch = 15; mixer = 0xF4; // C-Ton an, C-Noise an
            frame[4] = 200; frame[5] = 2; // Tiefer Paukenschlag
        } else if ((i + 10) % 20 === 0) {
            // Snare (Helles, lautes Rauschen)
            drumVol = 15; noisePitch = 6; mixer = 0xDC; // Nur C-Noise
        } else if (i % 5 === 0) {
            // HiHat (Sehr hell, leise)
            drumVol = 6; noisePitch = 2; mixer = 0xDC; // Nur C-Noise
        }
        
        frame[6] = noisePitch;
        frame[10] = drumVol;
        frame[7] = mixer;
        
        data.push(frame);
    }
    
    return data;
}
// ==========================================
// AMIGA PAULA INSTRUMENTE & HELFER
// ==========================================

const AMIGA_SAMPLES = {};

// ==========================================
// AMIGA PAULA INSTRUMENTE & HELFER (KORRIGIERT)
// ==========================================

// Erschafft eine Kickdrum, geeicht auf Amiga 8.3kHz (Note C-3)
function createKickSample() {
    let len = 4000;
    let data = new Float32Array(len);
    let phase = 0;
    for(let i=0; i<len; i++) {
        let freq = 150 * Math.exp(-i / 800); // Frequenz fällt rasant ab
        phase += (freq * Math.PI * 2) / 8287; // Auf Amiga-Geschwindigkeit abgestimmt!
        data[i] = Math.sin(phase) * Math.exp(-i / 1000); 
    }
    return data;
}

// Erschafft einen echten ProTracker-Bass! (Exakt 64 Samples lang)
function createBassSample() {
    let len = 64; // Historisch korrekte Länge
    let data = new Float32Array(len);
    for(let i=0; i<len; i++) {
        // Ein sauberes Sägezahn-Signal (Sawtooth)
        data[i] = 2.0 * (i / len) - 1.0; 
    }
    return data;
}

// Erschafft einen Rave-Akkord, abgestimmt auf Amiga 8.3kHz
function createChordSample() {
    let len = 8000;
    let data = new Float32Array(len);
    let w = (261.63 * Math.PI * 2) / 8287; // Basis-Pitch (C4)
    for(let i=0; i<len; i++) {
        let p1 = Math.sin(i * w); 
        let p2 = Math.sin(i * w * 1.189); // Kleine Terz
        let p3 = Math.sin(i * w * 1.498); // Quinte
        data[i] = ((p1 + p2 + p3) / 3.0) * Math.exp(-i / 3000);
    }
    return data;
}



// ==========================================
// TRACK GENERATOR 3: Amiga "ProTracker" Style
// ==========================================
// ==========================================
// TRACK GENERATOR 3: Amiga "ProTracker" Style
// ==========================================
function generateJesterStyleTrack() {
    let data = [];
    let frames = 400; // 400 Frames = 8 Sekunden bei 50Hz
    
    // ProTracker Perioden (C-2 = 856, C-3 = 428)
    // Variablen-Namen korrigiert: 's' statt '#' (Ds = D-Sharp)
    const pC3 = 428, pDs3 = 360, pG3 = 285, pAs3 = 240;
    const pC2 = 856, pDs2 = 720;

    for (let i = 0; i < frames; i++) {
        let frameData = { isAmiga: true, cmds: [] };
        
        // --- KANAL 0 (Links): Kick Drum ---
        if (i % 20 === 0) {
            frameData.cmds.push({ ch: 0, smp: 'kick', per: pC3, vol: 64 });
        }
        
        // --- KANAL 1 (Rechts): Synth Bass ---
        let isOffbeat = (i % 10) >= 5;
        let bassNote = isOffbeat ? pDs2 : pC2;
        
        if (i % 5 === 0) {
            // Trigger den Bass neu
            frameData.cmds.push({ ch: 1, smp: 'bass', per: bassNote, vol: 40 });
        } else {
            // Volume Fadeout für den Tracker-Vibe
            let vol = 40 - (i % 5) * 8;
            frameData.cmds.push({ ch: 1, smp: null, per: bassNote, vol: Math.max(vol, 0) });
        }

        // --- KANAL 2 (Rechts): Jester's Rave Chords ---
        if (i % 80 === 40) {
            // Stab auf dem 3. Beat
            frameData.cmds.push({ ch: 2, smp: 'chord', per: pC3, vol: 48 });
        } else if (i % 80 === 70) {
            // Ghost Note Stab
            frameData.cmds.push({ ch: 2, smp: 'chord', per: pDs3, vol: 24 });
        }

        // --- KANAL 3 (Links): Lead Arpeggio ---
        let leadNotes = [pC3, pDs3, pG3, pAs3];
        if (i % 4 === 0) { // Sehr schnelles Amiga-Arpeggio
            let note = leadNotes[(i / 4) % leadNotes.length];
            frameData.cmds.push({ ch: 3, smp: 'bass', per: note, vol: 20 });
        }
        
        data.push(frameData);
    }
    return data;
}
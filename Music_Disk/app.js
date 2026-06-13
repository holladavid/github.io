// Globale Variablen für unser Audio-System
let audioCtx;
let ymNode;
let currentOscValue = 0; // Speichert den aktuellen Lautstärke-Wert für das Oszilloskop

document.addEventListener("DOMContentLoaded", () => {
    const bootScreen = document.getElementById("boot-screen");
    const demoContainer = document.getElementById("demo-container");

    // 1. Klick auf den Startbildschirm (User-Interaktion erlaubt Audio!)
    bootScreen.addEventListener("click", async () => {
        bootScreen.classList.add("hidden");
        demoContainer.classList.remove("hidden");
        
        console.log("Audio Engine Booting...");
        
        // Audio API und Visualisierungen starten
        
        await initAudioEngine();
        initVisuals(); 
        initScroller(); 
    });
});

// --- DIE AUDIO ENGINE ---
async function initAudioEngine() {
    // Neuen Audio-Kontext erstellen (die "Soundkarte" des Browsers)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    try {
        // Das Worklet-Skript in den Audio-Thread laden
        await audioCtx.audioWorklet.addModule('ym-worklet.js');
        
        // Eine Instanz unseres YM2149-Chips erstellen
        ymNode = new AudioWorkletNode(audioCtx, 'ym-processor');
        
        // Den Chip mit den Lautsprechern verbinden
        ymNode.connect(audioCtx.destination);
        
        // Dem Chip lauschen (Daten für das Oszilloskop empfangen)
        ymNode.port.onmessage = (event) => {
            if (event.data.type === 'VISUAL_DATA') {
                currentOscValue = event.data.value; // Wert zwischen -1.0 und +1.0
            }
        };

        console.log("YM2149 Chip ist online! Spiele Test-Akkord...");
        startPlayback();

    } catch (e) {
        console.error("Fehler beim Laden des AudioWorklets:", e);
        alert("AudioWorklet konnte nicht geladen werden. Nutzt du einen lokalen Webserver?");
    }
}

// Hilfsfunktion: Schreibt einen Wert in ein YM-Register
function writeYMReg(reg, val) {
    if(ymNode) {
        ymNode.port.postMessage({ type: 'WRITE_REG', reg: reg, val: val });
    }
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

function setTheme(themeName) {
    document.body.className = themeName;
    
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');

    // Dynamisch die richtige Tracklist laden
    if (themeName === 'theme-atari') {
        renderTracklist('atari');
    } else {
        // Platzhalter für Amiga / C64, bis wir deren AudioWorklets gebaut haben
        document.getElementById('tracklist').innerHTML = '<li>[ INSERT SYSTEM DISK ]</li>';
        stopPlayback();
    }
}

// --- ZONE 1: DAS ECHTZEIT-OSZILLOSKOP ---
function initVisuals() {
    const canvas = document.getElementById('demo-canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    // Ein Array, um die alten Werte für eine Linie zu speichern
    const historyLength = canvas.width; 
    const oscHistory = new Array(historyLength).fill(0);

    function draw() {
        // 1. Hintergrund leicht transparent übermalen für "Motion Blur" Effekt
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 2. Themen-Farbe auslesen
        const isAmiga = document.body.classList.contains('theme-amiga');
        const isAtari = document.body.classList.contains('theme-atari');
        const lineColor = isAtari ? '#55ff55' : isAmiga ? '#ff8800' : '#6c5eb5';
        
        // 3. Neuen Wert ins Array schieben (und ältesten entfernen)
        oscHistory.push(currentOscValue);
        oscHistory.shift();

        // 4. Die Oszilloskop-Linie zeichnen
        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 3;
        
        for (let x = 0; x < historyLength; x++) {
            // currentOscValue ist zwischen -1.0 und 1.0. Wir skalieren es auf die Canvas-Höhe.
            let val = oscHistory[x];
            // Y-Mitte plus Ausschlag (Amplituden-Verstärkung * 50)
            let y = (canvas.height / 2) - (val * (canvas.height * 0.4)); 
            
            if (x === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        requestAnimationFrame(draw);
    }
    draw();
}

// --- ZONE 4: DER SINUS-SCROLLER ---
function initScroller() {
    const canvas = document.getElementById('scroller-canvas');
    const ctx = canvas.getContext('2d');
    
    // Canvas-Auflösung an die echte Pixelgröße des Divs anpassen
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    
    // Der klassische Demoscene-Lauftext
    const scrollText = "+++ WELCOME TO THE ULTIMATE RETRO MUSIC DISK +++ CODED IN PURE HTML5 AND JAVASCRIPT +++ PRESENTING THE BEST TUNES FROM MOS SID, PAULA AND YM2149 +++ GREETINGS TO ALL DEMOSCENE LOVERS +++ LET THE CHIPS BURN +++ ";
    
    let offset = 0;          // Bewegt den Text nach links
    const speed = 2;         // Scroll-Geschwindigkeit (Pixel pro Frame)
    const frequency = 0.015; // Wie eng die Sinus-Wellen zusammenliegen
    const amplitude = canvas.height / 3; // Wie hoch der Text ausschlägt
    
    function draw() {
        // 1. Hintergrund für diesen Frame schwarz malen (löschen)
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 2. Aktuelles Theme auslesen für Farbe & Font
        const isAmiga = document.body.classList.contains('theme-amiga');
        const isAtari = document.body.classList.contains('theme-atari');
        
        // Farbe und Font dynamisch anpassen
        ctx.fillStyle = isAtari ? '#55ff55' : isAmiga ? '#ff8800' : '#6c5eb5';
        ctx.font = isAmiga || isAtari ? "24px 'VT323', monospace" : "16px 'Press Start 2P', monospace";
        ctx.textBaseline = "middle";
        
        // 3. Breite eines Buchstabens ermitteln (Monospace = alle gleich breit)
        const charWidth = ctx.measureText("A").width;
        const totalTextWidth = charWidth * scrollText.length;
        
        // Startposition (ganz rechts am Rand) minus den bisherigen Fortschritt
        let startX = canvas.width - offset;
        
        // 4. Jeden Buchstaben einzeln zeichnen
        for (let i = 0; i < scrollText.length; i++) {
            let char = scrollText[i];
            let x = startX + (i * charWidth);
            
            // Render-Optimierung: Nur zeichnen, wenn der Buchstabe im Bild ist
            if (x > -50 && x < canvas.width + 50) {
                // Die Magie: Y-Position auf einer Sinuskurve berechnen
                // Durch x*frequency wabbelt es räumlich. Durch offset wabbelt es zeitlich.
                let y = (canvas.height / 2) + Math.sin((x * frequency) + (offset * 0.05)) * amplitude;
                
                ctx.fillText(char, x, y);
            }
        }
        
        // 5. Text weiterschieben
        offset += speed;
        
        // 6. Endlos-Loop: Wenn der Text komplett durch ist, wieder von vorne anfangen
        if (offset > totalTextWidth + canvas.width) {
            offset = 0;
        }
        
        // Nächsten Frame anfordern (sorgt für flüssige 60 FPS)
        requestAnimationFrame(draw);
    }
    
    draw();
}

// ==========================================
// PLAYLIST & SPIELDATEN-LOGIK (50 Hz PLAYER)
// ==========================================

// Unser Musik-Katalog
const trackRegistry = {
    atari: [
        { title: "1. Jochen Hippel - Wings of Death (Style)", generator: generateHippelStyleTrack, composerInfo: "Jochen Hippel (Mad Max) war der Meister des Atari YM-Chips. Er zwang den Chip mit Timer-Interrupts zu Klängen, für die er nie gebaut wurde." },
        { title: "2. Big Alec - Syntax Terror (Style)", generator: generateBigAlecStyleTrack, composerInfo: "Big Alec von der Gruppe Delta Force definierte den rohen, treibenden Demoscene-Sound. Sein Markenzeichen: Oktav-Bässe und knackige Noise-Drums." }
    ]
};

let trackData = [];    
let currentFrame = 0;  
let playTimer = null;  
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
    
    // UI updaten
    renderTracklist(system); 
    document.getElementById('info-text').innerHTML = `<p><strong>Playing: ${selectedSong.title}</strong></p><p>${selectedSong.composerInfo}</p><p class="blinking-cursor">_</p>`;
    
    // Direkt abspielen
    startPlayback();
}

// 50 Hz Player Engine
function startPlayback() {
    if (isPlaying || trackData.length === 0) return;
    isPlaying = true;
    
    playTimer = setInterval(() => {
        let frame = trackData[currentFrame];
        for (let r = 0; r < 14; r++) { writeYMReg(r, frame[r]); }
        currentFrame++;
        if (currentFrame >= trackData.length) currentFrame = 0; 
    }, 20);
}

function stopPlayback() {
    if (!isPlaying) return;
    clearInterval(playTimer);
    isPlaying = false;
    writeYMReg(8, 0); writeYMReg(9, 0); writeYMReg(10, 0);
}

// --- BUTTONS BINDEN ---
document.getElementById('btn-play').addEventListener('click', () => {
    if (isPlaying) stopPlayback();
    else {
        // Falls noch gar kein Track geladen ist, den ersten nehmen
        if (trackData.length === 0) {
            selectAndPlayTrack(0, 'atari');
        } else {
            startPlayback();
        }
    }
});

document.getElementById('btn-next').addEventListener('click', () => {
    let nextIdx = (currentTrackIndex + 1) % trackRegistry.atari.length;
    selectAndPlayTrack(nextIdx, 'atari');
});

document.getElementById('btn-prev').addEventListener('click', () => {
    let prevIdx = currentTrackIndex - 1;
    if (prevIdx < 0) prevIdx = trackRegistry.atari.length - 1;
    selectAndPlayTrack(prevIdx, 'atari');
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
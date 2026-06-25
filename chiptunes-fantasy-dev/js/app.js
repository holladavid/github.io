// --- IMPORT DER MODULE ---
import { trackRegistry } from '../tracks/registry.js';
import { createKickSample, createBassSample, createChordSample, createSnareSample, createLeadSample } from './utils/amiga-helper.js'; 
import { systemDescriptions, chipCheatSheets } from './content/museum.js'; // <- DIESER IMPORT MUSS INTACT SEIN!
import { workletRegistry } from './worklets/registry.js';

// --- GLOBALE VARIABLEN ---
let audioCtx;
let ymNode, paulaNode, sidNode; 
let masterGain;
let analyserNode; 
let currentOscValue = 0; 
let currentChipRegs = null; 
let activeSystem = 'atari';
let trackData = [];    
let currentFrame = 0;  
let isPlaying = false; 
let currentTrackIndex = 0;
let currentScrollerText = "+++ INITIALIZING DEMO ENGINE... +++";
let lastKnownFrame = 0; 
let previousFrame = 0;       // NEU: Merkt sich den vorherigen Frame für den Loop-Check
let lastTrackChangeTime = 0; // NEU: Der kugelsichere Cooldown-Timer
let isEcoMode = false;      // NEU: Status für den Pure Audio Mode
let isUserDragging = false; // NEU: Verhindert Slider-Zucken während des Ziehens
let currentSubsongIndex = 1; // NEU: Speichert das aktive C64-Subsong-Verzeichnis (1-basiert)

// --- YM2149 NOISE FREQUENCY LOOKUP TABLE (2 MHz Clock) ---
// 32 diskrete Werte für die 5 Bits (0 - 31). Periode 0 wird als 1 behandelt.
const NOISE_LUT_HZ = [
    125000, 125000,  62500,  41667,  31250,  25000,  20833,  17857,
     15625,  13889,  12500,  11364,  10417,   9615,   8929,   8333,
      7813,   7353,   6944,   6579,   6250,   5952,   5682,   5435,
      5208,   5000,   4808,   4630,   4464,   4310,   4167,   4032
];

// --- BOOT SEQUENZ (Modul-sicher) ---
function initApp() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            setTheme(e.target.getAttribute('data-theme'));
        });
    });

    const bootScreen = document.getElementById("boot-screen");
    bootScreen.addEventListener("click", async () => {
        const demoContainer = document.getElementById("demo-container");
        if (!demoContainer) {
            alert("FEHLER: HTML Element 'demo-container' fehlt in der index.html!");
            return;
        }

        bootScreen.classList.add("hidden");
        demoContainer.classList.remove("hidden");
        
        await initAudioEngine();
        initVisuals(); 
        initScroller(); 
        
        // System initialisieren, aber KEINEN Track automatisch starten!
        setTheme('theme-c64');
    });
}

if (document.readyState === 'loading') document.addEventListener("DOMContentLoaded", initApp);
else initApp();

// Globale Filter-Referenz für das Routing
let amigaFilter; 

// --- AUDIO ENGINE CORE (DYNAMISCH) ---
async function initAudioEngine() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try {
        amigaFilter = audioCtx.createBiquadFilter();
        amigaFilter.type = 'lowpass';
        amigaFilter.frequency.value = 6000; 

        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 4096; 

        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.5; 
        
        masterGain.connect(analyserNode);
        analyserNode.connect(audioCtx.destination);

        // Lade die Standard-Cores für alle Systeme beim Booten
        await loadEmuCore('atari', workletRegistry.atari[0]);
        await loadEmuCore('c64', workletRegistry.c64[0]);
        await loadEmuCore('amiga', workletRegistry.amiga[0]);

    } catch (e) { console.error("Audio Engine Boot Fehler:", e); }
}

// Der "virtuelle Lötkolben": Tauscht einen Chip auf dem Mainboard aus!
async function loadEmuCore(system, coreConfig) {
    try {
        // HIER IST DER FIX: { type: 'module' } erlaubt unsere neuen ES6-Importe!
        await audioCtx.audioWorklet.addModule(coreConfig.file, { type: 'module' });
        
        // Alten Chip abklemmen, falls vorhanden
        if (system === 'atari' && ymNode) ymNode.disconnect();
        if (system === 'c64' && sidNode) sidNode.disconnect();
        if (system === 'amiga' && paulaNode) paulaNode.disconnect();

        // Neuen Chip einsetzen
        let newNode = new AudioWorkletNode(audioCtx, coreConfig.processor);
        
        // Routing anwenden
        if (system === 'amiga') {
            newNode.connect(amigaFilter).connect(masterGain);
        } else {
            newNode.connect(masterGain);
        }

        // Sensoren (HUD, Oszilloskop & Auto-Advance) anschließen
        newNode.port.onmessage = (e) => {
            if (e.data.type === 'VISUAL_DATA') {
                currentOscValue = e.data.value;
                previousFrame = lastKnownFrame;
                lastKnownFrame = e.data.frame || 0; 
                currentChipRegs = e.data.regs; 

                // 2. AUTO-ADVANCE (Playlist Jukebox Modus)
                if (isPlaying && trackData.length > 0) {
                    if (previousFrame > trackData.length - 20 && lastKnownFrame < 10) {
                        // NEU: Der 2-Sekunden Cooldown! (Verhindert die Endlosschleife und den Safari-Absturz)
                        if (performance.now() - lastTrackChangeTime > 2000) {
                            lastTrackChangeTime = performance.now(); // Sofort sperren!
                            let nextIdx = (currentTrackIndex + 1) % trackRegistry[activeSystem].length;
                            console.log(`Track zu Ende! Wechsle automatisch zu Track ${nextIdx}...`);
                            selectAndPlayTrack(nextIdx, activeSystem);
                        }
                    }
                }
            }
            
            // DIE REPARIERTE UND OPTIMIERTE ROTE NERD-LED!
            if (e.data.type === 'DEBUG') {
                // NEU: Wenn PURE AUDIO an ist, ignorieren wir alle grafischen Trigger-Events!
                if (isEcoMode) return; 

                let match = e.data.msg.match(/Drum (\d+)/);
                let drumNo = match ? "SMP #" + match[1] : "TRIG";
                
                const led = document.getElementById('hud-digi-led');
                const val = document.getElementById('digi-g-val'); 
                
                if (led && val) {
                    val.innerText = drumNo;
                    val.style.color = '#ffffff';
                    val.style.textShadow = '0 0 10px #ffffff';
                    
                    led.style.background = '#ff0000';
                    led.style.boxShadow = '0 0 12px #ff0000';
                    
                    if (val.timeoutId) clearTimeout(val.timeoutId);
                    
                    val.timeoutId = setTimeout(() => { 
                        led.style.background = '#440000'; 
                        led.style.boxShadow = 'none';
                        val.style.color = ''; 
                        val.style.textShadow = 'none';
                        val.innerText = '--'; 
                    }, 120);
                }
            }
        };

        // Globale Referenzen updaten
        if (system === 'atari') ymNode = newNode;
        if (system === 'c64') sidNode = newNode;
        if (system === 'amiga') {
            paulaNode = newNode;
            // Wenn der Amiga-Chip neu eingelötet wird, muss sein RAM neu gefüllt werden!
            uploadAmigaSamples(); 
        }

        console.log(`[CORE LOADED] System: ${system} -> ${coreConfig.name}`);
    } catch (e) {
        console.error(`Fehler beim Laden des ${coreConfig.name} Cores:`, e);
    }
}

function uploadAmigaSamples() {
    if (paulaNode) {
        paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'kick', data: createKickSample() });
        paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'bass', data: createBassSample() });
        paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'chord', data: createChordSample() });
        paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'snare', data: createSnareSample() }); // NEU
        paulaNode.port.postMessage({ type: 'UPLOAD_SAMPLE', name: 'lead', data: createLeadSample() });   // NEU
    }
}

// --- TIMELINE HELPER ---
function formatTime(frames) {
    if (!frames) return "00:00";
    let totalSeconds = Math.floor(frames / 50);
    let mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    let secs = (totalSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

function updateTimelineUI() {
    if (!isPlaying || trackData.length === 0) return;
    // Aktualisierung blockieren, wenn der Nutzer den Regler manuell verschiebt
    if (!isUserDragging) {
        document.getElementById('time-current').innerText = formatTime(lastKnownFrame);
        document.getElementById('time-total').innerText = formatTime(trackData.length);
        document.getElementById('progress-slider').value = (lastKnownFrame / trackData.length) * 100;
    }
}

// --- HIGH-PRECISION SCRUBBING & TRACK-SEEKING ---
const progressSlider = document.getElementById('progress-slider');

progressSlider.addEventListener('mousedown', () => { isUserDragging = true; });
progressSlider.addEventListener('mouseup', () => { isUserDragging = false; });
progressSlider.addEventListener('touchstart', () => { isUserDragging = true; });
progressSlider.addEventListener('touchend', () => { isUserDragging = false; });

progressSlider.addEventListener('input', (e) => {
    if (trackData.length === 0) return;
    const targetPercent = parseFloat(e.target.value);
    const targetFrame = Math.floor((targetPercent / 100) * trackData.length);
    // Sofortige visuelle Rückmeldung der Zeitmarke beim Ziehen
    document.getElementById('time-current').innerText = formatTime(targetFrame);
});

progressSlider.addEventListener('change', (e) => {
    if (trackData.length === 0) return;
    const targetPercent = parseFloat(e.target.value);
    const targetFrame = Math.floor((targetPercent / 100) * trackData.length);
    
    // Lokalen Frame-Zähler synchronisieren
    lastKnownFrame = targetFrame;
    previousFrame = targetFrame;

    // Seek-Signal an den aktiven AudioWorklet-Knoten senden
    const seekMsg = { type: 'SEEK_TRACK', frame: targetFrame };
    if (activeSystem === 'amiga' && paulaNode) {
        paulaNode.port.postMessage(seekMsg);
    } else if (activeSystem === 'c64' && sidNode) {
        sidNode.port.postMessage(seekMsg);
    } else if (ymNode) {
        ymNode.port.postMessage(seekMsg);
    }
});

// --- DER NEUE HIGH-PRECISION PLAYER ---
function startPlayback() {
    if (isPlaying || trackData.length === 0) return;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(e=>console.log(e));

    isPlaying = true;
    
    // BUGFIX: Sichere Objektabfragen für Amiga und C64 (unterstützt Arrays und strukturierte Binärobjekte)
    let isAmiga = (trackData[0] && trackData[0].isAmiga) || trackData.isAmigaFile;
    let isC64 = (trackData[0] && trackData[0].isC64) || trackData.isSidFile;
    
    if (isAmiga) {
        if (paulaNode) paulaNode.port.postMessage({ type: 'PLAY_TRACK', track: trackData });
        else console.error("[CRITICAL] paulaNode ist undefined. Das Worklet konnte nicht geladen werden.");
    } else if (isC64) {
        if (sidNode) {
            if (trackData.isSidFile) {
                sidNode.port.postMessage(trackData); // Sendet das gesamte C64-Maschinencode-Paket!
            } else {
                // Abwärtskompatibilität für prozedurale Generatoren
                sidNode.port.postMessage({ type: 'PLAY_TRACK', track: trackData });
            }
        }
    } else {
        if (ymNode) {
            ymNode.port.postMessage({ 
                type: 'PLAY_TRACK', 
                track: trackData, 
                digidrums: trackData.digidrums 
            });
        }
    }
}

// NEU: Setzt das Playback exakt dort fort, wo es eingefroren wurde!
function resumePlayback() {
    if (isPlaying || trackData.length === 0) return;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    isPlaying = true;
    if (activeSystem === 'amiga') paulaNode.port.postMessage({ type: 'RESUME_TRACK' });
    else if (activeSystem === 'c64' && sidNode) sidNode.port.postMessage({ type: 'RESUME_TRACK' });
    else ymNode.port.postMessage({ type: 'RESUME_TRACK' });
}

function stopPlayback() {
    if (!isPlaying) return;
    isPlaying = false;
    if (ymNode) ymNode.port.postMessage({ type: 'STOP_TRACK' });
    if (paulaNode) paulaNode.port.postMessage({ type: 'STOP_TRACK' });
    if (sidNode) sidNode.port.postMessage({ type: 'STOP_TRACK' });
}

// --- UI & THEME LOGIK ---
function setTheme(themeName) {
    document.body.className = themeName;
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.classList.remove('active');
        if (tab.getAttribute('data-theme') === themeName) tab.classList.add('active');
    });

    activeSystem = themeName === 'theme-atari' ? 'atari' : themeName === 'theme-amiga' ? 'amiga' : 'c64';
    
    renderTracklist(activeSystem);
    stopPlayback(); 

    const headerTitles = {
        'c64': '>>> INFO: MOS Technology SID 6581',
        'amiga': '>>> INFO: MOS Paula 8364',
        'atari': '>>> INFO: Yamaha YM2149 (Atari ST)'
    };
    const headerEl = document.querySelector('.museum-header h2');
    if (headerEl) headerEl.innerText = headerTitles[activeSystem];

    document.getElementById('info-text').innerHTML = `
        ${systemDescriptions[activeSystem]}
        <div>
            <p style="color: var(--highlight-color);">[ SYSTEM READY ]</p>
            <p>Please select a track from the playlist to initialize playback and load data into memory...</p>
            <p class="blinking-cursor" style="margin-top: 15px;">_</p>
        </div>
    `;
    currentScrollerText = `+++ ${activeSystem.toUpperCase()} SYSTEM READY. AWAITING INPUT... +++`;

    const legend = document.getElementById('hud-legend');
    if (legend) legend.classList.add('hidden'); 

    // NEU: HUD Body und [?] Button beim Systemwechsel sauber verstecken
    const hudBody = document.getElementById('hud-body');
    if (hudBody) hudBody.classList.add('hidden');
    
    const hudMain = document.getElementById('chip-hud'); // NEU
    if (hudMain) hudMain.classList.add('collapsed');     // NEU
    
    const hudToggleBtn = document.getElementById('btn-hud-toggle');
    if (hudToggleBtn) hudToggleBtn.innerText = '[+]';
    
    const infoBtn = document.getElementById('btn-hud-info');
    if (infoBtn) infoBtn.classList.add('hidden');

    trackData = [];
    currentTrackIndex = 0;
    currentChipRegs = null;
    
    // Slider zurücksetzen und sperren, bis ein Song geladen wird
    document.getElementById('progress-slider').value = 0;
    document.getElementById('progress-slider').disabled = true;
    document.getElementById('time-current').innerText = "00:00";
    document.getElementById('time-total').innerText = "00:00";
    
    // BUGFIX: Subsong-Anzeige beim Systemwechsel absolut ausblenden!
    const subsongDisplay = document.getElementById('subsong-display');
    if (subsongDisplay) {
        subsongDisplay.classList.add('hidden');
        subsongDisplay.innerText = "";
    }
    
    renderCoreSelector(activeSystem);
}

// Baut die Dropdown-Liste inkl. ASCII-CPU-Meter
function renderCoreSelector(system) {
    const select = document.getElementById('core-selector');
    select.innerHTML = '';
    workletRegistry[system].forEach((core, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        
        let cpuLoad = core.cpu || 1;
        let meter = '';
        for (let i = 1; i <= 4; i++) {
            meter += (i <= cpuLoad) ? '■' : '□';
        }
        
        // FIX 1: Ein klares Trennzeichen für mobile native Dropdowns!
        opt.text = `${core.name} • CPU:${meter}`;
        
        select.appendChild(opt);
    });
}

function renderTracklist(system) {
    const listElement = document.getElementById('tracklist');
    listElement.innerHTML = ''; 
    const songs = trackRegistry[system];
    if (!songs) return;

    songs.forEach((song, index) => {
        const li = document.createElement('li');
        li.textContent = song.title;
        if (index === currentTrackIndex) li.classList.add('active-track');
        li.addEventListener('click', () => selectAndPlayTrack(index, system));
        listElement.appendChild(li);
    });
}

async function selectAndPlayTrack(index, system) {
    // Der Cooldown-Stempel! Setzt die Sperre für den Jukebox-Wechsel auf JETZT
    lastTrackChangeTime = performance.now();

    // iOS Safari Fix: Context sofort beim Klicken aufwecken (falls nötig)
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(e => console.log("AudioContext resume blockiert:", e));
    }

    const songs = trackRegistry[system];
    if (!songs || !songs[index]) {
        return; 
    }

    stopPlayback();
    currentTrackIndex = index;
    const selectedSong = songs[index];
    
    // Frame-Zähler hart resetten, um Geister-Loops zu verhindern
    lastKnownFrame = 0;
    previousFrame = 0; 
    
    // Regler für das Scrubbing freigeben
    document.getElementById('progress-slider').disabled = false;
    
    renderTracklist(system); 

    if (selectedSong.loadAsync) {
        // Echte Systemprüfungen statt fehlerhafter String-Suchen im Titel
        const isAmigaSystem = (system === 'amiga');
        const isC64System = (system === 'c64'); // NEU
        
        currentScrollerText = isAmigaSystem 
            ? "+++ DOWNLOADING AND PARSING BINARY AMIGA MODULE... +++"
            : (isC64System ? "+++ DOWNLOADING AND PARSING BINARY C64 PSID FILE... +++" : "+++ DOWNLOADING AND PARSING BINARY YM FILE... +++");
        
        try {
            let parsedFile = await selectedSong.loadAsync();
            
            if (isC64System) {
                // Das komplette, binäre CPU-Paket an die Playback-Engine übergeben!
                trackData = parsedFile; 
                currentSubsongIndex = parsedFile.startSong || 1; // Standard-Startsong deklarieren
                
                // Absicherung falls lengths undefiniert ist
                let sldbLengths = trackData.lengths || [180];
                let songLengthSeconds = sldbLengths[currentSubsongIndex - 1] || sldbLengths[0] || 180;
                trackData.length = songLengthSeconds * 50; // Frame-Anzahl synchronisieren
                
                // Subsong-Anzeige im UI befüllen und einblenden!
                const subsongDisplay = document.getElementById('subsong-display');
                if (subsongDisplay) {
                    subsongDisplay.innerText = `[SUB ${currentSubsongIndex}/${parsedFile.metadata.songs}]`;
                    subsongDisplay.classList.remove('hidden');
                }
            } else {
                // BUGFIX: Subsong-Anzeige für Amiga-MODs und Atari-YM-Dateien im Binär-Pfad ausblenden!
                const subsongDisplay = document.getElementById('subsong-display');
                if (subsongDisplay) {
                    subsongDisplay.classList.add('hidden');
                    subsongDisplay.innerText = "";
                }

                trackData = parsedFile.frames; 
                trackData.digidrums = parsedFile.digidrums || [];
                
                if (isAmigaSystem) {
                    trackData.isAmigaFile = true;
                    
                    // --- DYNAMISCHER SAMPLE-UPLOAD ---
                    if (parsedFile.samples && paulaNode) {
                        for (let sampleName in parsedFile.samples) {
                            paulaNode.port.postMessage({
                                type: 'UPLOAD_SAMPLE',
                                name: sampleName,
                                data: parsedFile.samples[sampleName]
                            });
                        }
                    }
                } else {
                    trackData.isYmFile = true;
                }
            }

            let meta = parsedFile.metadata;
            
            currentScrollerText = isAmigaSystem
                ? `+++ BOOM! SUCCESSFULLY DECODED AMIGA MODULE +++ NOW PLAYING: ${meta.name.toUpperCase()} BY ${meta.author.toUpperCase()} +++ FORMAT: ${meta.type} +++ THIS IS PURE PROTRACKER MAGIC +++ `
                : (isC64System
                    ? `+++ BOOM! SUCCESSFULLY CRACKED OPEN BINARY PSID FILE +++ NOW PLAYING: ${meta.name.toUpperCase()} BY ${meta.author.toUpperCase()} +++ FORMAT: ${meta.type} +++ CRANK UP THE VOLUME AND LET THE ANALOG SID FILTERS SHINE +++ `
                    : `+++ BOOM! SUCCESSFULLY CRACKED OPEN BINARY FILE +++ NOW PLAYING: ${meta.name.toUpperCase()} BY ${meta.author.toUpperCase()} +++ COMMENT ALONG THE RIDE: ${meta.comment.toUpperCase() || "NO COMMENT"} +++ CRANK UP THE GAIN AND LET THE YM2149 MELT YOUR SPEAKERS +++ `);

            let techInfo = "";
            if (isAmigaSystem) {
                techInfo += `<p><strong>File Signature:</strong> ${meta.type}</p>`;
                techInfo += `<p><strong>Size in Memory:</strong> ${meta.fileSize.toLocaleString('de-DE')} Bytes</p>`;
                techInfo += `<p><strong>Structure:</strong> ${meta.patternCount} Patterns, ${meta.instrumentCount} Synthesized Amiga Instruments</p>`;
                techInfo += `<p><strong>Paula Configuration:</strong> 4 Channels, Direct DMA emulation</p>`;
            } else if (isC64System) {
                // TECHNISCHE AUSWERTUNG FÜR BINÄRE C64-DATEIEN
                techInfo += `<p><strong>File Signature:</strong> ${meta.type}</p>`;
                techInfo += `<p><strong>Size in Memory:</strong> ${meta.fileSize.toLocaleString('de-DE')} Bytes</p>`;
                techInfo += `<p><strong>SID Address Space:</strong> Load: ${meta.loadAddress} | Init: ${meta.initAddress} | Play: ${meta.playAddress}</p>`;
                techInfo += `<p><strong>Song Data:</strong> ${meta.songs} Subsong(s) detected, starting with Song ${meta.startSong}</p>`;
                techInfo += `<p><strong>SID Core:</strong> 6502 Emulator, MOS SID 6581, 3 Voices, Analog SVF filtering</p>`;
            } else {
                techInfo = `<p><strong>File Signature:</strong> ${meta.type} (De-interleaved)</p>`;
                techInfo += `<p><strong>Length:</strong> ${trackData.length} Frames @ 50Hz VBLANK</p>`;
                
                if (meta.digidrumCount > 0) {
                    techInfo += `<p style="margin-top: 5px;"><strong>PCM Data:</strong> ${meta.digidrumCount} Digidrum(s) detected!</p>`;
                    let sizes = meta.digidrumSizes.map(s => s.toLocaleString('de-DE') + ' Bytes').join(' / ');
                    techInfo += `<p style="font-size: 0.9em; margin-left: 10px; color: var(--text-color); opacity: 0.8;">> Sample sizes: [ ${sizes} ]</p>`;
                } else {
                    techInfo += `<p style="margin-top: 5px;"><strong>PCM Data:</strong> None. 100% pure synthesized chip magic.</p>`;
                }
            }

            // Tracker-Design (border-left statt dashed border!)
            let dynamicHTML = `
                <div style="margin-top: 15px; padding: 10px 15px; background: rgba(0,0,0,0.2); border-left: 4px solid var(--highlight-color); position: relative;">
                    <p style="color: var(--highlight-color); margin-bottom: 8px;"><strong>[ BINARY FILE ANALYSIS ]</strong></p>
                    ${techInfo}
                </div>
            `;

            // ROBUSTE ABSICHERUNG: Fallback falls der Import durch Scoping-Probleme blockiert ist
            const systemText = (typeof systemDescriptions !== 'undefined' && systemDescriptions[system]) 
                ? systemDescriptions[system] 
                : '<p style="color: var(--text-color);">[ Museumdatenarchiv geladen, Beschreibung temporär nicht verfügbar ]</p>';

            // Museum füllen
            document.getElementById('info-text').innerHTML = `
                <div style="margin-bottom: 20px;">
                    <h2 style="color: var(--highlight-color);">> NOW PLAYING:</h2>
                    <p style="font-size: 1.2em; padding-top: 5px;">${selectedSong.title}</p>
                </div>
                
                ${dynamicHTML}
                
                <div style="margin-top: 30px; padding-top: 15px;">
                    ${systemText}
                </div>
                <p class="blinking-cursor" style="margin-top: 15px;">_</p>
            `;
            startPlayback();
            
        } catch (err) {
            alert("FEHLER BEIM LADEN: " + err.message);
            currentScrollerText = "+++ ERROR LOADING FILE +++";
        }
    } else {
        // Der alte Weg (Generatoren)
        const systemText = (typeof systemDescriptions !== 'undefined' && systemDescriptions[system]) 
            ? systemDescriptions[system] 
            : '<p style="color: var(--text-color);">[ Museumdatenarchiv geladen ]</p>';

        document.getElementById('info-text').innerHTML = `
            <div style="margin-bottom: 20px;">
                <h2 style="color: var(--highlight-color);">> NOW PLAYING:</h2>
                <p style="font-size: 1.2em; padding-top: 5px;">${selectedSong.title}</p>
            </div>
            ${selectedSong.composerInfo}
            
            <div style="margin-top: 30px; padding-top: 15px;">
                ${systemText}
            </div>
            <p class="blinking-cursor" style="margin-top: 15px;">_</p>
        `;
        currentScrollerText = "+++ NOW PLAYING: " + selectedSong.title + " +++";
        trackData = selectedSong.generator();
        startPlayback();
    }
}

// --- DYNAMISCHER SUBSONG-WECHSEL (Echtzeit!) ---
function changeC64Subsong(subsongId) {
    if (!sidNode || !trackData || !trackData.isSidFile) return;

    // Signalisiere der CPU das Umschalten des Subsongs im Audio-Thread
    sidNode.port.postMessage({ type: 'CHANGE_SUBSONG', frame: subsongId });
    currentSubsongIndex = subsongId;

    // BUGFIX: Absicherung falls lengths undefiniert ist
    let sldbLengths = trackData.lengths || [180];
    let songLengthSeconds = sldbLengths[subsongId - 1] || sldbLengths[0] || 180;
    trackData.length = songLengthSeconds * 50; // Frameanzahl aktualisieren

    // Slider-Timeline hart zurücksetzen
    lastKnownFrame = 0;
    previousFrame = 0;
    document.getElementById('time-current').innerText = "00:00";
    document.getElementById('time-total').innerText = formatTime(trackData.length);
    document.getElementById('progress-slider').value = 0;

    // Subsong-Anzeige aktualisieren
    const subsongDisplay = document.getElementById('subsong-display');
    if (subsongDisplay) {
        subsongDisplay.innerText = `[SUB ${subsongId}/${trackData.metadata.songs}]`;
    }

    // Scroller-Text aktualisieren
    let meta = trackData.metadata;
    currentScrollerText = `+++ BOOM! SWITCHED TO SUBSONG ${subsongId} OF ${meta.songs} +++ NOW PLAYING: ${meta.name.toUpperCase()} (TRACK ${subsongId}) BY ${meta.author.toUpperCase()} +++ `;
    
    console.log(`[C64 JUKEBOX] Switched to Subsong ${subsongId} / ${meta.songs} (${songLengthSeconds}s)`);
}

// --- BUTTON EVENTS ---
document.getElementById('btn-play').addEventListener('click', () => {
    // NEU: iOS SAFARI FIX!
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    if (isPlaying) {
        stopPlayback(); 
    } else {
        trackData.length === 0 ? selectAndPlayTrack(0, activeSystem) : resumePlayback();
    }
});

document.getElementById('btn-next').addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); // iOS FIX

    // Prüfen, ob wir uns auf einem C64-Track mit mehreren Subsongs befinden
    if (activeSystem === 'c64' && trackData && trackData.isSidFile) {
        const totalSongs = trackData.metadata.songs || 1;
        if (currentSubsongIndex < totalSongs) {
            // Schalte zum nächsten Subsong um und brich das Tracklist-Wechseln ab
            changeC64Subsong(currentSubsongIndex + 1);
            return; 
        }
    }

    // Normales Playlist-Wechseln
    selectAndPlayTrack((currentTrackIndex + 1) % trackRegistry[activeSystem].length, activeSystem);
});

document.getElementById('btn-prev').addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); // iOS FIX

    // Prüfen, ob wir uns auf einem C64-Track mit mehreren Subsongs befinden
    if (activeSystem === 'c64' && trackData && trackData.isSidFile) {
        if (currentSubsongIndex > 1) {
            // Schalte zum vorherigen Subsong um und brich das Tracklist-Wechseln ab
            changeC64Subsong(currentSubsongIndex - 1);
            return;
        }
    }

    // Normales Playlist-Wechseln
    let prevIdx = currentTrackIndex - 1;
    if (prevIdx < 0) prevIdx = trackRegistry[activeSystem].length - 1;
    selectAndPlayTrack(prevIdx, activeSystem);
});

// Globale Variable für den Wake Lock Sensor
let wakeLock = null;

// --- PURE AUDIO / ECO MODE TOGGLE (Echte Modularisierung) ---

// FIX 2: Der unsichtbare iOS No-Sleep Video-Hack (Base64)
const noSleepVideo = document.createElement('video');
noSleepVideo.setAttribute('playsinline', '');
noSleepVideo.setAttribute('muted', '');
noSleepVideo.setAttribute('loop', '');
noSleepVideo.src = 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAAz5tb292AAAAbG12aGQAAAAA/8f/3v/H/+QAAALuAAAC7gABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAGGlvZHMAAAAAE//H/+QAAALuAAAC7gABAAAAAAABAAAAMXRyYWsAAABcdGtoZAAAAAD/x//e/8f/5AAAAAEAAAAAAAAC7gAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAgAAAAIAAAAgZWR0cwAAABBlbHN0AAAAAQAAAu4AAAAAAAEAAAAAAixtZGlhAAAAIG1kaGQAAAAA/8f/3v/H/+QAAALuAAAC7gABAAAAAAAxAAAAAAAvaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAIcbWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAcRzdGJsAAAAp3N0c2QAAAAAAAAAAQAAAJNhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAgACAEgAAABIAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAR//8AAAAxYXZjQwH0AAr/4QAZZ/QACq608AUBzgAAAwAABgAAAwivDxgXoAAAAQAAABhzdHRzAAAAAAAAAAEAAAABAAAC7gAAAABzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAHHN0c3oAAAAAAAAAAAAAAAEAAAAeAAAAFHN0Y28AAAAAAAAAAQAAADAAAAA0dWR0YQAAACxtZXRhAAAAAAAAAABoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAA';

// Funktion zum Aktivieren des ECO-Modus (Pure Audio)
async function enableEcoMode() {
    // 1. WICHTIG FÜR iOS: Video MUSS synchron im ersten Klick-Frame starten!
    noSleepVideo.play().catch(e => console.warn('iOS Video-Hack blockiert:', e));

    isEcoMode = true;
    document.getElementById('eco-overlay').classList.remove('hidden');
    
    // 2. Offizielle Wake-Lock-Methode (Desktop & Android)
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('[SYSTEM] Wake Lock aktiv. Bildschirm bleibt an.');
        }
    } catch (err) {
        console.warn(`Wake Lock API blockiert. Fallback läuft.`);
    }
}

// Funktion zum Deaktivieren des ECO-Modus (Wieder aufwecken)
async function disableEcoMode() {
    isEcoMode = false;
    document.getElementById('eco-overlay').classList.add('hidden');
    
    // Offizielle Methode beenden
    if (wakeLock !== null) {
        await wakeLock.release();
        wakeLock = null;
    }
    
    // iOS Fallback beenden
    noSleepVideo.pause();
    
    // Trigger ein Resize-Event, damit sich die Visualisierungs-Canvases sofort neu kalibrieren
    window.dispatchEvent(new Event('resize'));
}

// KOPPLUNG DER EVENTS: Sowohl ECO-Button als auch WAKE-UP-Button steuern die Funktionen
document.getElementById('btn-eco').addEventListener('click', async () => {
    // Falls audioCtx im Hintergrund schläft, aufwecken
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    if (isEcoMode) {
        await disableEcoMode(); // 2. Druck schaltet den ECO-Modus aus!
    } else {
        await enableEcoMode();  // 1. Druck schaltet den ECO-Modus ein!
    }
});

document.getElementById('btn-eco-off').addEventListener('click', async () => {
    await disableEcoMode();
});

document.getElementById('volume-slider').addEventListener('input', (e) => {
    if (masterGain) masterGain.gain.value = e.target.value;
});

// --- FULLSCREEN TOGGLE LOGIK (Mit nativem & iOS-Pseudo-Support) ---
function toggleFullscreen() {
    const visualZone = document.getElementById('visual-zone');
    
    // Kugel- und Safari-sichere iOS-Erkennung (iPhone, iPad, iPod incl. iPadOS 13+ Safari)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
                  (/Macintosh/.test(navigator.userAgent) && "ontouchend" in document);
    
    const hasNativeSupport = !isIOS && !!(visualZone.requestFullscreen || visualZone.webkitRequestFullscreen);
    
    if (hasNativeSupport) {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (visualZone.requestFullscreen) {
                visualZone.requestFullscreen();
            } else if (visualZone.webkitRequestFullscreen) {
                visualZone.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    } else {
        // iOS / iPhone & iPad Safari Pseudo-Fullscreen Fallback!
        const isPseudo = visualZone.classList.toggle('pseudo-fullscreen');
        const btn = document.getElementById('btn-fullscreen');
        
        if (isPseudo) {
            btn.innerText = '[ EXIT ]';
        } else {
            btn.innerText = '[ ⛶ ]';
        }
        
        // BUGFIX: Gib dem iOS Safari DOM 50 Millisekunden Zeit, die Fixed-Positioning-Regeln
        // anzuwenden, bevor wir das Canvas zwingen, sich neu zu berechnen!
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 50);
    }
}

// Beobachtet native Fullscreen-Zustandsänderungen zur Synchronisation des Button-Textes
function handleFullscreenChange() {
    const btn = document.getElementById('btn-fullscreen');
    const isNativeFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
    
    if (isNativeFS) {
        btn.innerText = '[ EXIT ]';
    } else {
        btn.innerText = '[ ⛶ ]';
    }
    // Canvas im VBLANK neu berechnen
    window.dispatchEvent(new Event('resize'));
}

// Event-Kopplung
document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange); // Safari-Kopplung
// Event-Kopplung
document.getElementById('btn-fullscreen').addEventListener('click', () => {
    toggleFullscreen();
});

document.getElementById('btn-hud-info').addEventListener('click', () => {
    const legend = document.getElementById('hud-legend');
    legend.innerHTML = chipCheatSheets[activeSystem]; 
    legend.classList.toggle('hidden');
});

// --- Toggle für das gesamte DSP HUD ---
document.getElementById('btn-hud-toggle').addEventListener('click', (e) => {
    const hud = document.getElementById('chip-hud'); // NEU: Der Haupt-Container
    const body = document.getElementById('hud-body');
    const infoBtn = document.getElementById('btn-hud-info'); 
    const isHidden = body.classList.contains('hidden');
    
    if (isHidden) {
        body.classList.remove('hidden');
        infoBtn.classList.remove('hidden'); 
        hud.classList.remove('collapsed'); // NEU: HUD ausbreiten!
        e.target.innerText = '[-]'; 
    } else {
        body.classList.add('hidden');
        infoBtn.classList.add('hidden'); 
        hud.classList.add('collapsed'); // NEU: HUD schrumpfen!
        e.target.innerText = '[+]'; 
        
        const legend = document.getElementById('hud-legend');
        if (legend) legend.classList.add('hidden');
    }
});

// --- EMU CORE WECHSEL (Dropdown) ---
document.getElementById('core-selector').addEventListener('change', async (e) => {
    stopPlayback();
    const coreIndex = e.target.value;
    const coreConfig = workletRegistry[activeSystem][coreIndex];
    document.getElementById('hud-content') ? document.getElementById('hud-content').innerText = "RE-WIRING DSP..." : null;
    await loadEmuCore(activeSystem, coreConfig);
    // Spielt den Track automatisch mit dem neuen Chip weiter!
    startPlayback(); 
});

// --- HIGH-PERFORMANCE CHIP HUD UPDATE ---
let cachedSystem = null; 
let hudValElements = [];

// NEU: Historien-Speicher für die Frequenz-Liniendiagramme (ca. 4-5 Sekunden Historie)
const HIST_LEN = 60; 
let pitchHistA = new Float32Array(HIST_LEN);
let pitchHistB = new Float32Array(HIST_LEN);
let pitchHistC = new Float32Array(HIST_LEN);
let histIdx = 0;

// Hilfsfunktion: Zeichnet das Liniendiagramm (Sparkline) ins Canvas
function drawSparkline(canvasId, historyArr, headIdx, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    // Dynamische Skalierung: Finde Min- und Max-Hz im Puffer, um die Welle optimal darzustellen
    let maxVal = 10;
    let minVal = 99999;
    for(let i=0; i<HIST_LEN; i++) {
        if(historyArr[i] > maxVal) maxVal = historyArr[i];
        if(historyArr[i] > 0 && historyArr[i] < minVal) minVal = historyArr[i];
    }
    if (minVal === 99999) minVal = 0;
    let range = maxVal - minVal;
    if (range < 100) range = 100; // Mindest-Zoom, damit Stille keine flackernde Linie macht

    for(let i=0; i<HIST_LEN; i++) {
        let actualIdx = (headIdx + i) % HIST_LEN;
        let val = historyArr[actualIdx];
        
        // Werte auf die Höhe des Canvas normalisieren (Y ist invertiert: 0 ist oben)
        let norm = (val - minVal) / range;
        let y = canvas.height - (norm * canvas.height);
        let x = (i / (HIST_LEN - 1)) * canvas.width;
        
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

// --- KORRIGIERTE KANAL-FUNKTION ---
function makeAtariChannelRow(ch, pitchId, volId, hegId, digiId) {
    let digiHtml = digiId ? `
        <div class="hud-row">
            <label>Digi Hack</label>
            <span id="${digiId}" class="hud-text-sel">--</span>
        </div>` : '';
    
    return `
        <div class="hud-channel">
            <h4>[ CH ${ch} ]</h4>
            <div class="hud-row">
                <label>Freq</label>
                <canvas class="hud-sparkline" id="${pitchId}-chart" width="100" height="18"></canvas>
                <span class="hud-val" id="${pitchId}-val">0 Hz</span>
            </div>
            <div class="hud-row">
                <label>Volume</label>
                <div class="hud-bar"><div class="hud-bar-fill" id="${volId}-bar"></div></div>
                <span class="hud-val" id="${volId}-val" style="width: 20px;">0</span>
                <div style="width: 5px;"></div>
                <div class="hud-led" id="${hegId}-led"></div><span style="font-size:0.8em; color:var(--text-color);">HEG</span>
            </div>
            ${digiHtml}
        </div>
    `;
}

function updateChipHUD() {
    const matrix = document.getElementById('hud-matrix');
    let regCount = activeSystem === 'c64' ? 29 : (activeSystem === 'amiga' ? 28 : 16);

    // 1. DOM IMMER sofort neu aufbauen, wenn sich das System ändert (auch wenn die Musik stoppt!)
    // BUGFIX: Da das Atari-Grid "hudValElements" nicht befüllt, hat der Längen-Check hier zu einem 
    // endlosen innerHTML-Rebuild-Loop geführt, der die Sparkline-Canvases im VBLANK vernichtet hat.
    if (cachedSystem !== activeSystem || (activeSystem !== 'atari' && hudValElements.length !== regCount)) {
        cachedSystem = activeSystem;
        
        if (activeSystem === 'atari') {
            // ADVANCED DSP ANALYZER LAYOUT FÜR ATARI
            matrix.innerHTML = `
                <div class="atari-analyzer-grid">
                    <div>
                        ${makeAtariChannelRow('A', 'pitch-a', 'vol-a', 'heg-a', 'digi-a')}
                        ${makeAtariChannelRow('B', 'pitch-b', 'vol-b', 'heg-b', 'digi-b')}
                        ${makeAtariChannelRow('C', 'pitch-c', 'vol-c', 'heg-c', null)}
                    </div>
                    <div>
                        <div class="hud-channel">
                            <h4>[ MIXER & NOISE ]</h4>
                            <div class="hud-row">
                                <label>N-Freq</label>
                                <div class="hud-bar"><div class="hud-bar-fill" id="noise-bar"></div></div>
                                <span class="hud-val" id="noise-val">0 Hz</span>
                            </div>
                            <div class="hud-row">
                                <label>Tone</label>
                                <div class="hud-led" id="tone-a-led"></div><span style="margin-right: 12px">A</span>
                                <div class="hud-led" id="tone-b-led"></div><span style="margin-right: 12px">B</span>
                                <div class="hud-led" id="tone-c-led"></div><span>C</span>
                            </div>
                            <div class="hud-row">
                                <label>Noise</label>
                                <div class="hud-led" id="noise-a-led"></div><span style="margin-right: 12px">A</span>
                                <div class="hud-led" id="noise-b-led"></div><span style="margin-right: 12px">B</span>
                                <div class="hud-led" id="noise-c-led"></div><span>C</span>
                            </div>
                        </div>

                        <div class="hud-channel">
                            <h4>[ HARDWARE ENVELOPE ]</h4>
                            <div class="hud-row">
                                <label>Frequency</label>
                                <div class="hud-bar"><div class="hud-bar-fill" id="env-bar"></div></div>
                                <span class="hud-val" id="env-val">0.0 Hz</span>
                            </div>
                            <div class="hud-row">
                                <label>Shape</label>
                                <span id="env-shape-val" class="hud-text-sel">--</span>
                            </div>
                            <!-- DIE KORREKTE GLOBAL TRIG LED -->
                            <div class="hud-row">
                                <label>Global Trig</label>
                                <span id="digi-g-val" class="hud-text-sel" style="flex-grow: 1;">--</span>
                                <div id="hud-digi-led" style="width: 10px; height: 10px; border-radius: 50%; background: #440000; border: 1px solid #ff0000; box-shadow: none;"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Historien leeren, falls wir von einem anderen Track zurückkommen
            pitchHistA.fill(0); pitchHistB.fill(0); pitchHistC.fill(0);
            
            hudValElements = []; // Für Atari-Grid nicht direkt indiziert

        } else {
            // FALLBACK HEX-MATRIX FÜR C64 & AMIGA (Baut sich nun auch im Stop-Modus auf!)
            let html = '';
            // Echte Amiga custom-chip Registerbezeichner (Paula)
            const amigaLabels = [
                'A0LCH', 'A0LCL', 'A0LENH', 'A0LENL', 'A0PERH', 'A0PERL', 'A0VOL',
                'A1LCH', 'A1LCL', 'A1LENH', 'A1LENL', 'A1PERH', 'A1PERL', 'A1VOL',
                'A2LCH', 'A2LCL', 'A2LENH', 'A2LENL', 'A2PERH', 'A2PERL', 'A2VOL',
                'A3LCH', 'A3LCL', 'A3LENH', 'A3LENL', 'A3PERH', 'A3PERL', 'A3VOL'
            ];

            for (let i = 0; i < regCount; i++) {
                let regLabel = activeSystem === 'amiga' ? amigaLabels[i] : i.toString(16).toUpperCase().padStart(2, '0');
                if (activeSystem !== 'amiga') regLabel = 'R' + regLabel;
                
                html += `<div class="hud-cell"><div class="hud-cell-label">${regLabel}</div><div class="hud-cell-val" id="hud-val-${i}">--</div></div>`;
            }
            matrix.innerHTML = html;
            
            hudValElements = [];
            for (let i = 0; i < regCount; i++) {
                hudValElements.push(document.getElementById(`hud-val-${i}`));
            }
        }
    }
    
    // 2. SICHERHEITSSCHRANKE FÜR WERTE-UPDATES:
    // Wenn nichts gespielt wird, brechen wir HIER ab, VOR den physikalischen Berechnungen!
    if (!isPlaying || !currentChipRegs) return;
    
    // 3. High-Speed Update & Physik-Berechnung
    if (activeSystem === 'atari') {
        const r = currentChipRegs;

        // KANAL A: Hertz Berechnung (2MHz / 16 / Period)
        let pitchA = ((r[1] & 0x0F) << 8) | r[0];
        let hzA = pitchA === 0 ? 0 : 2000000 / (16 * pitchA);
        if (hzA > 15000) hzA = 0; // Filtert unhörbare Ultraschall-Signale (125 kHz) heraus
        pitchHistA[histIdx] = hzA;
        document.getElementById('pitch-a-val').innerText = Math.round(hzA) + ' Hz';
        drawSparkline('pitch-a-chart', pitchHistA, (histIdx+1)%HIST_LEN, '#55ff55');
        
        let volA = r[8] & 0x0F;
        document.getElementById('vol-a-bar').style.width = (volA / 15 * 100) + '%';
        document.getElementById('vol-a-val').innerText = volA;
        document.getElementById('heg-a-led').className = (r[8] & 0x10) ? 'hud-led on' : 'hud-led';
        let digiA = (r[1] & 0xF0) >> 4;
        document.getElementById('digi-a').innerText = digiA > 0 ? `SMP #${digiA}` : '--';

        // KANAL B
        let pitchB = ((r[3] & 0x0F) << 8) | r[2];
        let hzB = pitchB === 0 ? 0 : 2000000 / (16 * pitchB);
        if (hzB > 15000) hzB = 0;
        pitchHistB[histIdx] = hzB;
        document.getElementById('pitch-b-val').innerText = Math.round(hzB) + ' Hz';
        drawSparkline('pitch-b-chart', pitchHistB, (histIdx+1)%HIST_LEN, '#55ff55');

        let volB = r[9] & 0x0F;
        document.getElementById('vol-b-bar').style.width = (volB / 15 * 100) + '%';
        document.getElementById('vol-b-val').innerText = volB;
        document.getElementById('heg-b-led').className = (r[9] & 0x10) ? 'hud-led on' : 'hud-led';
        let digiB = (r[3] & 0xF0) >> 4;
        document.getElementById('digi-b').innerText = digiB > 0 ? `SMP #${digiB}` : '--';

        // KANAL C
        let pitchC = ((r[5] & 0x0F) << 8) | r[4];
        let hzC = pitchC === 0 ? 0 : 2000000 / (16 * pitchC);
        if (hzC > 15000) hzC = 0;
        pitchHistC[histIdx] = hzC;
        document.getElementById('pitch-c-val').innerText = Math.round(hzC) + ' Hz';
        drawSparkline('pitch-c-chart', pitchHistC, (histIdx+1)%HIST_LEN, '#55ff55');

        let volC = r[10] & 0x0F;
        document.getElementById('vol-c-bar').style.width = (volC / 15 * 100) + '%';
        document.getElementById('vol-c-val').innerText = volC;
        document.getElementById('heg-c-led').className = (r[10] & 0x10) ? 'hud-led on' : 'hud-led';

        // Ringpuffer weiterdrehen
        histIdx = (histIdx + 1) % HIST_LEN;

        // NOISE (5-Bit Lookup Table anwenden!)
        let noiseP = r[6] & 0x1F;
        let exactHz = NOISE_LUT_HZ[noiseP];
        
        // Dynamische Formatierung, damit es sauber in die 75px Box passt
        let noiseStr = "";
        if (exactHz >= 10000) {
            noiseStr = (exactHz / 1000).toFixed(1) + " kHz"; // Aus 125000 wird "125.0 kHz"
        } else {
            noiseStr = exactHz + " Hz"; // Aus 8333 wird "8333 Hz"
        }

        document.getElementById('noise-bar').style.width = (noiseP / 31 * 100) + '%';
        document.getElementById('noise-val').innerText = noiseStr;

        let mix = r[7];
        document.getElementById('tone-a-led').className = (mix & 0x01) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('tone-b-led').className = (mix & 0x02) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('tone-c-led').className = (mix & 0x04) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('noise-a-led').className = (mix & 0x08) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('noise-b-led').className = (mix & 0x10) === 0 ? 'hud-led on' : 'hud-led';
        document.getElementById('noise-c-led').className = (mix & 0x20) === 0 ? 'hud-led on' : 'hud-led';

        // ENVELOPE (Hertz Berechnung: Takt / 256 / Period)
        let envP = (r[12] << 8) | r[11];
        let envHz = envP === 0 ? 0 : 2000000 / (256 * envP);
        document.getElementById('env-bar').style.width = (envP / 65535 * 100) + '%';
        document.getElementById('env-val').innerText = envHz.toFixed(1) + ' Hz';
        
        let shapeBits = r[13];
        let shapeStr = "--";
        if (shapeBits !== 0xFF && shapeBits !== 0) {
            const shapes = {
                0:'\\___', 4:'/___', 8:'\\\\\\\\', 9:'\\___', 10:'\\/\\/', 
                11:'\\---', 12:'////', 13:'/---', 14:'/\\/\\', 15:'/___'
            };
            let s = shapeBits & 0x0F;
            if (s < 4) shapeStr = '\\___';
            else if (s < 8) shapeStr = '/___';
            else shapeStr = shapes[s] || `0x${s}`;
            shapeStr = `[0x${s.toString(16).toUpperCase()}] ` + shapeStr;
        }
        document.getElementById('env-shape-val').innerText = shapeStr;

    } else {
        // C64 / AMIGA Fallback (Ausfallsicher!)
        for (let i = 0; i < currentChipRegs.length; i++) {
            if (!hudValElements[i]) continue; // Sicherheit: Verhindert Absturz beim schnellen Wechsel!
            let hexVal = currentChipRegs[i].toString(16).toUpperCase().padStart(2, '0');
            if (hudValElements[i].innerText !== hexVal) hudValElements[i].innerText = hexVal;
        }
    }
}

// --- ZONE 1: HIGH-PERFORMANCE OSZILLOSKOP, RASTERBARS & SPECTRUM ---
function initVisuals() {
    const canvas = document.getElementById('demo-canvas');
    const ctx = canvas.getContext('2d', { alpha: false }); 
    
    // Dynamischer Puffer-Speicher für das Oszilloskop
    let historyLength = canvas.width;
    let oscHistory = new Float32Array(historyLength).fill(NaN);
    let oscIndex = 0;

    // BUGFIX: Bewahrt die Oszilloskop-Welle beim Resize (Kein "Löschen" mehr!)
    function resizeCanvas() {
        const newWidth = canvas.clientWidth;
        const newHeight = canvas.clientHeight;
        
        if (canvas.width !== newWidth) {
            let oldHistory = oscHistory;
            let oldLen = oldHistory ? oldHistory.length : 0;
            
            canvas.width = newWidth; 
            canvas.height = newHeight;
            historyLength = canvas.width;
            
            oscHistory = new Float32Array(historyLength).fill(NaN);
            
            // Alte Welle nahtlos in den neuen Puffer retten!
            if (oldLen > 0) {
                let copyLen = Math.min(oldLen, historyLength);
                for (let i = 0; i < copyLen; i++) {
                    let oldVal = oldHistory[(oscIndex - copyLen + i + oldLen) % oldLen];
                    oscHistory[i] = oldVal;
                }
                oscIndex = copyLen % historyLength;
            }
        } else {
            canvas.height = newHeight; // Nur Höhe hat sich geändert
        }
    }
    
    // Initiales Setup und Resize-Event-Kopplung
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    let startTime = performance.now();
    let hudCounter = 0; 

    const bufferLength = analyserNode ? analyserNode.frequencyBinCount : 512;
    const dataArray = new Uint8Array(bufferLength);
    const barCount = 48; 
    const peaks = new Array(barCount).fill(0); 

    function drawCopperBar(yCenter, thickness, color1, color2) {
        let grad = ctx.createLinearGradient(0, yCenter - thickness, 0, yCenter + thickness);
        grad.addColorStop(0, `rgba(0,0,0,0)`); grad.addColorStop(0.2, color1);
        grad.addColorStop(0.5, `rgba(255,255,255, 1)`); grad.addColorStop(0.8, color2);
        grad.addColorStop(1, `rgba(0,0,0,0)`);
        ctx.fillStyle = grad; ctx.fillRect(0, yCenter - thickness, canvas.width, thickness * 2);
    }

    function draw() {

        // NEU: Wenn ECO Mode aktiv ist, zeichnen wir GAR NICHTS auf das Canvas!
        if (isEcoMode) {
            updateTimelineUI(); // Timeline soll natürlich weiterlaufen
            requestAnimationFrame(draw);
            return; // HIER BRECHEN WIR AB! GPU & CPU haben Pause!
        }

        let t = (performance.now() - startTime) * 0.001; 
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        let audioPunch = Math.abs(currentOscValue) * 40; 

        // NEU: Der Airbag! Falls der Audiochip crasht (NaN), retten wir das Canvas!
        if (isNaN(audioPunch) || !isFinite(audioPunch)) audioPunch = 0;

        const isAmiga = document.body.classList.contains('theme-amiga');
        const isAtari = document.body.classList.contains('theme-atari');
        
        let pal1 = isAtari ? ['#005500', '#00aa00'] : isAmiga ? ['#0000aa', '#0055ff'] : ['#352879', '#6c5eb5'];
        let pal2 = isAtari ? ['#555500', '#aaaa00'] : isAmiga ? ['#aa5500', '#ff8800'] : ['#aa0055', '#ff00aa'];
        let pal3 = isAtari ? ['#005555', '#00aaaa'] : isAmiga ? ['#5500aa', '#aa00ff'] : ['#555555', '#aaaaaa'];
        const lineColor = isAtari ? '#55ff55' : isAmiga ? '#ff8800' : '#6c5eb5';

        ctx.globalCompositeOperation = "screen"; 
        drawCopperBar((canvas.height / 2) + Math.sin(t * 1.2) * (canvas.height * 0.3), 25 + audioPunch, pal1[0], pal1[1]);
        drawCopperBar((canvas.height / 2) + Math.sin(t * 1.8 + 2.0) * (canvas.height * 0.35), 20 + (audioPunch * 0.8), pal2[0], pal2[1]);
        drawCopperBar((canvas.height / 2) + Math.sin(t * 1.5 + 4.0) * (canvas.height * 0.25), 15 + (audioPunch * 0.5), pal3[0], pal3[1]);
        ctx.globalCompositeOperation = "source-over";

        // --- 3. DAS OSZILLOSKOP ---
        oscHistory[oscIndex] = (trackData.length === 0) ? NaN : currentOscValue;
        oscIndex = (oscIndex + 1) % historyLength; 
        
        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        
        let isFirstPoint = true;
        for (let x = 0; x < historyLength; x++) {
            let actualIndex = (oscIndex + x) % historyLength; 
            let val = oscHistory[actualIndex];
            
            if (!isNaN(val)) {
                let y = (canvas.height / 2) - (val * (canvas.height * 0.4)); 
                if (isFirstPoint) {
                    ctx.moveTo(x, y);
                    isFirstPoint = false;
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        
        if (!isFirstPoint) {
            ctx.lineWidth = 6; ctx.globalAlpha = 0.3; ctx.stroke();
            ctx.lineWidth = 2; ctx.globalAlpha = 1.0; ctx.stroke();
        }

        // --- SPECTRUM ANALYZER ---
        if (analyserNode && isPlaying) {
            analyserNode.getByteFrequencyData(dataArray);
            let barWidth = (canvas.width / barCount) - 2;
            let x = 0;
            
            let hzPerBin = audioCtx.sampleRate / analyserNode.fftSize;
            let minBin = Math.max(1, Math.floor(50 / hzPerBin)); 
            let maxBin = Math.floor(12000 / hzPerBin); 
            let lastEndBin = minBin;
            
            for (let i = 0; i < barCount; i++) {
                let startBin = lastEndBin;
                let endBin = Math.floor(minBin * Math.pow(maxBin / minBin, (i + 1) / barCount));
                if (endBin <= startBin) endBin = startBin + 1;
                lastEndBin = endBin;
                
                let sum = 0;
                for (let b = startBin; b < endBin; b++) sum += dataArray[b];
                let avg = sum / (endBin - startBin);
                
                let heightBoost = 1.0 + (i / barCount) * 0.5;
                let barHeight = ((avg * heightBoost) / 255.0) * (canvas.height * 0.4);
                
                if (barHeight > peaks[i]) peaks[i] = barHeight; 
                else { peaks[i] -= 1.5; if (peaks[i] < 0) peaks[i] = 0; }
                
                ctx.fillStyle = lineColor; ctx.globalAlpha = 0.7;
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                
                if (peaks[i] > 2) {
                    ctx.globalAlpha = 1.0; ctx.fillStyle = '#ffffff';
                    ctx.fillRect(x, canvas.height - peaks[i] - 4, barWidth, 2);
                }
                x += barWidth + 2;
            }
            ctx.globalAlpha = 1.0;
        }

        hudCounter++;
        updateTimelineUI();
        if (hudCounter % 4 === 0) updateChipHUD();
        requestAnimationFrame(draw);
    }
    draw();
}

function initScroller() {
    const canvas = document.getElementById('scroller-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
    
    let offset = 0;          
    const speed = 2.5; 
    const baseGreets = " +++ AT LAST, THE ULTIMATE HTML5 MUSIC DISK IS COMPLETE +++ CODE & DSP MAGIK RUNNING AT A SOLID 50 HZ VBLANK +++ DEEP CHIP EMULATION VIA AUDIOWORKLETS +++ NO MP3, NO BULLSHIT, JUST PURE MATHEMATICS +++ GREETS FLY OUT TO ALL THE PIXEL PUSHERS, CYCLE CRUNCHERS AND WAVEFORM WIZARDS OUT THERE +++ TO EVERYONE WHO STILL KEEPS THE SPIRIT OF THE 8-BIT AND 16-BIT ERA ALIVE +++ TO THE TRUE LOVERS OF DEMOSCENE ART AND CHIPTUNE MAGIC +++ LET THE ANALOG FILTERS BURN +++ WRAP AROUND +++ ";
    
    function draw() {

        if (isEcoMode) {
            requestAnimationFrame(draw);
            return; // Scroller-Berechnung stoppen!
        }

        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const isAmiga = document.body.classList.contains('theme-amiga');
        const isAtari = document.body.classList.contains('theme-atari');
        
        ctx.fillStyle = isAtari ? '#55ff55' : isAmiga ? '#ff8800' : '#6c5eb5';
        ctx.font = isAmiga || isAtari ? "32px 'VT323', monospace" : "24px 'Press Start 2P', monospace";
        ctx.textBaseline = "middle";
        
        // BUGFIX: VT323-Metrik-Kompensation (zieht die tiefhängende Schrift sachte nach oben)
        let fontMetricOffset = (isAmiga || isAtari) ? -(canvas.height * 0.08) : 0;

        let fullText = currentScrollerText + baseGreets;
        const charWidth = ctx.measureText("A").width;
        let startX = canvas.width - offset;
        
        for (let i = 0; i < fullText.length; i++) {
            let x = startX + (i * charWidth);
            if (x > -50 && x < canvas.width + 50) {
                // BUGFIX: Amplituden weiter gestaucht (insg. max 22% Auslenkung) für sichere Pufferzonen
                let wave1 = Math.sin((x * 0.01) + (offset * 0.04)) * (canvas.height * 0.16); // Von 22% auf 16% gedämpft
                let wave2 = Math.cos((x * 0.02) + (offset * 0.07)) * (canvas.height * 0.06); // Von 8% auf 6% gedämpft
                ctx.fillText(fullText[i], x, (canvas.height / 2) + wave1 + wave2 + fontMetricOffset);
            }
        }
        offset = (offset + speed) > (charWidth * fullText.length + canvas.width) ? 0 : offset + speed;
        requestAnimationFrame(draw);
    }
    draw();
}

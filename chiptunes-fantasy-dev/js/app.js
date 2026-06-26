// =========================================================================
//                  CHIPTUNES FANTASY - MAIN APP CONTROLLER
// =========================================================================
// Orchestriert das Zusammenspiel zwischen UI, Audio-Modul und Grafik-Engines
// =========================================================================

// ==========================================
// 1. IMPORT DER MODULE
// ==========================================
import { trackRegistry } from '../tracks/registry.js';
import { systemDescriptions, chipCheatSheets } from './content/museum.js'; 
import { workletRegistry } from './worklets/registry.js';
import { initScroller } from './visuals/scroller.js'; 
import { initVisuals } from './visuals/visualizer.js'; 
import { updateChipHUD, resetHUD } from './ui/hud-debugger.js'; 
import { 
    initAudioEngine, 
    loadEmuCore, 
    resumeAudioContext,
    getAudioContext, 
    getAnalyserNode, 
    getMasterGain, 
    getYmNode, 
    getPaulaNode, 
    getSidNode 
} from './audio/audio-controller.js'; // Binäre Audio-Schnittstelle importiert

// ==========================================
// 2. GLOBALE APPLIKATIONS-VARIABLEN
// ==========================================
let currentOscValue = 0; 
let currentChipRegs = null; 
let activeSystem = 'atari';
let trackData = [];    
let currentFrame = 0;  
let isPlaying = false; 
let currentTrackIndex = 0;
let currentScrollerText = "+++ INITIALIZING DEMO ENGINE... +++";
let lastKnownFrame = 0; 
let previousFrame = 0;       // Merkt sich den vorherigen Frame für den Loop-Check
let lastTrackChangeTime = 0; // Der kugelsichere Cooldown-Timer
let isEcoMode = false;      // Status für den Pure Audio Mode
let isUserDragging = false; // Verhindert Slider-Zucken während des Ziehens
let currentSubsongIndex = 1; // Speichert das aktive C64-Subsong-Verzeichnis (1-basiert)

// ==========================================
// 3. BOOT- & INITIALISIERUNGS-SEQUENZ
// ==========================================
function initApp() {
    // Service-Worker für iOS-Homescreen-Standalone-Modus registrieren
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js')
                .then(reg => console.log('[PWA] Service Worker erfolgreich gekoppelt.', reg.scope))
                .catch(err => console.warn('[PWA] Service-Worker-Kopplung fehlgeschlagen.', err));
        });
    }

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
        
        // 1. Audio-Engine starten (Einmaliger Aufruf!)
        await initAudioEngine();
        
        // 2. Die 3 Standard-Prozessoren beim Booten auf dem virtuellen Mainboard einlöten!
        try {
            await loadEmuCore('atari', workletRegistry.atari[0], handleWorkletMessage);
            await loadEmuCore('c64', workletRegistry.c64[0], handleWorkletMessage);
            await loadEmuCore('amiga', workletRegistry.amiga[0], handleWorkletMessage);
        } catch (err) {
            console.error("[CRITICAL] Cores konnten beim Booten nicht geladen werden:", err);
        }
        
        // 3. BUGFIX: Wir übergeben die dynamischen Audio-Schnittstellen (Getters) anstatt der nicht deklarierten Variablen!
        initVisuals({
            getEcoMode: () => isEcoMode,
            getCurrentOscValue: () => currentOscValue,
            getTrackData: () => trackData,
            getAnalyserNode: getAnalyserNode,  // Importierten dynamic Getter direkt übergeben
            getIsPlaying: () => isPlaying,
            getAudioContext: getAudioContext  // Importierten dynamic Getter direkt übergeben
        }, {
            updateTimelineUI: () => updateTimelineUI(),
            updateChipHUD: () => updateChipHUD({
                getActiveSystem: () => activeSystem,
                getIsPlaying: () => isPlaying,
                getCurrentChipRegs: () => currentChipRegs
            })
        });
        
        initScroller(
            () => currentScrollerText, 
            () => isEcoMode
        ); 
        
        // System initialisieren, nun läuft der C64 fehlerfrei an!
        setTheme('theme-c64');
    });
}

if (document.readyState === 'loading') document.addEventListener("DOMContentLoaded", initApp);
else initApp();

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
    document.getElementById('time-current').innerText = formatTime(targetFrame);
});

progressSlider.addEventListener('change', (e) => {
    if (trackData.length === 0) return;
    const targetPercent = parseFloat(e.target.value);
    const targetFrame = Math.floor((targetPercent / 100) * trackData.length);
    
    lastKnownFrame = targetFrame;
    previousFrame = targetFrame;

    const seekMsg = { type: 'SEEK_TRACK', frame: targetFrame };
    const paulaNode = getPaulaNode();
    const sidNode = getSidNode();
    const ymNode = getYmNode();

    if (activeSystem === 'amiga' && paulaNode) {
        paulaNode.port.postMessage(seekMsg);
    } else if (activeSystem === 'c64' && sidNode) {
        sidNode.port.postMessage(seekMsg);
    } else if (ymNode) {
        ymNode.port.postMessage(seekMsg);
    }
});

// ==========================================
// 4. ASYNCHRONER WORKLET WORKER-DISPATCHER
// ==========================================
function handleWorkletMessage(e) {
    if (e.data.type === 'VISUAL_DATA') {
        currentOscValue = e.data.value;
        previousFrame = lastKnownFrame;
        lastKnownFrame = e.data.frame || 0; 
        currentChipRegs = e.data.regs; 

        // AUTO-ADVANCE (Playlist Jukebox Modus)
        if (isPlaying && trackData.length > 0) {
            if (previousFrame > trackData.length - 20 && lastKnownFrame < 10) {
                if (performance.now() - lastTrackChangeTime > 2000) {
                    lastTrackChangeTime = performance.now(); 
                    
                    if (activeSystem === 'c64' && trackData.isSidFile) {
                        const totalSongs = trackData.metadata.songs || 1;
                        if (currentSubsongIndex < totalSongs) {
                            changeC64Subsong(currentSubsongIndex + 1);
                            return; 
                        }
                    }

                    let nextIdx = (currentTrackIndex + 1) % trackRegistry[activeSystem].length;
                    console.log(`Track zu Ende! Wechsle automatisch zu Track ${nextIdx}...`);
                    selectAndPlayTrack(nextIdx, activeSystem);
                }
            }
        }
    }
    
    // Rote Digi-LED (Atari ST, Amiga, C64)
    if (e.data.type === 'DEBUG') {
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
}

// --- DYNAMISCHER SUBSONG-WECHSEL (C64) ---
function changeC64Subsong(subsongId) {
    const sidNode = getSidNode();
    if (activeSystem === 'c64' && trackData && trackData.isSidFile && sidNode) { 
        // Signalisiere der CPU das Umschalten des Subsongs im Audio-Thread samt neuer Länge!
        sidNode.port.postMessage({ 
            type: 'CHANGE_SUBSONG', 
            frame: subsongId,
            length: trackData.length 
        });
        currentSubsongIndex = subsongId;

        // Absicherung falls lengths undefiniert ist
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
}

// ==========================================
// 5. AUDIO PLAYBACK ORCHESTRIERUNG
// ==========================================
function startPlayback() {
    if (isPlaying || trackData.length === 0) return;
    resumeAudioContext().catch(e=>console.log(e)); // AudioContext über Wrapper aufwecken

    isPlaying = true;
    
    // BUGFIX: Weichenstellung unterstützt dynamic Objekte (SIDs) und Arrays (MODs/YMs) gleichermaßen!
    let isAmiga = (trackData[0] && trackData[0].isAmiga) || trackData.isAmigaFile;
    let isC64 = (trackData[0] && trackData[0].isC64) || trackData.isSidFile;
    
    const paulaNode = getPaulaNode();
    const sidNode = getSidNode();
    const ymNode = getYmNode();
    
    if (isAmiga) {
        if (paulaNode) paulaNode.port.postMessage({ type: 'PLAY_TRACK', track: trackData });
        else console.error("[CRITICAL] paulaNode ist undefined.");
    } else if (isC64) {
        if (sidNode) {
            if (trackData.isSidFile) {
                sidNode.port.postMessage(trackData); 
            } else {
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

function resumePlayback() {
    if (isPlaying || trackData.length === 0) return;
    resumeAudioContext().catch(e=>console.log(e));

    isPlaying = true;
    
    const paulaNode = getPaulaNode();
    const sidNode = getSidNode();
    const ymNode = getYmNode();

    if (activeSystem === 'amiga' && paulaNode) paulaNode.port.postMessage({ type: 'RESUME_TRACK' });
    else if (activeSystem === 'c64' && sidNode) sidNode.port.postMessage({ type: 'RESUME_TRACK' });
    else if (ymNode) ymNode.port.postMessage({ type: 'RESUME_TRACK' });
}

function stopPlayback() {
    if (!isPlaying) return;
    isPlaying = false;
    
    const paulaNode = getPaulaNode();
    const sidNode = getSidNode();
    const ymNode = getYmNode();

    if (ymNode) ymNode.port.postMessage({ type: 'STOP_TRACK' });
    if (paulaNode) paulaNode.port.postMessage({ type: 'STOP_TRACK' });
    if (sidNode) sidNode.port.postMessage({ type: 'STOP_TRACK' });
}

// ==========================================
// 6. PLAYLIST & INTERFACE-THEME LOGIK
// ==========================================
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

    const hudBody = document.getElementById('hud-body');
    if (hudBody) hudBody.classList.add('hidden');
    
    const hudMain = document.getElementById('chip-hud'); 
    if (hudMain) hudMain.classList.add('collapsed');     
    
    const hudToggleBtn = document.getElementById('btn-hud-toggle');
    if (hudToggleBtn) hudToggleBtn.innerText = '[+]';
    
    const infoBtn = document.getElementById('btn-hud-info');
    if (infoBtn) infoBtn.classList.add('hidden');

    trackData = [];
    currentTrackIndex = 0;
    currentChipRegs = null;
    
    resetHUD();
    
    document.getElementById('progress-slider').value = 0;
    document.getElementById('progress-slider').disabled = true;
    document.getElementById('time-current').innerText = "00:00";
    document.getElementById('time-total').innerText = "00:00";
    
    const subsongDisplay = document.getElementById('subsong-display');
    if (subsongDisplay) {
        subsongDisplay.classList.add('hidden');
        subsongDisplay.innerText = "";
    }
    
    renderCoreSelector(activeSystem);
}

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
    lastTrackChangeTime = performance.now();

    if (getAudioContext() && getAudioContext().state === 'suspended') {
        resumeAudioContext().catch(e => console.log("AudioContext resume blockiert:", e));
    }

    const songs = trackRegistry[system];
    if (!songs || !songs[index]) return; 

    stopPlayback();
    currentTrackIndex = index;
    const selectedSong = songs[index];
    
    lastKnownFrame = 0;
    previousFrame = 0; 
    
    resetHUD();

    document.getElementById('progress-slider').disabled = false;
    renderTracklist(system); 

    if (selectedSong.loadAsync) {
        const isAmigaSystem = (system === 'amiga');
        const isC64System = (system === 'c64');
        
        currentScrollerText = isAmigaSystem 
            ? "+++ DOWNLOADING AND PARSING BINARY AMIGA MODULE... +++"
            : (isC64System ? "+++ DOWNLOADING AND PARSING BINARY C64 PSID FILE... +++" : "+++ DOWNLOADING AND PARSING BINARY YM FILE... +++");
        
        try {
            let parsedFile = await selectedSong.loadAsync();
            
            if (isC64System) {
                trackData = parsedFile; 
                currentSubsongIndex = parsedFile.startSong || 1; 
                
                let sldbLengths = trackData.lengths || [180];
                let songLengthSeconds = sldbLengths[currentSubsongIndex - 1] || sldbLengths[0] || 180;
                trackData.length = songLengthSeconds * 50; 
                
                const subsongDisplay = document.getElementById('subsong-display');
                if (subsongDisplay) {
                    subsongDisplay.innerText = `[SUB ${currentSubsongIndex}/${parsedFile.metadata.songs}]`;
                    subsongDisplay.classList.remove('hidden');
                }
            } else {
                const subsongDisplay = document.getElementById('subsong-display');
                if (subsongDisplay) {
                    subsongDisplay.classList.add('hidden');
                    subsongDisplay.innerText = "";
                }

                trackData = parsedFile.frames; 
                trackData.digidrums = parsedFile.digidrums || [];
                
                if (isAmigaSystem) {
                    trackData.isAmigaFile = true; 
                    
                    const paulaNode = getPaulaNode();
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

            let dynamicHTML = `
                <div style="margin-top: 15px; padding: 10px 15px; background: rgba(0,0,0,0.2); border-left: 4px solid var(--highlight-color); position: relative;">
                    <p style="color: var(--highlight-color); margin-bottom: 8px;"><strong>[ BINARY FILE ANALYSIS ]</strong></p>
                    ${techInfo}
                </div>
            `;

            const systemText = (typeof systemDescriptions !== 'undefined' && systemDescriptions[system]) 
                ? systemDescriptions[system] 
                : '<p style="color: var(--text-color);">[ Museumdatenarchiv geladen, Beschreibung temporär nicht verfügbar ]</p>';

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

// ==========================================
// 8. FULLSCREEN & iOS COMPATIBILITY HACKS
// ==========================================
function enterPseudoFullscreen(visualZone) {
    visualZone.classList.add('pseudo-fullscreen');
    document.getElementById('btn-fullscreen').innerText = '[ EXIT ]';
    document.body.style.overflow = 'hidden'; // Scrollen der App im Hintergrund blockieren
    document.body.appendChild(visualZone);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
}

function exitPseudoFullscreen(visualZone) {
    visualZone.classList.remove('pseudo-fullscreen');
    document.getElementById('btn-fullscreen').innerText = '[ ⛶ ]';
    document.body.style.overflow = ''; // Scrollen wieder erlauben
    const demoContainer = document.getElementById('demo-container');
    const playbackBar = document.getElementById('playback-bar');
    if (demoContainer && playbackBar) {
        demoContainer.insertBefore(visualZone, playbackBar);
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
}

function toggleFullscreen() {
    const visualZone = document.getElementById('visual-zone');
    if (visualZone.classList.contains('pseudo-fullscreen')) {
        exitPseudoFullscreen(visualZone);
        return;
    }

    if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        return;
    }

    try {
        if (visualZone.requestFullscreen) {
            let promise = visualZone.requestFullscreen();
            if (promise && typeof promise.catch === 'function') {
                promise.catch((err) => {
                    console.log("Native fullscreen rejected by Safari, triggering iOS Fallback.", err);
                    enterPseudoFullscreen(visualZone);
                });
            }
        } else if (visualZone.webkitRequestFullscreen) {
            visualZone.webkitRequestFullscreen();
            setTimeout(() => {
                if (!document.webkitFullscreenElement && !visualZone.classList.contains('pseudo-fullscreen')) {
                    console.log("Legacy webkitRequestFullscreen failed, triggering iOS Fallback.");
                    enterPseudoFullscreen(visualZone);
                }
            }, 200);
        } else {
            enterPseudoFullscreen(visualZone);
        }
    } catch (err) {
        enterPseudoFullscreen(visualZone);
    }
}

function handleFullscreenChange() {
    const btn = document.getElementById('btn-fullscreen');
    const isNativeFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (isNativeFS) {
        btn.innerText = '[ EXIT ]';
    } else {
        const visualZone = document.getElementById('visual-zone');
        if (visualZone && !visualZone.classList.contains('pseudo-fullscreen')) {
            btn.innerText = '[ ⛶ ]';
        }
    }
    window.dispatchEvent(new Event('resize'));
}

// ==========================================
// 9. PURE AUDIO (ECO) MODE & WAKE LOCKS
// ==========================================
const noSleepVideo = document.createElement('video');
noSleepVideo.setAttribute('playsinline', '');
noSleepVideo.setAttribute('muted', '');
noSleepVideo.setAttribute('loop', '');
noSleepVideo.src = 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAAz5tb292AAAAbG12aGQAAAAA/8f/3v/H/+QAAALuAAAC7gABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAGGlvZHMAAAAAE//H/+QAAALuAAAC7gABAAAAAAABAAAAMXRyYWsAAABcdGtoZAAAAAD/x//e/8f/5AAAAAEAAAAAAAAC7gAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAgAAAAIAAAAgZWR0cwAAABBlbHN0AAAAAQAAAu4AAAAAAAEAAAAAAixtZGlhAAAAIG1kaGQAAAAA/8f/3v/H/+QAAALuAAAC7gABAAAAAAAxAAAAAAAvaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAIcbWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAcRzdGJsAAAAp3N0c2QAAAAAAAAAAQAAAJNhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAgACAEgAAABIAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAR//8AAAAxYXZjQwH0AAr/4QAZZ/QACq608AUBzgAAAwAABgAAAwivDxgXoAAAAQAAABhzdHRzAAAAAAAAAAEAAAABAAAC7gAAAABzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAHHN0c3oAAAAAAAAAAAAAAAEAAAAeAAAAFHN0Y28AAAAAAAAAAQAAADAAAAA0dWR0YQAAACxtZXRhAAAAAAAAAABoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAA';

let wakeLock = null;

async function enableEcoMode() {
    noSleepVideo.play().catch(e => console.warn('iOS Video-Hack blockiert:', e));
    isEcoMode = true;
    document.getElementById('eco-overlay').classList.remove('hidden');
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('[SYSTEM] Wake Lock aktiv. Bildschirm bleibt an.');
        }
    } catch (err) {
        console.warn(`Wake Lock API blockiert. Fallback läuft.`);
    }
}

async function disableEcoMode() {
    isEcoMode = false;
    document.getElementById('eco-overlay').classList.add('hidden');
    if (wakeLock !== null) {
        await wakeLock.release();
        wakeLock = null;
    }
    noSleepVideo.pause();
    window.dispatchEvent(new Event('resize'));
}

// ==========================================
// 10. EVENT-KOPPLUNGEN (BUTTONS & SLIDERS)
// ==========================================
document.getElementById('btn-play').addEventListener('click', () => {
    resumeAudioContext().catch(e=>console.log(e));
    if (isPlaying) {
        stopPlayback(); 
    } else {
        trackData.length === 0 ? selectAndPlayTrack(0, activeSystem) : resumePlayback();
    }
});

document.getElementById('btn-next').addEventListener('click', () => {
    resumeAudioContext().catch(e=>console.log(e));
    if (activeSystem === 'c64' && trackData && trackData.isSidFile) {
        const totalSongs = trackData.metadata.songs || 1;
        if (currentSubsongIndex < totalSongs) {
            changeC64Subsong(currentSubsongIndex + 1);
            return; 
        }
    }
    selectAndPlayTrack((currentTrackIndex + 1) % trackRegistry[activeSystem].length, activeSystem);
});

document.getElementById('btn-prev').addEventListener('click', () => {
    resumeAudioContext().catch(e=>console.log(e));
    if (activeSystem === 'c64' && trackData && trackData.isSidFile) {
        if (currentSubsongIndex > 1) {
            changeC64Subsong(currentSubsongIndex - 1);
            return;
        }
    }
    let prevIdx = currentTrackIndex - 1;
    if (prevIdx < 0) prevIdx = trackRegistry[activeSystem].length - 1;
    selectAndPlayTrack(prevIdx, activeSystem);
});

document.getElementById('volume-slider').addEventListener('input', (e) => {
    const masterGain = getMasterGain();
    if (masterGain) masterGain.gain.value = e.target.value;
});

document.getElementById('btn-hud-info').addEventListener('click', () => {
    const legend = document.getElementById('hud-legend');
    legend.innerHTML = chipCheatSheets[activeSystem]; 
    legend.classList.toggle('hidden');
});

document.getElementById('btn-hud-toggle').addEventListener('click', (e) => {
    const hud = document.getElementById('chip-hud'); 
    const body = document.getElementById('hud-body');
    const infoBtn = document.getElementById('btn-hud-info'); 
    const isHidden = body.classList.contains('hidden');
    
    if (isHidden) {
        body.classList.remove('hidden');
        infoBtn.classList.remove('hidden'); 
        hud.classList.remove('collapsed'); 
        e.target.innerText = '[-]'; 
    } else {
        body.classList.add('hidden');
        infoBtn.classList.add('hidden'); 
        hud.classList.add('collapsed'); 
        e.target.innerText = '[+]'; 
        
        const legend = document.getElementById('hud-legend');
        if (legend) legend.classList.add('hidden');
    }
});

document.getElementById('core-selector').addEventListener('change', async (e) => {
    stopPlayback();
    const coreIndex = e.target.value;
    const coreConfig = workletRegistry[activeSystem][coreIndex];
    document.getElementById('hud-content') ? document.getElementById('hud-content').innerText = "RE-WIRING DSP..." : null;
    await loadEmuCore(activeSystem, coreConfig, handleWorkletMessage);
    startPlayback(); 
});

document.getElementById('btn-eco').addEventListener('click', async () => {
    await resumeAudioContext();
    if (isEcoMode) {
        await disableEcoMode(); 
    } else {
        await enableEcoMode();  
    }
});

document.getElementById('btn-eco-off').addEventListener('click', async () => {
    await disableEcoMode();
});

document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
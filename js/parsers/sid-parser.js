// ==========================================
// C64 SID (PSID/RSID) BINARY FILE PARSER
// With On-The-Fly HVSC Songlength Database (SLDB)
// ==========================================

export async function loadSidFile(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Datei nicht gefunden: ${url}`);
    
    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    const view = new DataView(buffer);

    // 1. Verifiziere Magic Header (PSID / RSID)
    const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
    if (magic !== 'PSID' && magic !== 'RSID') {
        throw new Error("Ungültiges Dateiformat! Kein PSID- oder RSID-Header gefunden.");
    }

    // 2. Extrahiere Metadaten aus dem Header-Layout (Big Endian!)
    let version = view.getUint16(4, false);
    let dataOffset = view.getUint16(6, false);
    let loadAddress = view.getUint16(8, false);
    let initAddress = view.getUint16(10, false);
    let playAddress = view.getUint16(12, false);
    let songs = view.getUint16(14, false);
    let startSong = view.getUint16(16, false);
    let speed = view.getUint32(18, false); // Speed flags (32-bit)
    
    // Strings lesen (32 Bytes pro Feld, nullterminiert)
    let title = readString(data, 22, 32) || "Unknown SID";
    let author = readString(data, 54, 32) || "Unknown Composer";
    let released = readString(data, 86, 32) || "Unknown Year";

    // 3. Extrahiere den echten C64-Maschinencode (PRG)
    let prgStart = dataOffset;
    let fileLoadAddress = data[dataOffset] | (data[dataOffset + 1] << 8);

    if (loadAddress === 0) {
        // Falls Load-Adresse im Header 0 ist, ist sie am Anfang des PRG-Payloads hinterlegt
        loadAddress = fileLoadAddress;
        prgStart = dataOffset + 2; 
    } else {
        // Falls Load-Adresse im Header ungleich 0 ist, prüfen wir auf redundanten PRG-Header
        if (fileLoadAddress === loadAddress) {
            prgStart = dataOffset + 2;
        }
    }

    // Wenn initAddress im Header 0 ist, beginnt die Initialisierung direkt an der loadAddress!
    if (initAddress === 0) {
        initAddress = loadAddress;
    }

    // Der eigentliche 6502 Assembler-Code
    let c64Code = data.slice(prgStart);

    let metadata = {
        name: title.toUpperCase(),
        author: author.toUpperCase(),
        comment: `${released.toUpperCase()} • GENUINE BINARY PARSED C64 CODE`,
        type: `${magic} v${version} (6502 Emulator)`,
        songs: songs,
        startSong: startSong,
        loadAddress: `0x${loadAddress.toString(16).toUpperCase().padStart(4, '0')}`,
        initAddress: `0x${initAddress.toString(16).toUpperCase().padStart(4, '0')}`,
        playAddress: `0x${playAddress.toString(16).toUpperCase().padStart(4, '0')}`,
        fileSize: data.length
    };

    // --- 4. ON-THE-FLY HVSC SLDB ABFRAGE (Echte AJAX-Datenbank-Kopplung) ---
    let songLengthSeconds = 180; // Fallback: Standardmäßig 3:00 min bei unbekannten Custom-SIDs
    let allLengths = [180];
    
    try {
        // Songlengths.json dynamisch aus dem Web-Verzeichnis laden!
        const sldbResponse = await fetch('tracks/c64/songlengths.json');
        if (sldbResponse.ok) {
            const sldb = await sldbResponse.json();
            let filename = url.split('/').pop().toLowerCase().replace(".sid", "").replace(/[\s_-]/g, "");
            
            if (sldb[filename]) {
                allLengths = sldb[filename].lengths || [180];
                let subsongIdx = (startSong > 0 ? startSong - 1 : 0);
                songLengthSeconds = allLengths[subsongIdx] || allLengths[0] || 180;
            }
        }
    } catch (e) {
        console.warn("[SID PARSER] Konnte songlengths.json nicht laden, verwende Standard-Fallbacks.", e);
    }
    
    // Umrechnen der Sekundendauer in 50Hz-VBLANK-Frames
    let totalFrames = songLengthSeconds * 50;

    return {
        isSidFile: true,
        c64Code: c64Code, 
        loadAddress: loadAddress,
        initAddress: initAddress,
        playAddress: playAddress,
        startSong: startSong,
        speed: speed,
        lengths: allLengths, // Echte asynchron abgefragte Längenliste übergeben!
        length: totalFrames, 
        metadata: metadata
    };
}

// Hilfsfunktion zum Auslesen null-terminierter Strings
function readString(data, offset, maxLength) {
    let str = "";
    for (let i = 0; i < maxLength; i++) {
        let charCode = data[offset + i];
        if (charCode === 0) break;
        if (charCode >= 32 && charCode < 127) {
            str += String.fromCharCode(charCode);
        }
    }
    return str.trim();
}
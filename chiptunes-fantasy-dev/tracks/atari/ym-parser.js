// ==========================================
// YM BINARY FILE PARSER (YM3b / YM5! / YM6!)
// ==========================================

export async function loadYmFile(url) {
    console.log(`Lade YM-Datei: ${url} ...`);
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Datei nicht gefunden: ${url}`);
    
    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);

    // 1. SIGNATUR PRÜFEN
    const sig = String.fromCharCode(data[0], data[1], data[2], data[3]);
    console.log(`YM-Signatur erkannt: ${sig}`);

    // --- LHA KOMPRESSIONS-CHECK ---
    // Wenn an Position 2 der String "-lh5-" oder "-lh0-" steht, ist es ein Archiv!
    const lhaCheck = String.fromCharCode(data[2], data[3], data[4], data[5], data[6]);
    if (lhaCheck === '-lh5-' || lhaCheck === '-lh0-') {
        throw new Error("DATEI IST KOMPRIMIERT! Bitte öffne die .ym Datei lokal mit 7-Zip, entpacke sie, und nutze die unkomprimierte Datei, die herausfällt!");
    }

    let frames = 0;
    let regDataStart = 0;

    // 2. HEADER PARSEN
    if (sig === 'YM3!' || sig === 'YM3b') {
        frames = (data.length - 4) / 16;
        regDataStart = 4;
    } 
    else if (sig === 'YM5!' || sig === 'YM6!') {
        // YM5! Format (32-Bit Big Endian für die Frames)
        frames = (data[12] << 24) | (data[13] << 16) | (data[14] << 8) | data[15];
        
        // Anzahl der digitalen Drum-Samples auslesen
        let numDigidrums = (data[20] << 8) | data[21];
        
        let pos = 34; // Start der Digidrums
        
        // Digidrums überspringen (Wir emulieren vorerst nur die reinen YM-Register)
        for (let d = 0; d < numDigidrums; d++) {
            let sampleSize = (data[pos] << 24) | (data[pos+1] << 16) | (data[pos+2] << 8) | data[pos+3];
            pos += 4 + sampleSize;
        }

        // 3 Null-terminierte Strings überspringen (Song Name, Autor, Kommentar)
        let nulls = 0;
        while (nulls < 3 && pos < data.length) {
            if (data[pos] === 0) nulls++;
            pos++;
        }
        
        // Hier starten endlich unsere Musikdaten!
        regDataStart = pos;
    } 
    else {
        throw new Error(`Unbekanntes Dateiformat (${sig}). Ist das wirklich eine entpackte YM-Datei?`);
    }

    console.log(`Parsing erfolgreich. Frames: ${frames} (${(frames/50).toFixed(1)} Sekunden). Register starten bei Byte ${regDataStart}`);

    // 3. DE-INTERLEAVE (Die verschachtelten Register entwirren)
    let trackData = [];
    
    for (let i = 0; i < frames; i++) {
        let frame = new Uint8Array(14);
        // Die ersten 14 Register auslesen (Reg 14 und 15 sind Joystick-Ports, die ignorieren wir)
        for (let r = 0; r < 14; r++) {
            // Berechne die verschachtelte Position
            let bytePos = regDataStart + (r * frames) + i;
            
            // Sicherheits-Check, falls die Datei unerwartet zu Ende ist
            if (bytePos < data.length) {
                frame[r] = data[bytePos];
            } else {
                frame[r] = 0;
            }
        }
        trackData.push(frame);
    }

    return trackData;
}
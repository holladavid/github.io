// === js/parsers/mod-parser.js ===
// ==========================================
// AMIGA PROTRACKER (.MOD) COMPACT BINARY PARSER
// ==========================================

export async function loadModFile(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Datei nicht gefunden: ${url}`);
    
    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);

    let magic = String.fromCharCode(data[1080], data[1081], data[1082], data[1083]);
    let is31Instruments = false;
    
    if (magic === 'M.K.' || magic === 'M!K!' || magic === '4CHN' || magic === 'FLT4') {
        is31Instruments = true;
    } else {
        throw new Error(`Kein gültiges 4-Kanal ProTracker MOD-Format. Tag gefunden: ${magic}`);
    }

    let songName = "";
    for (let i = 0; i < 20; i++) {
        if (data[i] === 0) break;
        songName += String.fromCharCode(data[i]);
    }

    let samples = {};
    let sampleDataOffset = 1084;
    
    let songLength = data[950]; 
    let maxPattern = 0;
    for (let i = 0; i < 128; i++) {
        if (data[952 + i] > maxPattern) maxPattern = data[952 + i];
    }
    sampleDataOffset += (maxPattern + 1) * 1024;

    let loadedSamplesCount = 0;
    let currentSampleOffset = sampleDataOffset;

    for (let i = 0; i < 31; i++) {
        let offset = 20 + (i * 30);
        let sampleLenBytes = ((data[offset + 22] << 8) | data[offset + 23]) * 2;
        let finetune = data[offset + 24];
        let volume = data[offset + 25];
        let loopStart = ((data[offset + 26] << 8) | data[offset + 27]) * 2;
        let loopLen = ((data[offset + 28] << 8) | data[offset + 29]) * 2;

        if (sampleLenBytes > 2) {
            let floatData = new Float32Array(sampleLenBytes);
            for (let s = 0; s < sampleLenBytes; s++) {
                let signedByte = data[currentSampleOffset + s];
                if (signedByte > 127) signedByte -= 256;
                floatData[s] = signedByte / 128.0;
            }

            samples[`mod_sample_${i + 1}`] = {
                data: floatData,
                loopStart: loopStart,
                loopLen: loopLen,
                baseVolume: volume
            };
            loadedSamplesCount++;
            currentSampleOffset += sampleLenBytes;
        }
    }

    let metadata = {
        name: songName.trim() || "UNTITLED AMIGA TRACK",
        author: "UNKNOWN SCENER",
        comment: `COMPACT TRACKER BINARY PATTERNS LOADED`,
        type: `ProTracker 4-Channel`,
        instrumentCount: loadedSamplesCount,
        patternCount: maxPattern + 1,
        fileSize: data.length
    };

    // --- NEU: PATTERNS IN COMPACT STRUC-ARRAYS PARSEN (6 Bytes pro Zelle) ---
    const patternData = [];
    const numPatterns = maxPattern + 1;

    for (let p = 0; p < numPatterns; p++) {
        const pOffset = 1084 + (p * 1024);
        const cellBuffer = new Uint8Array(64 * 4 * 6); // 64 Rows, 4 Kanäle, 6 Bytes pro Zelle
        let dst = 0;

        for (let row = 0; row < 64; row++) {
            for (let ch = 0; ch < 4; ch++) {
                const src = pOffset + (row * 16) + (ch * 4);
                const b0 = data[src];
                const b1 = data[src + 1];
                const b2 = data[src + 2];
                const b3 = data[src + 3];

                const sample = (b0 & 0xF0) | (b2 >> 4);
                const period = ((b0 & 0x0F) << 8) | b1;
                const effect = b2 & 0x0F;
                const param = b3;

                // 6-Byte Cell Packing
                cellBuffer[dst]     = period & 0xFF;
                cellBuffer[dst + 1] = (period >> 8) & 0xFF;
                cellBuffer[dst + 2] = sample;
                cellBuffer[dst + 3] = 0xFF; // Kein Volume-Column Wert im Standard MOD-Format
                cellBuffer[dst + 4] = effect;
                cellBuffer[dst + 5] = param;
                dst += 6;
            }
        }

        patternData.push({
            numRows: 64,
            data: cellBuffer
        });
    }

    // Order Tabelle kopieren
    const orderTable = new Uint8Array(songLength);
    for (let i = 0; i < songLength; i++) {
        orderTable[i] = data[952 + i];
    }

    const defaultSpeed = 6;
    const estimatedFrames = songLength * 64 * defaultSpeed; // Zur Erhaltung der UI-Timeline

    return {
        isSequenced: true,
        type: 'MOD',
        songLength: songLength,
        orderTable: orderTable,
        patterns: patternData,
        bpm: 125,
        speed: defaultSpeed,
        numChannels: 4,
        length: estimatedFrames,
        metadata: metadata,
        samples: samples 
    };
}
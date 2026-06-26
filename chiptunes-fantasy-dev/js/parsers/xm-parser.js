// === js/parsers/xm-parser.js ===
// ==========================================
// FASTTRACKER II (.XM) COMPACT BINARY PARSER
// ==========================================

export async function loadXmFile(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Datei nicht gefunden: ${url}`);
    
    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    const view = new DataView(buffer);

    const magic = String.fromCharCode(...data.slice(0, 17));
    if (magic !== 'Extended Module: ') {
        throw new Error("Ungültiges Dateiformat! Kein FastTracker II XM-Header gefunden.");
    }

    let songName = String.fromCharCode(...data.slice(17, 37)).trim();
    let trackerName = String.fromCharCode(...data.slice(38, 58)).trim();
    
    let headerSize = view.getUint32(60, true);
    let songLength = view.getUint16(64, true);
    let numChannels = view.getUint16(68, true);
    let numPatterns = view.getUint16(70, true);
    let numInstruments = view.getUint16(72, true);
    
    let defaultSpeed = view.getUint16(76, true); 
    let defaultTempo = view.getUint16(78, true);
    
    let orderTable = new Uint8Array(songLength);
    for(let i=0; i<songLength; i++) orderTable[i] = data[80 + i];

    // 1. PATTERNS ZUERST PARSEN (Strikte Einhaltung der sequentiellen Dateistruktur!)
    let offset = 60 + headerSize;
    let patterns = [];

    for (let p = 0; p < numPatterns; p++) {
        let patHeaderLen = view.getUint32(offset, true);
        let numRows = view.getUint16(offset + 5, true);
        let packedSize = view.getUint16(offset + 7, true);
        
        let ptr = offset + patHeaderLen;
        const cellBuffer = new Uint8Array(numRows * numChannels * 6);
        let dst = 0;
        
        for (let r = 0; r < numRows; r++) {
            for (let c = 0; c < numChannels; c++) {
                let note=0, smp=0, vol=0, eff=0, param=0;
                if (packedSize > 0) {
                    let b = data[ptr++];
                    if (b & 0x80) {
                        if (b & 0x01) note = data[ptr++];
                        if (b & 0x02) smp = data[ptr++];
                        if (b & 0x04) vol = data[ptr++];
                        if (b & 0x08) eff = data[ptr++];
                        if (b & 0x10) param = data[ptr++];
                    } else {
                        note = b;
                        smp = data[ptr++];
                        vol = data[ptr++];
                        eff = data[ptr++];
                        param = data[ptr++];
                    }
                }
                
                // Volume Column Byte Dekompression
                let volVal = 0xFF; 
                if (vol >= 0x10 && vol <= 0x50) {
                    volVal = vol - 0x10;
                }
                
                // Wir speichern die rohe Note (0-97) direkt in den Period-Bytes ab (16-Bit)
                // Das Worklet rechnet dies später zur Laufzeit zusammen mit relNote in Frequenzen um.
                cellBuffer[dst]     = note & 0xFF;
                cellBuffer[dst + 1] = 0; // High-Byte ungenutzt für Note
                cellBuffer[dst + 2] = smp;
                cellBuffer[dst + 3] = volVal;
                cellBuffer[dst + 4] = eff;
                cellBuffer[dst + 5] = param;
                dst += 6;
            }
        }
        
        patterns.push({
            numRows: numRows,
            data: cellBuffer
        });
        offset += patHeaderLen + packedSize;
    }

    // 2. INSTRUMENTE & DELTA-SAMPLES ERST DANACH PARSEN (Genau hinter den Patterns)
    let samples = {};
    let loadedSamplesCount = 0;

    for (let i = 1; i <= numInstruments; i++) {
        let instHeaderSize = view.getUint32(offset, true);
        let numSamples = view.getUint16(offset + 27, true);
        
        if (numSamples > 0) {
            let sampleHeaderSize = view.getUint32(offset + 29, true);
            let shOffset = offset + instHeaderSize;
            let sampleHeaders = [];
            
            for (let s = 0; s < numSamples; s++) {
                sampleHeaders.push({
                    length: view.getUint32(shOffset, true),
                    loopStart: view.getUint32(shOffset+4, true),
                    loopLen: view.getUint32(shOffset+8, true),
                    vol: view.getUint8(shOffset+12),
                    finetune: view.getInt8(shOffset+13),
                    type: view.getUint8(shOffset+14),
                    relNote: view.getInt8(shOffset+16),
                });
                shOffset += sampleHeaderSize;
            }
            
            let sDataOffset = shOffset;
            for (let s = 0; s < numSamples; s++) {
                let sh = sampleHeaders[s];
                if (sh.length > 0) {
                    let is16Bit = (sh.type & 16) !== 0;
                    let isLoop = (sh.type & 3) !== 0;
                    
                    let floatData = new Float32Array(is16Bit ? sh.length/2 : sh.length);
                    let old = 0;
                    
                    if (is16Bit) {
                        for(let j=0; j<sh.length/2; j++) {
                            let v = view.getInt16(sDataOffset, true);
                            sDataOffset += 2;
                            old = (old + v) & 0xFFFF;
                            let signed = old < 32768 ? old : old - 65536;
                            floatData[j] = signed / 32768.0;
                        }
                    } else {
                        for(let j=0; j<sh.length; j++) {
                            let v = view.getInt8(sDataOffset);
                            sDataOffset += 1;
                            old = (old + v) & 0xFF;
                            let signed = old < 128 ? old : old - 256;
                            floatData[j] = signed / 128.0;
                        }
                    }
                    
                    samples[`xm_sample_${i}`] = {
                        data: floatData,
                        loopStart: is16Bit ? sh.loopStart/2 : sh.loopStart,
                        loopLen: isLoop ? (is16Bit ? sh.loopLen/2 : sh.loopLen) : 0,
                        baseVolume: sh.vol,
                        relNote: sh.relNote
                    };
                    loadedSamplesCount++;
                }
            }
            offset = sDataOffset;
        } else {
            offset += instHeaderSize;
        }
    }

    const estSpeed = defaultSpeed > 0 ? defaultSpeed : 6;
    const estBpm = defaultTempo > 0 ? defaultTempo : 125;

    return {
        isSequenced: true,
        type: 'XM',
        songLength: songLength,
        orderTable: orderTable,
        patterns: patterns,
        bpm: estBpm,
        speed: estSpeed,
        numChannels: numChannels,
        length: songLength * 64 * estSpeed,
        metadata: {
            name: songName || "UNTITLED XM TRACK",
            author: trackerName,
            comment: `COMPACT NATIVE XM SEQUENCED IN AUDIOWORKLET`,
            type: `FastTracker II (${numChannels}-Channel)`,
            instrumentCount: loadedSamplesCount,
            patternCount: numPatterns,
            fileSize: data.length
        },
        samples: samples 
    };
}
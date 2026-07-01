// === tracks/atari/external.js ===
// ==========================================
// Atari ST YM2149 Jukebox Playlist Registry
// Curated Legendary Showcase Edition + Full Archive
// ==========================================

import { loadYmFile } from '../../js/parsers/ym-parser.js';

const myYmFiles = [
    // --- SPOTLIGHT TRACKS (Die legendären 5) ---
    "thalion_loader.YM",           
    "SyntaxTerror.YM",             
    "UnionDemo_Mega_Apocalypse.YM",
    "BIONIC1.YM",                  
    "Dragonflight_City_1.YM",      
    
    // --- EXTENDED ARCHIVE (Die restlichen Dumps) ---
    "turrican1_world_1_1.YM",      
    "Turrican2_TheDesertRocks.YM",
    "WINGLEV1.YM",               
    "WINGLEV2.YM",
    "WINGLEV3.YM",
    "WINGLEV4.YM",
    "WINGLEV5.YM",
    "WINGLEV6.YM",
    "WINGLEV7.YM",
    "WINGLEV8.YM",
    "WINGLEV9.YM",
    "WINGLOAD.YM",
    "GOLDRUN.YM",
    "spherical_intro.YM",
    "Dragonflight_Title.YM",
    "Dragonflight_City_2.YM",
    "Dragonflight_City_3.YM",
    "Dragonflight_unspec.YM",
    "EnchantedLands_Intro.YM",
    "Giana_Title.YM",
    "Giana_InGame1.YM",
    "Giana_InGame2.YM",
    "Giana_InGame3.YM",
    "Giana_Bonus.YM",
    "Giana_Highscore.YM",
    "C64_Convertion_Shades_Giana.YM",
    "UnionDemo_Level_16_Fullscreen.YM",
    "UnionDemo_ThatsTheWayItIs.YM",
    "UnionDemo_NinjaRemix.YM",
    "UnionDemo_Thundercats.YM",
    "UnionDemo_ChildrenSongs.YM",
    "UnionDemo_Pandora.YM",
    "UndionDemo_ThinkTwice.YM",
    "UnionDemo_ProBMX.YM",
    "UnionDemo_AlloyRun.YM",
    "UnionDemo_Cybernoid.YM",
    "SyntaxTerror_tex.YM",
    "SyntaxTerror_tlb.YM"
];

const composerMetadata = {
    "thalion_loader.YM": `
        <h3>[ COMPOSER SPOTLIGHT: JOCHEN HIPPEL (MAD MAX) ]</h3>
        <p><strong>Jochen Hippel</strong> (Mad Max) von der Demogruppe <em>The Carebears</em> ist der unumstrittene Meister des Yamaha YM2149. Während die meisten Musiker den Chip für seine starren Rechteckwellen hassten, bog Hippel ihn durch brachiale CPU-Programmierung nach seinem Willen.</p>
        <p><strong>DSP-Fokus:</strong> Der <em>Thalion Loader</em> demonstriert die berühmten "Hippel-Arpeggios". Statt einfache Noten zu spielen, feuert die CPU über Timer-Interrupts winzige 5-Bit-Hardware-Envelopes ab. Unser 2MHz Lockstep-Core berechnet dieses "Zipper-Noise" exakt auf dem Hardware-Divider, was dem Track sein legendäres, kratziges Schimmern verleiht.</p>
    `,
    "SyntaxTerror.YM": `
        <h3>[ COMPOSER SPOTLIGHT: BIG ALEC (DELTA FORCE) ]</h3>
        <p><strong>Big Alec</strong> pfeift auf sanfte Emulationen. Er umarmte den rohen, aggressiven Charakter des Atari ST. Sein Track zur wegweisenden <em>Syntax Terror</em> Megademo ist eine Masterclass in treibendem Chiptune-Minimalismus.</p>
        <p><strong>DSP-Fokus:</strong> Achte auf die extrem tiefen, unaufhaltsamen Basslines. Big Alec kombiniert hier nackte, drückende Rechteckwellen mit rasanten Oktav-Sprüngen im 50Hz-Raster. Dank unseres Sinc-FIR Anti-Aliasing-Filters bleibt der Bassdruck selbst bei höchsten Amplituden vollkommen frei von digitalem Klirren.</p>
    `,
    "UnionDemo_Mega_Apocalypse.YM": `
        <h3>[ COMPOSER SPOTLIGHT: ROB HUBBARD / MAD MAX ]</h3>
        <p>Für die legendäre <em>The Union Demo</em> portierte Jochen Hippel die größten C64-Klassiker auf den Atari ST. Rob Hubbards <em>Mega Apocalypse</em> auf einem Chip zum Laufen zu bringen, der gar keine eingebauten PCM-Wandler besitzt, war reine Hexerei.</p>
        <p><strong>DSP-Fokus:</strong> Hier spielen die <strong>Digidrums</strong> die Hauptrolle. Der YM-Chip wird über den CPU-Timer Tausende Male pro Sekunde "gehackt", um rohe Audiodaten in das 4-Bit-Lautstärkeregister zu schreiben. Unsere Audio-Engine injiziert diese PCM-Daten physisch in das logarithmische Yamaha DAC-Widerstandsnetzwerk, was den Drums ihren unfassbar brutalen 4-Bit-Grit verleiht.</p>
    `,
    "BIONIC1.YM": `
        <h3>[ COMPOSER SPOTLIGHT: TIM FOLLIN ]</h3>
        <p><strong>Tim Follin</strong> ist ein britischer Programmier-Gott, der die Atari ST Architektur an ihr absolutes Limit trieb. Sein Soundtrack zu <em>Bionic Commando</em> verbrauchte so viel CPU-Zeit, dass das restliche Spiel spürbar ruckelte – aber es klang unglaublich.</p>
        <p><strong>DSP-Fokus:</strong> Follin nutzt hier "Software-Envelopes", die weit jenseits der normalen 50Hz-Bildwiederholrate operieren. Durch verschachtelte Zählerschleifen erzeugt er Phasenverschiebungen und Phasing-Effekte, die auf einem YM-Chip eigentlich physikalisch unmöglich sein sollten.</p>
    `,
    "Dragonflight_City_1.YM": `
        <h3>[ COMPOSER SPOTLIGHT: JOCHEN HIPPEL (HIGH FANTASY) ]</h3>
        <p>Neben harten Demo-Beats konnte <strong>Jochen Hippel</strong> auch epische, orchestrale RPG-Welten auf dem YM2149 erschaffen, wie dieser Track aus dem Thalion-Meisterwerk <em>Dragonflight</em> beweist.</p>
        <p><strong>DSP-Fokus:</strong> Um voluminöse Flöten und Streicher zu simulieren, Hippel koppelte das "Weiße Rauschen" (Noise) des Chips extrem subtil mit den regulären Tönen. In unserem Core wird das Noise-LFSR mit exakt 17 Bit auf der 2-MHz-Ebene geschoben, wodurch das Rauschen seinen charakteristischen "hölzernen", fast schon atonalen Atari-Charakter erhält.</p>
    `
};

export const atariPlaylist = myYmFiles.map((filename, index) => {
    const metaInfo = composerMetadata[filename] || `
        <h3>[ CLASSIC ATARI ST YM2149F ]</h3>
        <p>Ein historischer YM-Register-Dump (YM5/YM6). Dieses Format enthält die rohen Hardware-Befehle, die ursprünglich 50-mal pro Sekunde an den Soundchip geschickt wurden, verarbeitet durch unsere zyklengenaue 2MHz-Emulation.</p>
    `;

    return {
        title: `${index + 1}. LOAD YM: ${filename}`,
        composerInfo: metaInfo,
        generator: function() { return []; },
        loadAsync: async function() {
            return await loadYmFile(`tracks/atari/${filename}`);
        }
    };
});
import { loadYmFile } from '../../js/parsers/ym-parser.js';

// HIER EINFACH ALLE DATEINAMEN EINTRAGEN, DIE IN DEINEM ORDNER LIEGEN!
const myYmFiles = [
    "thalion_loader.YM",           // Dein erster Test-Song
    "turrican1_world_1_1.YM",      // Lade hier deine entpackten Lieblingstracks rein...
    "WINGLEV1.YM",               // ...
    'WINGLEV2.YM',
    'WINGLEV3.YM',
    'WINGLEV4.YM',
    'WINGLEV5.YM',
    'WINGLEV6.YM',
    'WINGLEV7.YM',
    'WINGLEV8.YM',
    'WINGLEV9.YM',
    'WINGLOAD.YM',
    "GOLDRUN.YM",
    "spherical_intro.YM",
    "BIONIC1.YM",
    "Dragonflight_Title.YM",
    "Dragonflight_City_1.YM",
    "Dragonflight_City_2.YM",
    "Dragonflight_City_3.YM",
    'Dragonflight_unspec.YM',
    'EnchantedLands_Intro.YM',
    'Giana_Title.YM',
    'Giana_InGame1.YM',
    'Giana_InGame2.YM',
    'Giana_InGame3.YM',
    'Giana_Bonus.YM',
    'Giana_Highscore.YM',
    'C64_Convertion_Shades_Giana.YM',
    'UnionDemo_Level_16_Fullscreen.YM',
    'UnionDemo_Mega_Apocalypse.YM',
    'UnionDemo_ThatsTheWayItIs.YM',
    'UnionDemo_NinjaRemix.YM',
    'UnionDemo_Thundercats.YM',
    'UnionDemo_ChildrenSongs.YM',
    'UnionDemo_Pandora.YM',
    'UndionDemo_ThinkTwice.YM',
    'UnionDemo_ProBMX.YM',
    'UnionDemo_AlloyRun.YM',
    'UnionDemo_Cybernoid.YM',
    'SyntaxTerror.YM',
    'SyntaxTerror_tex.YM',
    'SyntaxTerror_tlb.YM'
];

// Wir generieren mit .map() automatisch für jeden Namen einen fertigen Track-Eintrag!
export const externalYmTracks = myYmFiles.map((filename, index) => {
    return {
        title: `${index + 3}. LOAD ORIGINAL: ${filename}`,
        composerInfo: ``, // Bleibt leer, die app.js übernimmt jetzt!
        generator: function() { return []; },
        loadAsync: async function() {
            return await loadYmFile(`tracks/atari/${filename}`);
        }
    };
});
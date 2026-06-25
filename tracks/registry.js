import { hubbardTrack } from './c64/hubbard.js';
import { galwayTrack } from './c64/galway.js';
import { externalSidTracks } from './c64/external.js'; // NEU: Der binäre SID-Lader

import { hippelTrack } from './atari/hippel.js';
import { bigAlecTrack } from './atari/bigalec.js';
import { externalYmTracks } from './atari/external.js'; 

import { jesterTrack } from './amiga/jester.js'; 
import { externalModTracks } from './amiga/mods.js'; // Geladen statt der veralteten HIPC-Version

export const trackRegistry = {
    // Echte SIDs in die C64-Schiene einhängen!
    c64: [ hubbardTrack, galwayTrack, ...externalSidTracks ],
    
    atari: [ hippelTrack, bigAlecTrack, ...externalYmTracks ], 
    amiga: [ jesterTrack, ...externalModTracks ]
};
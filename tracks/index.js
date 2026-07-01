// === tracks/index.js ===
// ==========================================
// CENTRAL TRACK PLAYLIST REGISTRY
// ==========================================

import { c64Playlist } from './c64/playlist.js'; 
import { atariPlaylist } from './atari/playlist.js'; 
import { amigaPlaylist } from './amiga/playlist.js'; 

export const trackRegistry = {
    c64: [ ...c64Playlist ],
    atari: [ ...atariPlaylist ], 
    amiga: [ ...amigaPlaylist ]
};
import type { LoreEntryDef } from '../core/types';

export const LOOP_LORE_ENTRIES: LoreEntryDef[] = [
  {
    id: 'loop-sundering',
    thread: 'loop',
    stage: 'Prologue',
    title: 'The Moon That Held The War',
    summary: 'The Mad Moon was not a moon first. It was a prison.',
    body: 'Before the world had lanes or crowns, the Primordial Mind broke into powers that could not stop fighting. Zet sealed the Radiant and the Dire inside the Mad Moon, but the war destroyed its prison from within. Every shard that fell still carries a piece of that endless fight.',
    unlock: { kind: 'start' }
  },
  {
    id: 'loop-echoes',
    thread: 'loop',
    stage: 'Act I - Lunar',
    title: 'Echoes In The Shards',
    summary: 'An Echo is not a ghost. It is a remembered champion.',
    body: 'The Lunar Badge proves the first truth of binding: the figures in the shards are wars the Loop has already fought. Defeating an Echo does not kill a hero. It resolves a memory long enough for that champion to ride with you.',
    unlock: { kind: 'badge', badgeId: 'lunar-badge' }
  },
  {
    id: 'loop-tightening',
    thread: 'loop',
    stage: 'Act II - Frost',
    title: 'The Ringing Ice',
    summary: 'The shards are getting louder because the Loop is tightening.',
    body: 'Icewrack keeps the sound of impact better than any temple. Each bell-note in the cliffs is a cycle striking the next one, closer and harder, until even the Blueheart wardens can hear that the world is not winding down. It is winding shut.',
    unlock: { kind: 'badge', badgeId: 'frost-badge' }
  },
  {
    id: 'loop-buried-cycle',
    thread: 'loop',
    stage: 'Act III - Burrow',
    title: 'A Kingdom Under Sand',
    summary: 'The desert shows what happens when a cycle loses.',
    body: 'Devarshi is not only ancient. It is familiar. Its buried roads, star-metal, and scarab courts are the remains of a turn of the Loop that already ended badly. The Burrow Badge is struck from proof that even kingdoms can become echoes.',
    unlock: { kind: 'badge', badgeId: 'burrow-badge' }
  },
  {
    id: 'loop-old-feuds',
    thread: 'loop',
    stage: 'Act IV - Tide',
    title: 'The Same War Wearing Names',
    summary: 'Some rivalries survive because the world keeps resetting them.',
    body: 'At Shadeshore, captain and leviathan, admiral and reef, oath and hunger keep finding new bodies. The drowned bells do not remember one duel. They remember the shape of conflict itself, re-fought until someone learns how to carry it without becoming it.',
    unlock: { kind: 'badge', badgeId: 'tide-badge' }
  },
  {
    id: 'loop-thin-world',
    thread: 'loop',
    stage: 'Act V - Rot',
    title: 'Where The Seal Thins',
    summary: 'The Sundering did not only scatter stone. It weakened the edges of the world.',
    body: 'The Vile Reaches rot because the prison did not break cleanly. Foulfell, rifts, and claimants from beyond the local war press against the wound. They do not come for gold or territory. They come because a world with an Ancient at its heart is worth invading.',
    unlock: { kind: 'badge', badgeId: 'rot-badge' }
  },
  {
    id: 'loop-scholars',
    thread: 'loop',
    stage: 'Act VI - Arcane',
    title: 'The Scholars Name It',
    summary: 'Quoidge gives the war its real name: the Loop.',
    body: 'The city of disputing towers has measured what the faithful only felt. Ancient falls, timeline resets, champions return, and the contest begins again. Avaryn reached the crater before you and chose to rule that cycle instead of ending it.',
    unlock: { kind: 'badge', badgeId: 'arcane-badge' }
  },
  {
    id: 'loop-before-heroes',
    thread: 'loop',
    stage: 'Act VII - Wild',
    title: 'Before There Were Heroes',
    summary: 'The forest remembers a world before the Ancients gave every force a banner.',
    body: 'The Hidden Wood is older than draft halls, crowns, and hero names. Its camps answer because the wild has been conscripted into the same struggle for too many cycles. Here the question sharpens: are you gathering the Moon to command the war, or to release the world under it?',
    unlock: { kind: 'badge', badgeId: 'wild-badge' }
  },
  {
    id: 'loop-fundamentals',
    thread: 'loop',
    stage: 'Act VIII - Titan',
    title: 'The First Division',
    summary: 'Mount Joerlak tests whether you can stand near the forces that split creation.',
    body: 'The Titan Badge is not a summit prize. It is permission to approach the crater. Elder powers, Fundamentals, and the old split in creation all echo here, warning that reuniting what was divided is not mercy by default. Some fractures are prisons. Some are protections.',
    unlock: { kind: 'badge', badgeId: 'titan-badge' }
  },
  {
    id: 'loop-tower',
    thread: 'loop',
    stage: 'Climax',
    title: 'The Tower Remembers You',
    summary: 'Avaryn ruled the cycle. You reached the choice beneath it.',
    body: 'At the Mad Moon Crater, Roshan waits below and the Tower of the Ancients waits above. Avaryn wore two crowns and held the game in place. When she falls, Zet\'s old question finally reaches your hands: reunite the broken Moon, rule the eternal war, or break the Loop and let the world remember something new.',
    unlock: { kind: 'champion' }
  }
];

export const ALL_LORE_ENTRIES: LoreEntryDef[] = [...LOOP_LORE_ENTRIES];

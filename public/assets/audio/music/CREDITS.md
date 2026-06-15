# Music credits

The biome music beds are curated tracks from the album **"Soundworlds Histories:
Chasing the Leviathan"** by **John Oestmann** (jomusic), released into the
**Public Domain / CC0**. No attribution is required; it is provided here as
courtesy.

Source: https://opengameart.org/content/chasing-the-leviathan-adventure-world-music-album

| File | Original track | Biome |
|------|----------------|-------|
| `grass.ogg` | Sun Cave Village | Tranquil Vale / grassland |
| `forest.ogg` | Forgotten Shrine in the Forest | forest |
| `snow.ogg` | Moon Cave | Icewrack / snow |
| `desert.ogg` | Orion's Geology Workshop | Devarshi Desert |
| `wasteland.ogg` | Skypole Gorge | Vile Reaches / wasteland |
| `coast.ogg` | Lake Aria | Shadeshore / coast |

These replace the previous procedurally-generated synth drone beds (which read
as a constant "hum"). The in-engine synth bed (`src/engine/audio.ts`
`startMusic`) remains only as a fallback floor for the brief decode gap and for
low graphics tiers where sampled audio is disabled.

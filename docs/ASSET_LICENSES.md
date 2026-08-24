# Asset Licenses

All runtime assets in this project are local files. No API key or expiring remote URL is shipped to the browser.

| Runtime path | Source | Creator | License | Use |
| --- | --- | --- | --- | --- |
| `public/assets/models/kaykit-adventurers/Rogue_Kid.glb` | KayKit Adventurers Character Pack 2.0 | Kay Lousberg | CC0 1.0 | Child and sensing-doll visual; the authoritative collider remains a separate circle |
| `public/assets/models/kaykit-medieval/wall_straight.glb` | KayKit Medieval Builder Pack 1.0 | Kay Lousberg | CC0 1.0 | Retained visual candidate; the current runtime deliberately keeps procedural box walls and does not request this file |
| `public/assets/models/kaykit-furniture/*` | KayKit Furniture Bits 1.0 FREE | Kay Lousberg | CC0 1.0 | Grounded room furniture and rugs; visual-only placement leaves the authoritative map and collision unchanged |
| `public/assets/audio/kenney/guard-pounce.mp3` | Kenney Impact Sounds | Kenney | CC0 1.0 | Ghost capture windup |
| `public/assets/audio/kenney/kid-captured.mp3` | Kenney Impact Sounds | Kenney | CC0 1.0 | Successful capture |
| `public/assets/audio/kenney/picked-01.mp3` | Kenney Interface Sounds | Kenney | CC0 1.0 | Battery collected |
| `public/assets/audio/kenney/match-ended.mp3` | Kenney Interface Sounds | Kenney | CC0 1.0 | Match result |
| `public/assets/audio/kenney/pick-started.mp3` | Kenney Interface Sounds | Kenney | CC0 1.0 | Local flashlight activation |
| `public/assets/audio/opengameart/ghost-burn-scream.mp3` | [OpenGameArt: Scary High-pitched Ghost](https://opengameart.org/content/scary-high-pitched-ghost) | Fupi | CC0 1.0 | Ghost burn scream; 1.5 s mono excerpt, mobile-presence EQ, compression, and fades |
| `public/assets/audio/freesound/thunder-01.mp3` | [Freesound 436790](https://freesound.org/people/roboroo/sounds/436790/) | roboroo | CC0 1.0 | Near thunder variant; onset trimmed by 0.30 s, mobile-band EQ/compression, mono, −12 LUFS, 3.74 s with fade-out |
| `public/assets/audio/freesound/thunder-02.mp3` | [Freesound 672776](https://freesound.org/people/DaniloSFX/sounds/672776/) | DaniloSFX | CC0 1.0 | Rolling thunder variant; onset trimmed by 0.15 s, mobile-band EQ/compression, mono, −12 LUFS, 5.54 s with fade-out |
| `public/assets/audio/freesound/thunder-03.mp3` | [Freesound 397952](https://freesound.org/people/Kinoton/sounds/397952/) | Kinoton | CC0 1.0 | Distant thunder variant; onset trimmed by 0.15 s, mobile-band EQ/compression, mono, −12 LUFS, 5.54 s with fade-out |

The original license texts are copied beside the assets:

- `public/assets/models/kaykit-adventurers/LICENSE.txt`
- `public/assets/models/kaykit-medieval/LICENSE.txt`
- `public/assets/models/kaykit-furniture/LICENSE.txt`
- `public/assets/audio/kenney/LICENSE-impact-sounds.txt`
- `public/assets/audio/kenney/LICENSE-interface-sounds.txt`
- `public/assets/audio/freesound/LICENSE-CC0-1.0.txt`
- `public/assets/audio/opengameart/LICENSE-CC0-1.0.txt`

## Intake metrics

| Asset | File size | Geometry / clips | Materials / textures |
| --- | ---: | --- | --- |
| Rogue Kid | 503,252 bytes | 7 meshes, about 7,562 triangles; `Idle_A`, `Running_A`, `PickUp`, `Hit_A`, each 1 second | 1 material, one embedded 256 × 256 PNG texture |
| KayKit straight wall | 28,752 bytes | 1 mesh, 478 triangles, no animation | 1 material, no texture |
| Selected KayKit furniture library | 310,198 runtime bytes | 17 unique meshes, about 6,098 source triangles; 34 visual-only room placements | 3 shared room-family materials, one shared 1024 × 1024 gradient-atlas PNG |
| Five Kenney MP3 files | 13,994 bytes total | short one-shot SFX, no loops | decoded after a user gesture |
| Three Freesound thunder MP3 files | 238,368 bytes total | 3.74–5.54 second one-shot weather SFX, no loops | 44.1 kHz mono, mobile-band EQ/compression at −12 LUFS; decoded from the single JSON audio pack after a user gesture |
| One OpenGameArt burn scream MP3 | 25,121 bytes | 1.5 second one-shot vocal SFX, no loop | 44.1 kHz mono; mobile-presence EQ and compression; decoded from the existing single JSON audio pack after a user gesture |

The complete KayKit house model was evaluated but not copied: its roof and authored footprint would obscure the top-down interior and diverge from the nine-room collision map. Furniture source material/image references were removed from the individual glTF files so all instances share one runtime atlas and three room-family materials. Geometry buffers use the `.meshdata` suffix because local browser download-manager extensions can intercept `.bin` requests before Three.js receives them.

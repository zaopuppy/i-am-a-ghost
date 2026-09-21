# Original character models

`Night_Scout` and `Old_House_Wraith` are original low-poly characters generated in Blender 5.2. Their editable `.blend` files live in `assets/models/original/`; the browser loads the corresponding GLBs from `public/assets/models/original/`.

Regenerate both from the repository root:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' -b --python scripts/create-original-characters.py
```

The script builds the meshes, distinct `Scout_` and `Wraith_` armatures, material colors, and the `Idle_A`, `Running_A`, and `Hit_A` actions. It saves the editable files before exporting the GLBs. `src/assets/ImportedAssets.ts` maps each rig's named joints to the game's shared hand, head, look, leg, and capture controls. `src/assets/CharacterCatalog.ts` records model URLs, normalized heights, forward rotation, and file sizes.

Both models use the same authoritative movement circle and capture range as the existing characters. The Scout has a hood, goggles, backpack, and boots. The Wraith has a tapered shroud, broken crown, and luminous eyes. Models can be chosen independently by each player; unoccupied sensor dolls keep the original Rogue Kid visual.

Before committing a regenerated GLB, run `npm run build`, `npm run test:rules`, and a browser match with each new model. Check the hand flashlight, running and reverse movement, capture pose, ghost burn and reveal, and opening replay. If the exported size changes, update `CharacterCatalog.ts` and the intake metrics in `docs/ASSET_LICENSES.md`.

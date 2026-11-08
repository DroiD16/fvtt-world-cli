# Foundry compatibility

The bridge supports Foundry VTT v13 and v14. Check your connected version with
`fvtt-world-cli system info --json`.

| Area | v13 | v14 | What to do |
|---|---|---|---|
| Measured templates | Available | Removed from core | Use `scene.template` commands on v13. They are unavailable on v14. |
| Scene maps | One map per scene: `background`, `backgroundColor`, `foreground`, `foregroundElevation` and `fog.overlay` on the scene | Each level has its own map; the scene has `levels` and `initialLevel` | On v14, set maps through `levels` in `scene.create` or with `scene.level` commands. The scene-level map fields, including `fog.overlay`, are refused on v14, and `scene.level`, `levels` and `initialLevel` are refused on v13. |
| Placeable levels | Placeables have no level fields | A token sits on one `level`; tiles, walls, lights, sounds, notes, drawings and regions have a `levels` list, where an empty list means every level | On v14, read `level` or `levels` from placeable results to see what a level holds before deleting it. Placeable writes that set `level` or `levels` are refused on v13. |
| Scene thumbnail rendering | Renders the scene | Renders the scene's initial level by default | On v14, expect the initial level in the thumbnail. Check the returned dimensions and image. |
| Scene thumbnail files | Uses a stable scene-based filename | Uses a filename based on the image content | Use the returned path. On v14, a changed image can leave an older thumbnail file behind. |
| User permission names | `TEMPLATE_CREATE` | `REGION_CREATE` | Use the permission keys reported by the connected Foundry version when calling `user.permissions.set`. |
| Forced replacement of one typed-object entry (`{"system": {"activities": {"==<id>": {…}}}}`) | Not applied as a replacement: the entry is merged, so the bridge reports a per-path mismatch | Replaces the entry and confirms | On v13, a forced replacement of the whole typed object (`system.==activities`) is applied as requested. |
| HTML in rich-text fields | The server stores `<br>` as `<br />` | The server keeps `<br>` | The same HTML write can confirm on v14 and return a per-path mismatch on v13. `details.paths` shows the stored form, which is Foundry's own sanitized markup. Both versions store a raw `&` as `&amp;`. |

Scene placeable fields and available region behavior types also differ. Read the target document
before preparing a patch; valid data from one version is not automatically valid on the other.

## When an operation is unavailable

`UNSUPPORTED_OPERATION` means the connected Foundry runtime cannot perform the requested operation.
Repeating the same request will not fix it. Choose a supported operation or use a compatible runtime.

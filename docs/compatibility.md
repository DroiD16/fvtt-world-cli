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
| Scene snapshots | Renders the whole scene and has a `templates` layer. For a scene without a background image, Foundry renders only the area of the tiles it drew, so tiles can be cropped or missing; the result then reports `partialRender: true` | Renders one level, the initial one unless `levelId` names another, with only that level's placeables; there is no `templates` layer | `levelId` is refused on v13 and the `templates` layer on v14. When `partialRender` is true, `scene tile list` gives the tile positions. |
| User permission names | `TEMPLATE_CREATE` | `REGION_CREATE` | Use the permission keys reported by the connected Foundry version when calling `user.permissions.set`. |
| Relative content links | `@UUID[..<id>]` points at nothing | `@UUID[..<id>]` names a document one parent up | `world.references` reports a `..` link only on v14. |
| Token numbering (actors whose unlinked prototype token has "Append number" set) | Foundry counts the tokens on the scene the GM is viewing, whatever scene the token goes to; with no scene viewed, creating such a token fails | Foundry counts the tokens on the target scene | On v13 the numbers are right only while the GM views the target scene. |
| Legacy update operators `-=key` (deletion) and `==key` (forced replacement) | Work without a warning | Work, and the GM browser console logs a deprecation warning for each such key, stating that support will be removed in Version 16 | Nothing changes for v13 or v14 writes. The bridge passes the operator keys through without translating them to Foundry 14's operator objects, so they will stop working once Foundry removes them. |

Scene placeable fields and available region behavior types also differ. Read the target document
before preparing a patch; valid data from one version is not automatically valid on the other.

## When an operation is unavailable

`UNSUPPORTED_OPERATION` means the connected Foundry runtime cannot perform the requested operation.
Repeating the same request will not fix it. Choose a supported operation or use a compatible runtime.

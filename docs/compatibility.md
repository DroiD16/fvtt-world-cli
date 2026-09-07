# Foundry compatibility

The bridge supports Foundry VTT v13 and v14. Check your connected version with
`fvtt-world-cli system info --json`.

| Area | v13 | v14 | What to do |
|---|---|---|---|
| Measured templates | Available | Removed from core | Use `scene.template` commands on v13. They are unavailable on v14. |
| Scene thumbnail rendering | Renders the scene | Renders the scene's initial level by default | On v14, expect the initial level in the thumbnail. Check the returned dimensions and image. |
| Scene thumbnail files | Uses a stable scene-based filename | Uses a filename based on the image content | Use the returned path. On v14, a changed image can leave an older thumbnail file behind. |
| User permission names | `TEMPLATE_CREATE` | `REGION_CREATE` | Use the permission keys reported by the connected Foundry version when calling `user.permissions.set`. |

Scene placeable fields and available region behavior types also differ. Read the target document
before preparing a patch; valid data from one version is not automatically valid on the other.

## When an operation is unavailable

`UNSUPPORTED_OPERATION` means the connected Foundry runtime cannot perform the requested operation.
Repeating the same request will not fix it. Choose a supported operation or use a compatible runtime.

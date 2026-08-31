import { renderCompendiumSourceLines, renderOwnershipLines } from "./common.js";

export function renderSceneActivateResult(result: any) {
  return [
    `${result?.dryRun ? "[dry-run] would activate scene" : "Activated scene"} ${result?.sceneId}`,
    `was active: ${Boolean(result?.wasActive)}`,
    `changed: ${Boolean(result?.changed)}`
  ].join("\n");
}

export function renderScenePullUsersResult(result: any) {
  return [
    `Pulled users to scene ${result?.sceneId}`,
    `pulled: ${(result?.userIds ?? []).join(", ") || "(nobody online)"}`,
    `skipped (offline): ${(result?.skippedUserIds ?? []).join(", ") || "(none)"}`,
    `dispatched: ${Boolean(result?.dispatched)} — a pull writes nothing, so there is no state to confirm afterwards`
  ].join("\n");
}

export function renderSceneDetails(scene: any) {
  const lines = [
    `id: ${scene?.id}`,
    `name: ${scene?.name}`,
    `active: ${String(Boolean(scene?.active))}`,
    `navigation: ${String(Boolean(scene?.navigation))}`,
    `nav order: ${scene?.navOrder ?? 0}`,
    `size: ${scene?.width}x${scene?.height}`,
    `grid: ${JSON.stringify(scene?.grid ?? null)}`,
    `background: ${JSON.stringify(scene?.background ?? null)}`,
    `token vision: ${String(Boolean(scene?.tokenVision))}`,
    `weather: ${scene?.weather ?? ""}`,
    `playlist: ${scene?.playlist ?? ""}`
  ];
  lines.push(...renderCompendiumSourceLines(scene));

  if (scene && Object.hasOwn(scene, "ownership")) {
    lines.push(...renderOwnershipLines(scene.ownership));
  }

  if (scene?.counts && typeof scene.counts === "object") {
    for (const [name, value] of Object.entries(scene.counts)) {
      lines.push(`counts.${name}: ${value}`);
    }
  }
  return lines.join("\n");
}

export function renderTokenDetails(sceneId: string, token: any) {
  const lines = [
    `scene: ${sceneId}`,
    `id: ${token?.id}`,
    `name: ${token?.name}`,
    `actor: ${token?.actorId ?? ""}`,
    `actorLink: ${String(Boolean(token?.actorLink))}`,
    `position: (${token?.x ?? 0}, ${token?.y ?? 0})`,
    `elevation: ${token?.elevation ?? 0}`,
    `rotation: ${token?.rotation ?? 0}`,
    `hidden: ${String(Boolean(token?.hidden))}`,
    `disposition: ${token?.disposition ?? ""}`,
    `texture: ${JSON.stringify(token?.texture ?? null)}`
  ];

  if (token && Object.hasOwn(token, "prepared")) {
    lines.push(`prepared: ${Object.keys(token.prepared ?? {}).join(", ")} (use --json for values)`);
  }
  return lines.join("\n");
}

export function tokenItemPrefix(result: any) {
  const lines = [
    `scene: ${result.sceneId}`,
    `token: ${result.tokenId}`,
    `actorLink: ${String(Boolean(result.actorLink))}`
  ];
  if (result.mutatesWorldActor) {
    lines.push(
      "WARNING: this token is linked — the edit affects the shared world actor and all its linked tokens."
    );
  }
  return lines;
}

export function tokenItemEffectPrefix(result: any) {
  const lines = [
    `scene: ${result.sceneId}`,
    `token: ${result.tokenId}`,
    `item: ${result.itemId}`,
    `actorLink: ${String(Boolean(result.actorLink))}`
  ];
  if (result.mutatesWorldActor) {
    lines.push(
      "WARNING: this token is linked — the edit affects the shared world actor and all its linked tokens."
    );
  }

  if (result.nonDurable && result.warning) {
    lines.push(`WARNING (not durable): ${result.warning}`);
  }
  return lines;
}

export function renderTileDetails(sceneId: string, tile: any) {
  return [
    `scene: ${sceneId}`,
    `id: ${tile?.id}`,
    `position: (${tile?.x ?? 0}, ${tile?.y ?? 0})`,
    `size: ${tile?.width}x${tile?.height}`,
    `rotation: ${tile?.rotation ?? 0}`,
    `elevation: ${tile?.elevation ?? 0}`,
    `sort: ${tile?.sort ?? 0}`,
    `hidden: ${String(Boolean(tile?.hidden))}`,
    `locked: ${String(Boolean(tile?.locked))}`,
    `texture: ${JSON.stringify(tile?.texture ?? null)}`
  ].join("\n");
}

export function renderSoundDetails(sceneId: string, sound: any) {
  return [
    `scene: ${sceneId}`,
    `id: ${sound?.id}`,
    `path: ${sound?.path ?? ""}`,
    `position: (${sound?.x ?? 0}, ${sound?.y ?? 0})`,
    `radius: ${sound?.radius ?? 0}`,
    `volume: ${sound?.volume ?? ""}`,
    `walls: ${String(Boolean(sound?.walls))}`,
    `easing: ${String(Boolean(sound?.easing))}`,
    `repeat: ${String(Boolean(sound?.repeat))}`,
    `hidden: ${String(Boolean(sound?.hidden))}`
  ].join("\n");
}

export function renderWallDetails(sceneId: string, wall: any) {
  return [
    `scene: ${sceneId}`,
    `id: ${wall?.id}`,
    `c: ${JSON.stringify(wall?.c ?? null)}`,
    `door: ${wall?.door ?? 0}`,
    `ds: ${wall?.ds ?? 0}`,
    `doorSound: ${wall?.doorSound ?? ""}`,
    `light: ${wall?.light ?? 0}`,
    `sight: ${wall?.sight ?? 0}`,
    `sound: ${wall?.sound ?? 0}`,
    `move: ${wall?.move ?? 0}`,
    `dir: ${wall?.dir ?? 0}`,
    `threshold: ${JSON.stringify(wall?.threshold ?? null)}`
  ].join("\n");
}

export function renderNoteDetails(sceneId: string, note: any) {
  return [
    `scene: ${sceneId}`,
    `id: ${note?.id}`,
    `text: ${note?.text ?? ""}`,
    `position: (${note?.x ?? 0}, ${note?.y ?? 0})`,
    `entryId: ${note?.entryId ?? ""}`,
    `pageId: ${note?.pageId ?? ""}`,
    `texture: ${JSON.stringify(note?.texture ?? null)}`,
    `iconSize: ${note?.iconSize ?? ""}`,
    `elevation: ${note?.elevation ?? 0}`,
    `sort: ${note?.sort ?? 0}`,
    `global: ${String(Boolean(note?.global))}`
  ].join("\n");
}

export function renderDrawingDetails(sceneId: string, drawing: any) {
  return [
    `scene: ${sceneId}`,
    `id: ${drawing?.id}`,

    `name: ${drawing?.name ?? ""}`,
    `author: ${drawing?.author ?? ""}`,
    `text: ${drawing?.text ?? ""}`,
    `position: (${drawing?.x ?? 0}, ${drawing?.y ?? 0})`,
    `shape: ${JSON.stringify(drawing?.shape ?? null)}`,
    `rotation: ${drawing?.rotation ?? 0}`,
    `elevation: ${drawing?.elevation ?? 0}`,
    `sort: ${drawing?.sort ?? 0}`,
    `fillColor: ${drawing?.fillColor ?? ""}`,
    `strokeColor: ${drawing?.strokeColor ?? ""}`,
    `hidden: ${String(Boolean(drawing?.hidden))}`,
    `locked: ${String(Boolean(drawing?.locked))}`
  ].join("\n");
}

export function renderLightDetails(sceneId: string, light: any) {
  return [
    `scene: ${sceneId}`,
    `id: ${light?.id}`,

    `name: ${light?.name ?? ""}`,
    `position: (${light?.x ?? 0}, ${light?.y ?? 0})`,
    `elevation: ${light?.elevation ?? 0}`,
    `rotation: ${light?.rotation ?? 0}`,
    `walls: ${String(Boolean(light?.walls))}`,
    `vision: ${String(Boolean(light?.vision))}`,
    `config: ${JSON.stringify(light?.config ?? null)}`,
    `hidden: ${String(Boolean(light?.hidden))}`
  ].join("\n");
}

export function renderTemplateDetails(sceneId: string, template: any) {
  return [
    `scene: ${sceneId}`,
    `id: ${template?.id}`,
    `author: ${template?.author ?? ""}`,
    `t: ${template?.t ?? ""}`,
    `position: (${template?.x ?? 0}, ${template?.y ?? 0})`,
    `distance: ${template?.distance ?? 0}`,
    `direction: ${template?.direction ?? 0}`,
    `angle: ${template?.angle ?? 0}`,
    `width: ${template?.width ?? 0}`,
    `elevation: ${template?.elevation ?? 0}`,
    `hidden: ${String(Boolean(template?.hidden))}`
  ].join("\n");
}

export function renderRegionDetails(sceneId: string, region: any) {
  return [
    `scene: ${sceneId}`,
    `id: ${region?.id}`,
    `name: ${region?.name ?? ""}`,
    `color: ${region?.color ?? ""}`,
    `visibility: ${region?.visibility ?? ""}`,
    `elevation: ${JSON.stringify(region?.elevation ?? null)}`,
    `shapes: ${JSON.stringify(region?.shapes ?? [])}`,
    `behaviors: ${JSON.stringify(region?.behaviors ?? [])}`,
    `locked: ${String(Boolean(region?.locked))}`
  ].join("\n");
}

export function renderRegionBehaviorDetails(sceneId: string, regionId: string, behavior: any) {
  const name = behavior?.name;
  return [
    `scene: ${sceneId}`,
    `region: ${regionId}`,
    `id: ${behavior?.id}`,
    `name: ${name === "" ? "(blank)" : (name ?? "")}`,
    `type: ${behavior?.type ?? ""}`,
    `disabled: ${String(Boolean(behavior?.disabled))}`,
    `system: ${JSON.stringify(behavior?.system ?? {})}`
  ].join("\n");
}

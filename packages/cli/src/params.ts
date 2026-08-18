import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { text } from "node:stream/consumers";

import { UPLOAD_SIZE_LIMIT_MAX_BYTES } from "@fvtt-world-cli/protocol";
import { CommanderError, InvalidArgumentError } from "commander";

import type { CliDependencies } from "./deps.js";
import { LocalPayloadTooLargeError } from "./errors.js";
import { parseJsonObject, parseJsonObjectArray } from "./parse.js";

function readLocalFileAsBase64(path: string, uploadLimitBytes: number) {
  let actualBytes: number | undefined;
  try {
    actualBytes = statSync(path).size;
  } catch {
    actualBytes = undefined;
  }
  if (typeof actualBytes === "number" && actualBytes > uploadLimitBytes) {
    throw new LocalPayloadTooLargeError(
      `Upload payload for ${path} is ${actualBytes} bytes but the effective upload limit is ${uploadLimitBytes} bytes; raise uploadLimitBytes in the daemon config (max ${UPLOAD_SIZE_LIMIT_MAX_BYTES} bytes) and restart the daemon, or shrink the asset`,
      {
        path,
        limitBytes: uploadLimitBytes,
        actualBytes
      }
    );
  }

  try {
    return readFileSync(path).toString("base64");
  } catch (error) {
    throw new CommanderError(
      1,
      "fvtt-world-cli.localFileReadError",
      `Failed to read local file ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function stringField<K extends string>(key: K, value: string | undefined) {
  return value !== undefined ? ({ [key]: value } as Record<K, string>) : {};
}

export function truthyStringField<K extends string>(key: K, value: string | undefined) {
  return value ? ({ [key]: value } as Record<K, string>) : {};
}

export function numberField<K extends string>(key: K, value: number | undefined) {
  return typeof value === "number" ? ({ [key]: value } as Record<K, number>) : {};
}

export function booleanField<K extends string>(key: K, value: boolean | undefined) {
  return typeof value === "boolean" ? ({ [key]: value } as Record<K, boolean>) : {};
}

export function folderField(options: { folder?: string; clearFolder?: boolean }) {
  return options.clearFolder ? { folder: null } : options.folder ? { folder: options.folder } : {};
}

export function colorField(options: { color?: string; clearColor?: boolean }) {
  return options.clearColor ? { color: null } : options.color ? { color: options.color } : {};
}

export function jsonObjectField<K extends string>(key: K, value: string | undefined, label: string) {
  return value ? ({ [key]: parseJsonObject(value, label) } as Record<K, Record<string, unknown>>) : {};
}

export function jsonArrayField<K extends string>(key: K, value: string | undefined, label: string) {
  return value ? ({ [key]: parseJsonObjectArray(value, label) } as Record<K, Record<string, unknown>[]>) : {};
}

export function optionalJsonObject(
  value: string | undefined,
  label: string
): Record<string, unknown> | undefined {
  return value ? parseJsonObject(value, label) : undefined;
}

export function optionalPatch(patch: Record<string, unknown>) {
  return Object.keys(patch).length > 0 ? { patch } : {};
}

export function createItemCreateParams(options: {
  name: string;
  type: string;
  img?: string;
  folder?: string;
  clearFolder?: boolean;
  sort?: number;
  systemJson?: string;
  dataJson?: string;
  include?: string[];
}) {
  return {
    data: {
      name: options.name,
      type: options.type,
      ...stringField("img", options.img),
      ...folderField(options),
      ...numberField("sort", options.sort),
      ...jsonObjectField("system", options.systemJson, "--system-json"),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    },
    ...(options.include ? { include: options.include } : {})
  };
}

function assertNonEmptyPatch(patch: Record<string, unknown>) {
  if (Object.keys(patch).length === 0) {
    throw new InvalidArgumentError("No fields to update; pass at least one field flag");
  }

  return patch;
}

export function createItemUpdateParams(options: {
  itemId: string;
  name?: string;
  img?: string;
  folder?: string;
  clearFolder?: boolean;
  sort?: number;
  systemJson?: string;
  patchJson?: string;
  include?: string[];
}) {
  return {
    itemId: options.itemId,

    patch: assertNonEmptyPatch({
      ...stringField("name", options.name),
      ...stringField("img", options.img),
      ...folderField(options),
      ...numberField("sort", options.sort),
      ...jsonObjectField("system", options.systemJson, "--system-json"),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    }),
    ...(options.include ? { include: options.include } : {})
  };
}

export function createSceneUpdateParams(options: {
  sceneId: string;
  name?: string;
  active?: boolean;
  navigation?: boolean;
  navOrder?: number;
  width?: number;
  height?: number;
  gridJson?: string;
  backgroundJson?: string;
  tokenVision?: boolean;
  weather?: string;
  padding?: number;
  shiftX?: number;
  shiftY?: number;
  navName?: string;
  thumb?: string;
  foreground?: string;
  foregroundElevation?: number;
  sort?: number;
  initialLevel?: string;
  playlist?: string;
  playlistSound?: string;
  journal?: string;
  journalEntryPage?: string;
  environmentJson?: string;
  fogJson?: string;
  initialJson?: string;
  transitionJson?: string;
  patchJson?: string;
}) {
  return {
    sceneId: options.sceneId,

    patch: assertNonEmptyPatch({
      ...stringField("name", options.name),
      ...booleanField("active", options.active),
      ...booleanField("navigation", options.navigation),
      ...numberField("navOrder", options.navOrder),
      ...numberField("width", options.width),
      ...numberField("height", options.height),
      ...jsonObjectField("grid", options.gridJson, "--grid-json"),
      ...jsonObjectField("background", options.backgroundJson, "--background-json"),

      ...booleanField("tokenVision", options.tokenVision),
      ...truthyStringField("weather", options.weather),
      ...numberField("padding", options.padding),
      ...numberField("shiftX", options.shiftX),
      ...numberField("shiftY", options.shiftY),
      ...truthyStringField("navName", options.navName),
      ...truthyStringField("thumb", options.thumb),
      ...truthyStringField("foreground", options.foreground),
      ...numberField("foregroundElevation", options.foregroundElevation),
      ...numberField("sort", options.sort),
      ...truthyStringField("initialLevel", options.initialLevel),
      ...truthyStringField("playlist", options.playlist),
      ...truthyStringField("playlistSound", options.playlistSound),
      ...truthyStringField("journal", options.journal),
      ...truthyStringField("journalEntryPage", options.journalEntryPage),
      ...jsonObjectField("environment", options.environmentJson, "--environment-json"),
      ...jsonObjectField("fog", options.fogJson, "--fog-json"),
      ...jsonObjectField("initial", options.initialJson, "--initial-json"),
      ...jsonObjectField("transition", options.transitionJson, "--transition-json"),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export interface SceneFieldOptions {
  name?: string;
  active?: boolean;
  navigation?: boolean;
  navOrder?: number;
  width?: number;
  height?: number;
  gridJson?: string;
  backgroundJson?: string;
  tokenVision?: boolean;
  weather?: string;
  padding?: number;
  shiftX?: number;
  shiftY?: number;
  navName?: string;
  thumb?: string;
  foreground?: string;
  foregroundElevation?: number;
  sort?: number;
  initialLevel?: string;
  playlist?: string;
  playlistSound?: string;
  journal?: string;
  journalEntryPage?: string;
  environmentJson?: string;
  fogJson?: string;
  initialJson?: string;
  transitionJson?: string;
}

function buildScenePatch(options: SceneFieldOptions) {
  return {
    ...stringField("name", options.name),
    ...booleanField("active", options.active),
    ...booleanField("navigation", options.navigation),
    ...numberField("navOrder", options.navOrder),
    ...numberField("width", options.width),
    ...numberField("height", options.height),
    ...jsonObjectField("grid", options.gridJson, "--grid-json"),
    ...jsonObjectField("background", options.backgroundJson, "--background-json"),

    ...booleanField("tokenVision", options.tokenVision),
    ...truthyStringField("weather", options.weather),
    ...numberField("padding", options.padding),
    ...numberField("shiftX", options.shiftX),
    ...numberField("shiftY", options.shiftY),
    ...truthyStringField("navName", options.navName),
    ...truthyStringField("thumb", options.thumb),
    ...truthyStringField("foreground", options.foreground),
    ...numberField("foregroundElevation", options.foregroundElevation),
    ...numberField("sort", options.sort),
    ...truthyStringField("initialLevel", options.initialLevel),
    ...truthyStringField("playlist", options.playlist),
    ...truthyStringField("playlistSound", options.playlistSound),
    ...truthyStringField("journal", options.journal),
    ...truthyStringField("journalEntryPage", options.journalEntryPage),
    ...jsonObjectField("environment", options.environmentJson, "--environment-json"),
    ...jsonObjectField("fog", options.fogJson, "--fog-json"),
    ...jsonObjectField("initial", options.initialJson, "--initial-json"),
    ...jsonObjectField("transition", options.transitionJson, "--transition-json")
  };
}

export function createSceneCreateParams(options: SceneFieldOptions & { name: string; dataJson?: string }) {
  return {
    data: {
      name: options.name,
      ...buildScenePatch({ ...options, name: undefined }),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createSceneCloneParams(options: SceneFieldOptions & { sceneId: string }) {
  return {
    sceneId: options.sceneId,
    ...optionalPatch(buildScenePatch(options))
  };
}

export function createItemCloneParams(options: {
  itemId: string;
  name?: string;
  img?: string;
  folder?: string;
  clearFolder?: boolean;
  sort?: number;
  systemJson?: string;
}) {
  const patch = {
    ...stringField("name", options.name),
    ...stringField("img", options.img),
    ...folderField(options),
    ...numberField("sort", options.sort),
    ...jsonObjectField("system", options.systemJson, "--system-json")
  };
  return {
    itemId: options.itemId,
    ...optionalPatch(patch)
  };
}

export function createJournalCloneParams(options: {
  journalId: string;
  name?: string;
  folder?: string;
  clearFolder?: boolean;
  sort?: number;
}) {
  const patch = {
    ...stringField("name", options.name),
    ...folderField(options),
    ...numberField("sort", options.sort)
  };
  return {
    journalId: options.journalId,
    ...optionalPatch(patch)
  };
}

export async function resolveMacroCommandBody(
  options: { command?: string; commandFile?: string; commandStdin?: boolean },
  dependencies: CliDependencies
): Promise<string | undefined> {
  if (options.commandFile !== undefined) {
    try {
      return readFileSync(resolve(options.commandFile), "utf8");
    } catch (error) {
      throw new CommanderError(
        1,
        "fvtt-world-cli.commandFileReadError",
        `Failed to read --command-file ${options.commandFile}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (options.commandStdin) {
    if (dependencies.stdin.isTTY) {
      throw new CommanderError(
        1,
        "fvtt-world-cli.macroCommandNoStdin",
        "--command-stdin requires the macro body piped on stdin; refusing to read from an interactive terminal."
      );
    }

    return await text(dependencies.stdin);
  }
  return options.command;
}

export function createMacroCreateParams(options: {
  name: string;
  type?: string;
  command?: string;
  img?: string;
  folder?: string;
  clearFolder?: boolean;
  scope?: string;
  dataJson?: string;
}) {
  return {
    data: {
      name: options.name,
      ...stringField("type", options.type),
      ...stringField("command", options.command),
      ...stringField("img", options.img),
      ...folderField(options),
      ...stringField("scope", options.scope),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createChatCreateParams(options: {
  content?: string;
  whisper?: string[];
  roll?: string;
  flavor?: string;
  blind?: boolean;
  style?: number;
  sound?: string;
  speakerJson?: string;
  alias?: string;
}) {
  const speaker: Record<string, unknown> = {
    ...(optionalJsonObject(options.speakerJson, "--speaker-json") ?? {})
  };
  if (options.alias) {
    speaker.alias = options.alias;
  }
  const data: Record<string, unknown> = {
    ...stringField("content", options.content),
    ...(options.whisper ? { whisper: options.whisper } : {}),
    ...booleanField("blind", options.blind),
    ...numberField("style", options.style),
    ...stringField("flavor", options.flavor),
    ...truthyStringField("sound", options.sound),
    ...(Object.keys(speaker).length > 0 ? { speaker } : {})
  };
  return {
    data,

    ...(options.roll ? { roll: { formula: options.roll } } : {})
  };
}

export function createMacroUpdateParams(options: {
  macroId: string;
  name?: string;
  type?: string;
  command?: string;
  img?: string;
  folder?: string;
  clearFolder?: boolean;
  scope?: string;
  patchJson?: string;
}) {
  return {
    macroId: options.macroId,

    patch: assertNonEmptyPatch({
      ...stringField("name", options.name),
      ...stringField("type", options.type),
      ...stringField("command", options.command),
      ...stringField("img", options.img),
      ...folderField(options),
      ...stringField("scope", options.scope),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export function createMacroCloneParams(options: {
  macroId: string;
  name?: string;
  type?: string;
  command?: string;
  img?: string;
  folder?: string;
  clearFolder?: boolean;
  scope?: string;
}) {
  const patch = {
    ...stringField("name", options.name),
    ...stringField("type", options.type),
    ...stringField("command", options.command),
    ...stringField("img", options.img),
    ...folderField(options),
    ...stringField("scope", options.scope)
  };
  return {
    macroId: options.macroId,
    ...optionalPatch(patch)
  };
}

export interface PlaylistFieldOptions {
  name?: string;
  description?: string;
  mode?: number;
  playing?: boolean;
  fade?: number;
  channel?: string;
  sorting?: string;
  seed?: number;
  folder?: string;
  clearFolder?: boolean;
  sort?: number;
}

function buildPlaylistFields(options: PlaylistFieldOptions) {
  return {
    ...stringField("description", options.description),
    ...numberField("mode", options.mode),
    ...booleanField("playing", options.playing),
    ...numberField("fade", options.fade),
    ...stringField("channel", options.channel),
    ...stringField("sorting", options.sorting),
    ...numberField("seed", options.seed),
    ...folderField(options),
    ...numberField("sort", options.sort)
  };
}

export function createPlaylistCreateParams(
  options: PlaylistFieldOptions & { name: string; soundsJson?: string; dataJson?: string }
) {
  const sounds = options.soundsJson ? parseJsonObjectArray(options.soundsJson, "--sounds-json") : undefined;
  return {
    data: {
      name: options.name,
      ...buildPlaylistFields(options),
      ...(sounds ? { sounds } : {}),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createPlaylistUpdateParams(
  options: PlaylistFieldOptions & { playlistId: string; patchJson?: string }
) {
  return {
    playlistId: options.playlistId,
    patch: assertNonEmptyPatch({
      ...stringField("name", options.name),
      ...buildPlaylistFields(options),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export function createPlaylistCloneParams(
  options: PlaylistFieldOptions & { playlistId: string; patchJson?: string }
) {
  const patch = {
    ...stringField("name", options.name),
    ...buildPlaylistFields(options),
    ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
  return {
    playlistId: options.playlistId,
    ...optionalPatch(patch)
  };
}

export interface PlaylistSoundFieldOptions {
  name?: string;
  description?: string;
  path?: string;
  channel?: string;
  playing?: boolean;
  pausedTime?: number;
  repeat?: boolean;
  volume?: number;
  fade?: number;
  sort?: number;
}

function buildPlaylistSoundFields(options: PlaylistSoundFieldOptions) {
  return {
    ...stringField("name", options.name),
    ...stringField("description", options.description),
    ...stringField("channel", options.channel),
    ...booleanField("playing", options.playing),
    ...numberField("pausedTime", options.pausedTime),
    ...booleanField("repeat", options.repeat),
    ...numberField("volume", options.volume),
    ...numberField("fade", options.fade),
    ...numberField("sort", options.sort)
  };
}

export function createPlaylistSoundCreateParams(
  options: PlaylistSoundFieldOptions & { playlistId: string; path: string; dataJson?: string }
) {
  return {
    playlistId: options.playlistId,
    data: {
      path: options.path,
      ...buildPlaylistSoundFields(options),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createPlaylistSoundUpdateParams(
  options: PlaylistSoundFieldOptions & { playlistId: string; soundId: string; patchJson?: string }
) {
  return {
    playlistId: options.playlistId,
    soundId: options.soundId,
    patch: assertNonEmptyPatch({
      ...stringField("path", options.path),
      ...buildPlaylistSoundFields(options),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export function createPlaylistSoundCloneParams(
  options: PlaylistSoundFieldOptions & { playlistId: string; soundId: string; patchJson?: string }
) {
  const patch = {
    ...stringField("path", options.path),
    ...buildPlaylistSoundFields(options),
    ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
  return {
    playlistId: options.playlistId,
    soundId: options.soundId,
    ...optionalPatch(patch)
  };
}

export interface JournalCategoryFieldOptions {
  name?: string;
  sort?: number;
}

function buildJournalCategoryFields(options: JournalCategoryFieldOptions) {
  return {
    ...stringField("name", options.name),
    ...numberField("sort", options.sort)
  };
}

export function createJournalCategoryCreateParams(
  options: JournalCategoryFieldOptions & { journalId: string; name: string; dataJson?: string }
) {
  return {
    journalId: options.journalId,
    data: {
      ...buildJournalCategoryFields(options),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createJournalCategoryUpdateParams(
  options: JournalCategoryFieldOptions & { journalId: string; categoryId: string; patchJson?: string }
) {
  return {
    journalId: options.journalId,
    categoryId: options.categoryId,
    patch: assertNonEmptyPatch({
      ...buildJournalCategoryFields(options),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export interface TableFieldOptions {
  description?: string;
  img?: string;
  clearImg?: boolean;
  formula?: string;
  replacement?: boolean;
  displayRoll?: boolean;
  folder?: string;
  clearFolder?: boolean;
  sort?: number;
}

function buildTableFields(options: TableFieldOptions) {
  return {
    ...stringField("description", options.description),
    ...(options.clearImg ? { img: null } : stringField("img", options.img)),
    ...stringField("formula", options.formula),
    ...booleanField("replacement", options.replacement),
    ...booleanField("displayRoll", options.displayRoll),
    ...folderField(options),
    ...numberField("sort", options.sort)
  };
}

export function createTableCreateParams(
  options: TableFieldOptions & { name: string; resultsJson?: string; dataJson?: string }
) {
  const results = options.resultsJson
    ? parseJsonObjectArray(options.resultsJson, "--results-json")
    : undefined;
  return {
    data: {
      name: options.name,
      ...buildTableFields(options),
      ...(results ? { results } : {}),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createTableUpdateParams(
  options: TableFieldOptions & { tableId: string; name?: string; patchJson?: string }
) {
  return {
    tableId: options.tableId,
    patch: assertNonEmptyPatch({
      ...stringField("name", options.name),
      ...buildTableFields(options),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export function createTableCloneParams(
  options: TableFieldOptions & { tableId: string; name?: string; patchJson?: string }
) {
  const patch = {
    ...stringField("name", options.name),
    ...buildTableFields(options),
    ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
  return {
    tableId: options.tableId,
    ...optionalPatch(patch)
  };
}

export interface CardsFieldOptions {
  description?: string;
  img?: string;
  clearImg?: boolean;
  width?: number;
  height?: number;
  rotation?: number;
  displayCount?: boolean;
  folder?: string;
  clearFolder?: boolean;
  sort?: number;
  systemJson?: string;
}

function buildCardsFields(options: CardsFieldOptions) {
  return {
    ...stringField("description", options.description),
    ...(options.clearImg ? { img: null } : stringField("img", options.img)),
    ...numberField("width", options.width),
    ...numberField("height", options.height),
    ...numberField("rotation", options.rotation),
    ...booleanField("displayCount", options.displayCount),
    ...folderField(options),
    ...numberField("sort", options.sort),
    ...jsonObjectField("system", options.systemJson, "--system-json")
  };
}

export function createCardsCreateParams(
  options: CardsFieldOptions & { name: string; type: string; cardsJson?: string; dataJson?: string }
) {
  const cards = options.cardsJson ? parseJsonObjectArray(options.cardsJson, "--cards-json") : undefined;
  return {
    data: {
      name: options.name,
      type: options.type,
      ...buildCardsFields(options),
      ...(cards ? { cards } : {}),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createCardsUpdateParams(
  options: CardsFieldOptions & { cardsId: string; name?: string; patchJson?: string }
) {
  return {
    cardsId: options.cardsId,
    patch: assertNonEmptyPatch({
      ...stringField("name", options.name),
      ...buildCardsFields(options),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export function createCardsCloneParams(
  options: CardsFieldOptions & { cardsId: string; name?: string; patchJson?: string }
) {
  const patch = {
    ...stringField("name", options.name),
    ...buildCardsFields(options),
    ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
  return {
    cardsId: options.cardsId,
    ...optionalPatch(patch)
  };
}

export interface CardFieldOptions {
  description?: string;
  suit?: string;
  value?: number;
  clearValue?: boolean;
  face?: number;
  clearFace?: boolean;
  backJson?: string;
  facesJson?: string;
  width?: number;
  height?: number;
  rotation?: number;
  sort?: number;
  systemJson?: string;
}

function buildCardFields(options: CardFieldOptions) {
  return {
    ...stringField("description", options.description),
    ...stringField("suit", options.suit),
    ...(options.clearValue ? { value: null } : numberField("value", options.value)),
    ...(options.clearFace ? { face: null } : numberField("face", options.face)),
    ...jsonObjectField("back", options.backJson, "--back-json"),
    ...(options.facesJson === undefined
      ? {}
      : { faces: parseJsonObjectArray(options.facesJson, "--faces-json") }),
    ...numberField("width", options.width),
    ...numberField("height", options.height),
    ...numberField("rotation", options.rotation),
    ...numberField("sort", options.sort),
    ...jsonObjectField("system", options.systemJson, "--system-json")
  };
}

export function createCardCreateParams(
  options: CardFieldOptions & { cardsId: string; name: string; type?: string; dataJson?: string }
) {
  return {
    cardsId: options.cardsId,
    data: {
      name: options.name,
      ...stringField("type", options.type),
      ...buildCardFields(options),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createCardUpdateParams(
  options: CardFieldOptions & { cardsId: string; cardId: string; name?: string; patchJson?: string }
) {
  return {
    cardsId: options.cardsId,
    cardId: options.cardId,
    patch: assertNonEmptyPatch({
      ...stringField("name", options.name),
      ...buildCardFields(options),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export function createCardCloneParams(
  options: CardFieldOptions & { cardsId: string; cardId: string; name?: string; patchJson?: string }
) {
  const patch = {
    ...stringField("name", options.name),
    ...buildCardFields(options),
    ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
  return {
    cardsId: options.cardsId,
    cardId: options.cardId,
    ...optionalPatch(patch)
  };
}

export interface CombatFieldOptions {
  name?: string;
  scene?: string;
  clearScene?: boolean;
  sort?: number;
  systemJson?: string;
}

function buildCombatFields(options: CombatFieldOptions) {
  return {
    ...stringField("name", options.name),
    ...(options.clearScene ? { scene: null } : truthyStringField("scene", options.scene)),
    ...numberField("sort", options.sort),
    ...jsonObjectField("system", options.systemJson, "--system-json")
  };
}

export function createCombatCreateParams(options: CombatFieldOptions & { type?: string; dataJson?: string }) {
  return {
    data: {
      ...buildCombatFields(options),
      ...truthyStringField("type", options.type),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createCombatUpdateParams(
  options: CombatFieldOptions & { combatId: string; patchJson?: string }
) {
  return {
    combatId: options.combatId,
    patch: assertNonEmptyPatch({
      ...buildCombatFields(options),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export interface CombatantFieldOptions {
  name?: string;
  img?: string;
  clearImg?: boolean;
  actorId?: string;
  clearActor?: boolean;
  tokenId?: string;
  clearToken?: boolean;
  sceneId?: string;
  clearScene?: boolean;
  group?: string;
  clearGroup?: boolean;
  hidden?: boolean;
  defeated?: boolean;
  roundJoined?: number;
  systemJson?: string;
}

function buildCombatantFields(options: CombatantFieldOptions) {
  return {
    ...stringField("name", options.name),
    ...(options.clearImg ? { img: null } : stringField("img", options.img)),
    ...(options.clearActor ? { actorId: null } : truthyStringField("actorId", options.actorId)),
    ...(options.clearToken ? { tokenId: null } : truthyStringField("tokenId", options.tokenId)),
    ...(options.clearScene ? { sceneId: null } : truthyStringField("sceneId", options.sceneId)),
    ...(options.clearGroup ? { group: null } : truthyStringField("group", options.group)),
    ...booleanField("hidden", options.hidden),
    ...booleanField("defeated", options.defeated),
    ...numberField("roundJoined", options.roundJoined),
    ...jsonObjectField("system", options.systemJson, "--system-json")
  };
}

export function createCombatantCreateParams(
  options: CombatantFieldOptions & {
    combatId: string;
    type?: string;
    initiative?: number;
    dataJson?: string;
  }
) {
  return {
    combatId: options.combatId,
    data: {
      ...buildCombatantFields(options),
      ...truthyStringField("type", options.type),

      ...numberField("initiative", options.initiative),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createCombatantUpdateParams(
  options: CombatantFieldOptions & { combatId: string; combatantId: string; patchJson?: string }
) {
  return {
    combatId: options.combatId,
    combatantId: options.combatantId,
    patch: assertNonEmptyPatch({
      ...buildCombatantFields(options),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export interface CombatantGroupFieldOptions {
  name?: string;
  img?: string;
  clearImg?: boolean;
  initiative?: number;
  clearInitiative?: boolean;
  systemJson?: string;
}

function buildCombatantGroupFields(options: CombatantGroupFieldOptions) {
  return {
    ...stringField("name", options.name),
    ...(options.clearImg ? { img: null } : stringField("img", options.img)),
    ...(options.clearInitiative ? { initiative: null } : numberField("initiative", options.initiative)),
    ...jsonObjectField("system", options.systemJson, "--system-json")
  };
}

export function createCombatantGroupCreateParams(
  options: CombatantGroupFieldOptions & { combatId: string; type?: string; dataJson?: string }
) {
  return {
    combatId: options.combatId,
    data: {
      ...buildCombatantGroupFields(options),
      ...truthyStringField("type", options.type),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createCombatantGroupUpdateParams(
  options: CombatantGroupFieldOptions & { combatId: string; groupId: string; patchJson?: string }
) {
  return {
    combatId: options.combatId,
    groupId: options.groupId,
    patch: assertNonEmptyPatch({
      ...buildCombatantGroupFields(options),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export interface TableResultFieldOptions {
  type?: string;
  name?: string;
  img?: string;
  clearImg?: boolean;
  description?: string;
  documentUuid?: string;
  clearDocumentUuid?: boolean;
  weight?: number;
  range?: number[];
  drawn?: boolean;
}

function buildTableResultFields(options: TableResultFieldOptions) {
  return {
    ...stringField("type", options.type),
    ...stringField("name", options.name),
    ...(options.clearImg ? { img: null } : stringField("img", options.img)),
    ...stringField("description", options.description),
    ...(options.clearDocumentUuid
      ? { documentUuid: null }
      : stringField("documentUuid", options.documentUuid)),
    ...numberField("weight", options.weight),
    ...booleanField("drawn", options.drawn)
  };
}

export function createTableResultCreateParams(
  options: TableResultFieldOptions & { tableId: string; range: number[]; dataJson?: string }
) {
  return {
    tableId: options.tableId,
    data: {
      range: options.range,
      ...buildTableResultFields(options),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createTableResultUpdateParams(
  options: TableResultFieldOptions & { tableId: string; resultId: string; patchJson?: string }
) {
  return {
    tableId: options.tableId,
    resultId: options.resultId,
    patch: assertNonEmptyPatch({
      ...buildTableResultFields(options),
      ...(options.range ? { range: options.range } : {}),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export function createTableResultCloneParams(
  options: TableResultFieldOptions & { tableId: string; resultId: string; patchJson?: string }
) {
  const patch = {
    ...buildTableResultFields(options),
    ...(options.range ? { range: options.range } : {}),
    ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
  return {
    tableId: options.tableId,
    resultId: options.resultId,
    ...optionalPatch(patch)
  };
}

export function createJournalCreateParams(options: {
  name: string;
  folder?: string;
  clearFolder?: boolean;
  sort?: number;
  pagesJson?: string;
  dataJson?: string;
}) {
  return {
    data: {
      name: options.name,
      ...folderField(options),
      ...numberField("sort", options.sort),
      ...jsonArrayField("pages", options.pagesJson, "--pages-json"),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createJournalUpdateParams(options: {
  journalId: string;
  name?: string;
  folder?: string;
  clearFolder?: boolean;
  sort?: number;
  pagesJson?: string;
  deletePageIds?: string[];
  patchJson?: string;
}) {
  return {
    journalId: options.journalId,

    patch: assertNonEmptyPatch({
      ...stringField("name", options.name),
      ...folderField(options),
      ...numberField("sort", options.sort),
      ...jsonArrayField("pages", options.pagesJson, "--pages-json"),
      ...(options.deletePageIds && options.deletePageIds.length > 0
        ? { deletePageIds: options.deletePageIds }
        : {}),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export function createActorItemCreateParams(options: {
  actorId: string;
  name: string;
  type: string;
  img?: string;
  sort?: number;
  systemJson?: string;
  dataJson?: string;
  include?: string[];
}) {
  return {
    actorId: options.actorId,
    ...createItemCreateParams(options)
  };
}

export function createActorItemUpdateParams(options: {
  actorId: string;
  itemId: string;
  name?: string;
  img?: string;
  sort?: number;
  systemJson?: string;
  patchJson?: string;
  include?: string[];
}) {
  return {
    actorId: options.actorId,
    ...createItemUpdateParams(options)
  };
}

export function createActorItemCloneParams(options: {
  actorId: string;
  itemId: string;
  name?: string;
  img?: string;
  sort?: number;
  systemJson?: string;
}) {
  const patch = {
    ...stringField("name", options.name),
    ...stringField("img", options.img),
    ...numberField("sort", options.sort),
    ...jsonObjectField("system", options.systemJson, "--system-json")
  };
  return {
    actorId: options.actorId,
    itemId: options.itemId,
    ...optionalPatch(patch)
  };
}

export function createActorItemImportParams(options: {
  actorId: string;
  pack: string;
  entryId: string;
  name?: string;
  img?: string;
  sort?: number;
  systemJson?: string;
  patchJson?: string;
  include?: string[];
}) {
  const patch = {
    ...stringField("name", options.name),
    ...stringField("img", options.img),
    ...numberField("sort", options.sort),
    ...jsonObjectField("system", options.systemJson, "--system-json"),

    ...(options.patchJson ? parseJsonObject(options.patchJson, "--patch-json") : {})
  };
  return {
    actorId: options.actorId,
    pack: options.pack,
    entryId: options.entryId,
    ...optionalPatch(patch),
    ...(options.include ? { include: options.include } : {})
  };
}

export interface ActorFieldOptions {
  name?: string;
  img?: string;
  folder?: string;
  clearFolder?: boolean;
  sort?: number;
  systemJson?: string;
}

export interface EffectFieldOptions {
  name?: string;
  img?: string;
  disabled?: boolean;
  transfer?: boolean;
  dataJson?: string;
  patchJson?: string;
}

function buildEffectFields(options: EffectFieldOptions, json: Record<string, unknown> | undefined) {
  return {
    ...stringField("name", options.name),
    ...stringField("img", options.img),
    ...booleanField("disabled", options.disabled),
    ...booleanField("transfer", options.transfer),
    ...(json ?? {})
  };
}

export function createEffectCreateParams(options: EffectFieldOptions) {
  return {
    data: buildEffectFields(options, optionalJsonObject(options.dataJson, "--data-json"))
  };
}

export function createEffectUpdatePatch(options: EffectFieldOptions) {
  return assertNonEmptyPatch(
    buildEffectFields(options, optionalJsonObject(options.patchJson, "--patch-json"))
  );
}

export function createEffectClonePatch(options: EffectFieldOptions) {
  return optionalPatch(buildEffectFields(options, optionalJsonObject(options.patchJson, "--patch-json")));
}

function buildActorPatch(options: ActorFieldOptions) {
  return {
    ...stringField("name", options.name),
    ...stringField("img", options.img),
    ...folderField(options),
    ...numberField("sort", options.sort),
    ...jsonObjectField("system", options.systemJson, "--system-json")
  };
}

export function createActorCreateParams(
  options: ActorFieldOptions & { name: string; type: string; dataJson?: string; include?: string[] }
) {
  return {
    data: {
      name: options.name,
      type: options.type,
      ...buildActorPatch({ ...options, name: undefined }),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    },
    ...(options.include ? { include: options.include } : {})
  };
}

export function createActorUpdateParams(
  options: ActorFieldOptions & { actorId: string; patchJson?: string; include?: string[] }
) {
  return {
    actorId: options.actorId,

    patch: assertNonEmptyPatch({
      ...buildActorPatch(options),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    }),
    ...(options.include ? { include: options.include } : {})
  };
}

export function createActorCloneParams(options: ActorFieldOptions & { actorId: string }) {
  return {
    actorId: options.actorId,
    ...optionalPatch(buildActorPatch(options))
  };
}

export function createActorImportParams(options: {
  pack: string;
  entryId: string;
  folder?: string;
  clearFolder?: boolean;
  name?: string;
  img?: string;
  tokenImg?: string;
  sort?: number;
  patchJson?: string;
}) {
  const patch = {
    ...stringField("name", options.name),
    ...stringField("img", options.img),
    ...numberField("sort", options.sort),

    ...(options.tokenImg ? { prototypeToken: { texture: { src: options.tokenImg } } } : {}),

    ...(options.patchJson ? parseJsonObject(options.patchJson, "--patch-json") : {})
  };
  return {
    pack: options.pack,
    entryId: options.entryId,
    ...folderField(options),
    ...optionalPatch(patch)
  };
}

export interface FolderFieldOptions {
  description?: string;
  color?: string;
  clearColor?: boolean;
  sorting?: string;
  sort?: number;
  folder?: string;
  clearFolder?: boolean;
}

function buildFolderFields(options: FolderFieldOptions) {
  return {
    ...stringField("description", options.description),
    ...colorField(options),
    ...stringField("sorting", options.sorting),
    ...numberField("sort", options.sort),
    ...folderField(options)
  };
}

export function createFolderCreateParams(
  options: FolderFieldOptions & { name: string; type: string; dataJson?: string }
) {
  return {
    data: {
      name: options.name,
      type: options.type,
      ...buildFolderFields(options),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createFolderUpdateParams(
  options: FolderFieldOptions & { folderId: string; name?: string; patchJson?: string }
) {
  return {
    folderId: options.folderId,
    patch: assertNonEmptyPatch({
      ...stringField("name", options.name),
      ...buildFolderFields(options),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export function createFolderDeleteParams(options: {
  folderId: string;
  deleteSubfolders?: boolean;
  deleteContents?: boolean;
  force?: boolean;
}) {
  return {
    folderId: options.folderId,
    ...(options.deleteSubfolders ? { deleteSubfolders: true } : {}),
    ...(options.deleteContents ? { deleteContents: true } : {}),
    ...(options.force ? { force: true } : {})
  };
}

export interface TokenFieldOptions {
  actorId?: string;
  x?: number;
  y?: number;
  name?: string;
  hidden?: boolean;
  rotation?: number;
  elevation?: number;
  disposition?: number;
  linked?: boolean;
  unlinked?: boolean;
}

function buildTokenFields(options: TokenFieldOptions, json: Record<string, unknown> | undefined) {
  return {
    ...truthyStringField("actorId", options.actorId),
    ...numberField("x", options.x),
    ...numberField("y", options.y),

    ...stringField("name", options.name),
    ...booleanField("hidden", options.hidden),
    ...numberField("rotation", options.rotation),
    ...numberField("elevation", options.elevation),
    ...numberField("disposition", options.disposition),
    ...(options.linked ? { actorLink: true } : options.unlinked ? { actorLink: false } : {}),
    ...(json ?? {})
  };
}

export function createSceneTokenCreateParams(
  options: TokenFieldOptions & { sceneId: string; dataJson?: string }
) {
  const json = optionalJsonObject(options.dataJson, "--data-json");
  return {
    sceneId: options.sceneId,
    data: buildTokenFields(options, json)
  };
}

export function createSceneTokenUpdateParams(
  options: TokenFieldOptions & { sceneId: string; tokenId: string; patchJson?: string }
) {
  const json = optionalJsonObject(options.patchJson, "--patch-json");
  return {
    sceneId: options.sceneId,
    tokenId: options.tokenId,
    patch: assertNonEmptyPatch(buildTokenFields(options, json))
  };
}

export function createSceneTokenCloneParams(
  options: TokenFieldOptions & { sceneId: string; tokenId: string; patchJson?: string }
) {
  const json = optionalJsonObject(options.patchJson, "--patch-json");
  return {
    sceneId: options.sceneId,
    tokenId: options.tokenId,
    ...optionalPatch(buildTokenFields(options, json))
  };
}

export interface TileFieldOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  elevation?: number;
  hidden?: boolean;
  locked?: boolean;
}

function buildTileFields(options: TileFieldOptions, json: Record<string, unknown> | undefined) {
  return {
    ...numberField("x", options.x),
    ...numberField("y", options.y),
    ...numberField("width", options.width),
    ...numberField("height", options.height),
    ...numberField("rotation", options.rotation),
    ...numberField("elevation", options.elevation),
    ...booleanField("hidden", options.hidden),
    ...booleanField("locked", options.locked),
    ...(json ?? {})
  };
}

export function createSceneTileCreateParams(
  options: TileFieldOptions & { sceneId: string; dataJson?: string }
) {
  const json = optionalJsonObject(options.dataJson, "--data-json");
  return { sceneId: options.sceneId, data: buildTileFields(options, json) };
}

export function createSceneTileUpdateParams(
  options: TileFieldOptions & { sceneId: string; tileId: string; patchJson?: string }
) {
  const json = optionalJsonObject(options.patchJson, "--patch-json");
  return {
    sceneId: options.sceneId,
    tileId: options.tileId,
    patch: assertNonEmptyPatch(buildTileFields(options, json))
  };
}

export function createSceneTileCloneParams(
  options: TileFieldOptions & { sceneId: string; tileId: string; patchJson?: string }
) {
  const json = optionalJsonObject(options.patchJson, "--patch-json");
  return {
    sceneId: options.sceneId,
    tileId: options.tileId,
    ...optionalPatch(buildTileFields(options, json))
  };
}

export interface SoundFieldOptions {
  path?: string;
  x?: number;
  y?: number;
  radius?: number;
  volume?: number;
  hidden?: boolean;
}

function buildSoundFields(options: SoundFieldOptions, json: Record<string, unknown> | undefined) {
  return {
    ...truthyStringField("path", options.path),
    ...numberField("x", options.x),
    ...numberField("y", options.y),
    ...numberField("radius", options.radius),
    ...numberField("volume", options.volume),
    ...booleanField("hidden", options.hidden),
    ...(json ?? {})
  };
}

export function createSceneSoundCreateParams(
  options: SoundFieldOptions & { sceneId: string; dataJson?: string }
) {
  const json = optionalJsonObject(options.dataJson, "--data-json");
  return { sceneId: options.sceneId, data: buildSoundFields(options, json) };
}

export function createSceneSoundUpdateParams(
  options: SoundFieldOptions & { sceneId: string; soundId: string; patchJson?: string }
) {
  const json = optionalJsonObject(options.patchJson, "--patch-json");
  return {
    sceneId: options.sceneId,
    soundId: options.soundId,
    patch: assertNonEmptyPatch(buildSoundFields(options, json))
  };
}

export function createSceneSoundCloneParams(
  options: SoundFieldOptions & { sceneId: string; soundId: string; patchJson?: string }
) {
  const json = optionalJsonObject(options.patchJson, "--patch-json");
  return {
    sceneId: options.sceneId,
    soundId: options.soundId,
    ...optionalPatch(buildSoundFields(options, json))
  };
}

export function createSceneWallCreateParams(options: { sceneId: string; dataJson?: string }) {
  return { sceneId: options.sceneId, data: optionalJsonObject(options.dataJson, "--data-json") ?? {} };
}

export function createSceneWallUpdateParams(options: {
  sceneId: string;
  wallId: string;
  patchJson?: string;
}) {
  return {
    sceneId: options.sceneId,
    wallId: options.wallId,
    patch: assertNonEmptyPatch(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
}

export function createSceneWallCloneParams(options: { sceneId: string; wallId: string; patchJson?: string }) {
  return {
    sceneId: options.sceneId,
    wallId: options.wallId,
    ...optionalPatch(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
}

export function createSceneNoteCreateParams(options: { sceneId: string; dataJson?: string }) {
  return { sceneId: options.sceneId, data: optionalJsonObject(options.dataJson, "--data-json") ?? {} };
}

export function createSceneNoteUpdateParams(options: {
  sceneId: string;
  noteId: string;
  patchJson?: string;
}) {
  return {
    sceneId: options.sceneId,
    noteId: options.noteId,
    patch: assertNonEmptyPatch(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
}

export function createSceneNoteCloneParams(options: { sceneId: string; noteId: string; patchJson?: string }) {
  return {
    sceneId: options.sceneId,
    noteId: options.noteId,
    ...optionalPatch(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
}

export function createSceneDrawingCreateParams(options: { sceneId: string; dataJson?: string }) {
  return { sceneId: options.sceneId, data: optionalJsonObject(options.dataJson, "--data-json") ?? {} };
}

export function createSceneDrawingUpdateParams(options: {
  sceneId: string;
  drawingId: string;
  patchJson?: string;
}) {
  return {
    sceneId: options.sceneId,
    drawingId: options.drawingId,
    patch: assertNonEmptyPatch(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
}

export function createSceneDrawingCloneParams(options: {
  sceneId: string;
  drawingId: string;
  patchJson?: string;
}) {
  return {
    sceneId: options.sceneId,
    drawingId: options.drawingId,
    ...optionalPatch(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
}

export function createSceneLightCreateParams(options: { sceneId: string; dataJson?: string }) {
  return { sceneId: options.sceneId, data: optionalJsonObject(options.dataJson, "--data-json") ?? {} };
}

export function createSceneLightUpdateParams(options: {
  sceneId: string;
  lightId: string;
  patchJson?: string;
}) {
  return {
    sceneId: options.sceneId,
    lightId: options.lightId,
    patch: assertNonEmptyPatch(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
}

export function createSceneLightCloneParams(options: {
  sceneId: string;
  lightId: string;
  patchJson?: string;
}) {
  return {
    sceneId: options.sceneId,
    lightId: options.lightId,
    ...optionalPatch(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
}

export function createSceneTemplateCreateParams(options: { sceneId: string; dataJson?: string }) {
  return { sceneId: options.sceneId, data: optionalJsonObject(options.dataJson, "--data-json") ?? {} };
}

export function createSceneTemplateUpdateParams(options: {
  sceneId: string;
  templateId: string;
  patchJson?: string;
}) {
  return {
    sceneId: options.sceneId,
    templateId: options.templateId,
    patch: assertNonEmptyPatch(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
}

export function createSceneTemplateCloneParams(options: {
  sceneId: string;
  templateId: string;
  patchJson?: string;
}) {
  return {
    sceneId: options.sceneId,
    templateId: options.templateId,
    ...optionalPatch(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
}

export function createSceneRegionCreateParams(options: { sceneId: string; dataJson?: string }) {
  return { sceneId: options.sceneId, data: optionalJsonObject(options.dataJson, "--data-json") ?? {} };
}

export function createSceneRegionUpdateParams(options: {
  sceneId: string;
  regionId: string;
  patchJson?: string;
}) {
  return {
    sceneId: options.sceneId,
    regionId: options.regionId,
    patch: assertNonEmptyPatch(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
}

export function createSceneRegionCloneParams(options: {
  sceneId: string;
  regionId: string;
  patchJson?: string;
}) {
  return {
    sceneId: options.sceneId,
    regionId: options.regionId,
    ...optionalPatch(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
  };
}

export interface RegionBehaviorFieldOptions {
  name?: string;
  disabled?: boolean;
  systemJson?: string;
}

function buildRegionBehaviorFields(options: RegionBehaviorFieldOptions) {
  return {
    ...stringField("name", options.name),
    ...booleanField("disabled", options.disabled),
    ...(options.systemJson ? { system: parseJsonObject(options.systemJson, "--system-json") } : {})
  };
}

export function createSceneRegionBehaviorCreateParams(
  options: RegionBehaviorFieldOptions & { sceneId: string; regionId: string; type: string; dataJson?: string }
) {
  return {
    sceneId: options.sceneId,
    regionId: options.regionId,
    data: {
      type: options.type,
      ...buildRegionBehaviorFields(options),
      ...(optionalJsonObject(options.dataJson, "--data-json") ?? {})
    }
  };
}

export function createSceneRegionBehaviorUpdateParams(
  options: RegionBehaviorFieldOptions & {
    sceneId: string;
    regionId: string;
    behaviorId: string;
    patchJson?: string;
  }
) {
  return {
    sceneId: options.sceneId,
    regionId: options.regionId,
    behaviorId: options.behaviorId,
    patch: assertNonEmptyPatch({
      ...buildRegionBehaviorFields(options),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export function createSceneRegionBehaviorCloneParams(
  options: RegionBehaviorFieldOptions & {
    sceneId: string;
    regionId: string;
    behaviorId: string;
    patchJson?: string;
  }
) {
  return {
    sceneId: options.sceneId,
    regionId: options.regionId,
    behaviorId: options.behaviorId,

    ...optionalPatch({
      ...buildRegionBehaviorFields(options),
      ...(optionalJsonObject(options.patchJson, "--patch-json") ?? {})
    })
  };
}

export function createFileUploadParams(
  options: {
    path: string;
    fromFile: string;
    mimeType?: string;
  },
  uploadLimitBytes: number
) {
  return {
    path: options.path,
    contentBase64: readLocalFileAsBase64(options.fromFile, uploadLimitBytes),
    ...truthyStringField("mimeType", options.mimeType)
  };
}

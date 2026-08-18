#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(HERE, "module.json");
const PACK_SOURCE_DIR = path.join(HERE, "packs");

function parseArgs(argv) {
  const args = {
    dataDir: null,
    installDir: null,
    classicLevel: null,
    remove: false,
    check: false,
    selfTest: false,
    force: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case "--data-dir":
      case "--foundry-data-dir":
        args.dataDir = next();
        break;
      case "--install-dir":
        args.installDir = next();
        break;
      case "--classic-level":
        args.classicLevel = next();
        break;
      case "--remove":
        args.remove = true;
        break;
      case "--check":
        args.check = true;
        break;
      case "--self-test":
        args.selfTest = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown option ${arg} (try --help)`);
    }
  }
  return args;
}

async function readManifest() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  if (!manifest.id || !Array.isArray(manifest.packs) || manifest.packs.length === 0) {
    throw new Error(`${MANIFEST_PATH} is not a usable module manifest (needs id + packs[])`);
  }
  return manifest;
}

async function readPackSources(manifest) {
  const files = (await readdir(PACK_SOURCE_DIR)).filter((name) => name.endsWith(".json")).sort();
  const sources = new Map();
  for (const file of files) {
    const parsed = JSON.parse(await readFile(path.join(PACK_SOURCE_DIR, file), "utf8"));
    if (!parsed.collection || !Array.isArray(parsed.documents)) {
      throw new Error(`${file}: needs a "collection" string and a "documents" array`);
    }
    sources.set(path.basename(file, ".json"), parsed);
  }

  const packs = [];
  for (const entry of manifest.packs) {
    const source = sources.get(entry.name);
    if (!source) {
      throw new Error(`manifest pack "${entry.name}" has no packs/${entry.name}.json source file`);
    }
    if (entry.path !== `packs/${entry.name}`) {
      throw new Error(`manifest pack "${entry.name}" must declare "path": "packs/${entry.name}"`);
    }
    packs.push({ ...entry, source });
    sources.delete(entry.name);
  }
  if (sources.size > 0) {
    throw new Error(`packs/${[...sources.keys()].join(".json, packs/")}.json is not declared in module.json`);
  }
  return packs;
}

function compilePackEntries({ collection, embedded = {}, documents }) {
  const entries = [];
  for (const document of documents) {
    if (!document._id) {
      throw new Error(`a ${collection} fixture document has no _id (Foundry ids are 16 characters)`);
    }
    const parent = { ...document };
    for (const [field, childCollection] of Object.entries(embedded)) {
      const rows = parent[field];
      if (rows === undefined) continue;
      if (!Array.isArray(rows)) {
        throw new Error(`${collection}/${document._id}: "${field}" must be an array of child documents`);
      }
      const ids = [];
      for (const row of rows) {
        if (!row?._id) {
          throw new Error(`${collection}/${document._id}: a "${field}" row has no _id`);
        }
        ids.push(row._id);
        entries.push([`!${collection}.${childCollection}!${document._id}.${row._id}`, row]);
      }
      parent[field] = ids;
    }
    entries.push([`!${collection}!${document._id}`, parent]);
  }

  return entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

async function resolveClassicLevel({ installDir, classicLevel }) {
  const candidates = classicLevel
    ? [classicLevel]
    : [path.join(installDir, "node_modules", "classic-level"), "classic-level"];
  const failures = [];
  for (const candidate of candidates) {
    try {
      const specifier = candidate.startsWith("/") ? `file://${candidate}/index.js` : candidate;
      const mod = await import(specifier);
      const ClassicLevel = mod.ClassicLevel ?? mod.default?.ClassicLevel;
      if (typeof ClassicLevel === "function") return { ClassicLevel, from: candidate };
      failures.push(`${candidate}: no ClassicLevel export`);
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(
    "could not load `classic-level`, which is what writes a Foundry pack database. It is not a " +
      "dependency of this repo — it is resolved from the target install's own node_modules. Pass " +
      "--install-dir <foundry app dir> or --classic-level <path>.\nTried:\n  " +
      failures.join("\n  ")
  );
}

async function writePackDatabase(ClassicLevel, dbPath, entries) {
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new ClassicLevel(dbPath, { keyEncoding: "utf8", valueEncoding: "json" });
  try {
    await db.batch(entries.map(([key, value]) => ({ type: "put", key, value })));
  } finally {
    await db.close();
  }
}

async function readPackDatabase(ClassicLevel, dbPath) {
  const db = new ClassicLevel(dbPath, { keyEncoding: "utf8", valueEncoding: "json" });
  const read = [];
  try {
    for await (const [key, value] of db.iterator()) read.push([key, value]);
  } finally {
    await db.close();
  }
  return read;
}

async function writeAndConfirmPack(ClassicLevel, dbPath, entries) {
  await writePackDatabase(ClassicLevel, dbPath, entries);
  const read = await readPackDatabase(ClassicLevel, dbPath);
  const expected = entries.map(([key]) => key);
  const actual = read.map(([key]) => key);
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    throw new Error(
      `pack ${dbPath} did not store what was written.\n  expected: ${expected.join(", ")}\n  stored:   ${actual.join(", ")}`
    );
  }
  return read;
}

function moduleDirFor(dataDir, manifest) {
  return path.join(dataDir, "modules", manifest.id);
}

async function isOurFixtureDir(dir, manifest) {
  try {
    const installed = JSON.parse(await readFile(path.join(dir, "module.json"), "utf8"));
    return installed.id === manifest.id;
  } catch {
    return false;
  }
}

async function runCheck(dataDir, manifest) {
  const dir = moduleDirFor(dataDir, manifest);
  if (!existsSync(dir)) {
    console.log(`not installed: ${dir} does not exist`);
    return;
  }
  const ours = await isOurFixtureDir(dir, manifest);
  console.log(`${ours ? "installed" : "PRESENT BUT NOT OURS"}: ${dir}`);
  for (const entry of manifest.packs) {
    const packPath = path.join(dir, entry.path);
    let detail = "MISSING";
    try {
      const info = await stat(packPath);
      detail = info.isDirectory() ? `${(await readdir(packPath)).length} files` : "not a directory";
    } catch {
      /* MISSING */
    }
    console.log(`  ${manifest.id}.${entry.name} (${entry.type}) -> ${entry.path}: ${detail}`);
  }
  console.log(
    "\nPacks appear in `fvtt-world-cli compendium list` only while the module is ENABLED in the world " +
      '(Manage Modules -> "fvtt-world-cli Test Packs (fixture)"). Activation lives in the world settings ' +
      "database, which this script deliberately never writes."
  );
}

async function runRemove(dataDir, manifest) {
  const dir = moduleDirFor(dataDir, manifest);
  if (!existsSync(dir)) {
    console.log(`nothing to remove: ${dir} does not exist`);
    return;
  }
  if (!(await isOurFixtureDir(dir, manifest))) {
    throw new Error(
      `${dir} exists but its module.json is not ${manifest.id} — refusing to delete a directory this script did not install`
    );
  }
  await rm(dir, { recursive: true, force: true });
  console.log(`removed ${dir}`);
  console.log(
    "Disable the module in the world's Manage Modules dialog too — Foundry keeps the activation " +
      "entry and will warn about a missing module otherwise."
  );
}

async function runSelfTest(manifest, packs, ClassicLevel, from) {
  const dir = await mkdtemp(path.join(tmpdir(), "fvtt-world-cli-fixture-packs-"));
  try {
    console.log(`classic-level: ${from}`);
    console.log(`temp dir: ${dir}\n`);
    for (const pack of packs) {
      const entries = compilePackEntries(pack.source);
      const read = await writeAndConfirmPack(ClassicLevel, path.join(dir, pack.path), entries);
      console.log(`${manifest.id}.${pack.name} (${pack.type}) — ${read.length} entries:`);
      for (const [key, value] of read) {
        const shape = Array.isArray(value.cards ?? value.sounds)
          ? ` [${(value.cards ?? value.sounds).length} child ids]`
          : "";
        console.log(`  ${key}  name=${JSON.stringify(value.name ?? null)}${shape}`);
      }
      console.log("");
    }
    console.log("self-test OK — every pack compiled and read back identically");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runInstall(dataDir, manifest, packs, ClassicLevel, from, { force }) {
  if (!existsSync(dataDir)) {
    throw new Error(`--data-dir ${dataDir} does not exist (it must be the NESTED Data directory)`);
  }
  const dir = moduleDirFor(dataDir, manifest);
  if (existsSync(dir)) {
    if (!force && !(await isOurFixtureDir(dir, manifest))) {
      throw new Error(`${dir} already exists and is not this fixture — re-run with --force to overwrite`);
    }
    await rm(dir, { recursive: true, force: true });
  }
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "module.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`classic-level: ${from}`);
  for (const pack of packs) {
    const entries = compilePackEntries(pack.source);
    const read = await writeAndConfirmPack(ClassicLevel, path.join(dir, pack.path), entries);
    console.log(`installed ${manifest.id}.${pack.name} (${pack.type}) — ${read.length} entries`);
  }
  console.log(`\ninstalled into ${dir}`);
  console.log(
    'NEXT STEP (manual, once per world): enable "fvtt-world-cli Test Packs (fixture)" in the world\'s ' +
      "Manage Modules dialog, then reload the GM client. `fvtt-world-cli compendium list` should then show " +
      manifest.packs.map((entry) => `${manifest.id}.${entry.name}`).join(", ") +
      "."
  );
  console.log("AFTER THE GATE: re-run this script with --remove (and disable the module).");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      (await readFile(fileURLToPath(import.meta.url), "utf8"))
        .split("\n")
        .filter((line) => line.startsWith(" *") || line.startsWith("/**"))
        .map((line) => line.replace(/^\/\*\*| \*\/?/, ""))
        .join("\n")
    );
    return;
  }

  const manifest = await readManifest();
  const packs = await readPackSources(manifest);

  if (args.check) {
    if (!args.dataDir) throw new Error("--check requires --data-dir");
    await runCheck(path.resolve(args.dataDir), manifest);
    return;
  }
  if (args.remove) {
    if (!args.dataDir) throw new Error("--remove requires --data-dir");
    await runRemove(path.resolve(args.dataDir), manifest);
    return;
  }

  const dataDir = args.dataDir ? path.resolve(args.dataDir) : null;
  if (!dataDir && !args.selfTest) {
    throw new Error("--data-dir is required (or --self-test to compile into a temp dir)");
  }
  const installDir = args.installDir
    ? path.resolve(args.installDir)
    : dataDir
      ? path.resolve(dataDir, "..", "..", "foundryvtt")
      : "";
  const { ClassicLevel, from } = await resolveClassicLevel({ installDir, classicLevel: args.classicLevel });

  if (args.selfTest) {
    await runSelfTest(manifest, packs, ClassicLevel, from);
    return;
  }
  await runInstall(dataDir, manifest, packs, ClassicLevel, from, { force: args.force });
}

main().catch((error) => {
  console.error(`fixture packs: ${error.message}`);
  process.exitCode = 1;
});

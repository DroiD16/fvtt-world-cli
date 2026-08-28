import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMMAND_NAMES,
  DISCOVERABLE_COMMAND_NAMES,
  ERROR_CODES,
  MODULE_ID,
  defaultProfile
} from "../packages/protocol/src/index.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:30000";
const EXPECTED_COMMANDS = [...DISCOVERABLE_COMMAND_NAMES].sort();

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const localCliPath = resolve(repoRoot, "packages/cli/bin/fvtt-world-cli.js");
const localCliConfigHome =
  process.env.FVTT_WORLD_CLI_TEST_XDG_CONFIG_HOME || resolve(repoRoot, ".local/testing/xdg-config");
const localCliEnvironment = {
  ...process.env,
  FVTT_WORLD_CLI_FORCE_SRC: "1",
  XDG_CONFIG_HOME: localCliConfigHome
};

function parseArgs(argv) {
  const options = {
    json: false,
    actorId: process.env.FVTT_WORLD_CLI_TEST_ACTOR_ID || null,
    baseUrl: process.env.FVTT_WORLD_CLI_TEST_BASE_URL || DEFAULT_BASE_URL,
    foundryDataDir: process.env.FVTT_WORLD_CLI_TEST_FOUNDRY_DATA_DIR || null,
    gmControlUrl: process.env.FVTT_WORLD_CLI_TEST_GM_CONTROL || null,
    policyTimeoutBranch: process.env.FVTT_WORLD_CLI_TEST_POLICY_TIMEOUT_BRANCH === "1"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--actor-id") {
      options.actorId = argv[index + 1] || options.actorId;
      index += 1;
      continue;
    }

    if (arg === "--base-url") {
      options.baseUrl = argv[index + 1] || options.baseUrl;
      index += 1;
      continue;
    }

    if (arg === "--foundry-data-dir") {
      options.foundryDataDir = argv[index + 1] || options.foundryDataDir;
      index += 1;
      continue;
    }

    if (arg === "--gm-control") {
      options.gmControlUrl = argv[index + 1] || options.gmControlUrl;
      index += 1;
      continue;
    }

    if (arg === "--policy-timeout-branch") {
      options.policyTimeoutBranch = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!options.foundryDataDir) {
    throw new Error(
      "Foundry Data dir is required; pass --foundry-data-dir <path> or set " +
        "FVTT_WORLD_CLI_TEST_FOUNDRY_DATA_DIR"
    );
  }

  return options;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: npm run smoke:live -- [--json] [--actor-id <actorId>] [--base-url <url>] [--foundry-data-dir <path>]",
      "                              [--gm-control <url>] [--policy-timeout-branch]",
      "",
      "Defaults:",
      `  base URL: ${DEFAULT_BASE_URL}`,
      "  Foundry Data dir: required (no machine-specific default)",
      "",
      "Environment overrides:",
      "  FVTT_WORLD_CLI_TEST_ACTOR_ID",
      "  FVTT_WORLD_CLI_TEST_BASE_URL",
      "  FVTT_WORLD_CLI_TEST_FOUNDRY_DATA_DIR",
      "  FVTT_WORLD_CLI_TEST_GM_CONTROL",
      "  FVTT_WORLD_CLI_TEST_POLICY_TIMEOUT_BRANCH=1",
      "",
      "--gm-control names a loopback endpoint that evaluates JavaScript in the logged-in GM page.",
      'It receives POST {"script": "<javascript>"} — the body of an async function whose return',
      'value must be JSON-serializable — and answers {"ok": true, "value": <result>} or',
      '{"ok": false, "error": "<reason>"}. Without it the command-policy segment is skipped and',
      "every skipped branch is reported in the summary notes; with it the run also relaxes the GM",
      "client's command policy for its own duration, because the shipped defaults hold every delete",
      "for a human decision. --policy-timeout-branch additionally exercises the approval timeout with",
      "a one-minute setting, which costs about a minute of wall clock."
    ].join("\n") + "\n"
  );
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function relativePathToDiskPath(foundryDataDir, relativePath) {
  return resolve(foundryDataDir, ...relativePath.split("/"));
}

function commandLabel(args) {
  return `fvtt-world-cli ${args.join(" ")}`;
}

function runFoundryctl(args) {
  const commandArgs = [localCliPath, ...args, "--json"];

  try {
    const stdout = execFileSync(process.execPath, commandArgs, {
      cwd: repoRoot,
      encoding: "utf8",
      env: localCliEnvironment,

      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });

    return {
      command: commandLabel(args),
      exitCode: 0,
      stdout,
      stderr: "",
      response: JSON.parse(stdout)
    };
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : error?.stdout?.toString("utf8") || "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : error?.stderr?.toString("utf8") || "";
    let response = null;

    try {
      response = stdout ? JSON.parse(stdout) : null;
    } catch {
      response = null;
    }

    return {
      command: commandLabel(args),
      exitCode: Number.isInteger(error?.status) ? error.status : 1,
      stdout,
      stderr,
      response,
      transportError: error instanceof Error ? error.message : String(error)
    };
  }
}

function runFoundryctlPair(argsA, argsB) {
  const dir = mkdtempSync(join(tmpdir(), "fvtt-world-cli-smoke-pair-"));
  const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  const childLine = (args, outPath) =>
    `${shellQuote(process.execPath)} ${shellQuote(localCliPath)} ${args.map(shellQuote).join(" ")} --json > ${shellQuote(outPath)} 2>${shellQuote(`${outPath}.err`)}`;
  const outA = join(dir, "a.json");
  const outB = join(dir, "b.json");

  try {
    execFileSync("bash", ["-c", `${childLine(argsA, outA)} & ${childLine(argsB, outB)} & wait`], {
      cwd: repoRoot,
      encoding: "utf8",
      env: localCliEnvironment,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    // A non-zero child still wrote its JSON body to the file (the CLI prints the error envelope on
    // stdout), so the outcome is read from the files below either way.
  }

  const readRun = (args, outPath) => {
    let stdout = "";
    let stderr = "";
    try {
      stdout = readFileSync(outPath, "utf8");
    } catch {
      stdout = "";
    }
    try {
      stderr = readFileSync(`${outPath}.err`, "utf8");
    } catch {
      stderr = "";
    }
    let response = null;
    try {
      response = stdout ? JSON.parse(stdout) : null;
    } catch {
      response = null;
    }
    return {
      command: commandLabel(args),
      exitCode: response?.ok === false ? 1 : 0,
      stdout,
      stderr,
      response,
      ...(response ? {} : { transportError: stderr || "no JSON body was written by the concurrent child" })
    };
  };

  const runs = [readRun(argsA, outA), readRun(argsB, outB)];
  rmSync(dir, { recursive: true, force: true });
  return runs;
}

function createStep(name, passed, details = {}) {
  return {
    name,
    passed,
    details
  };
}

function createRoundtripContent(stamp, worldId) {
  return (
    [
      "Foundry CLI roundtrip verification",
      `stamp=${stamp}`,
      `world=${worldId}`,
      "payload=The quick brown fox jumps over 13 lazy goblins.",
      "line-end=true"
    ].join("\n") + "\n"
  );
}

const timeoutObservations = [];

const recordedTimeoutRuns = new WeakSet();

function recordTimeoutObservation(run) {
  const error = run?.response?.error;
  if (!error || error?.details?.reason !== "timeout") {
    return;
  }
  if (error.code !== ERROR_CODES.DAEMON_UNAVAILABLE && error.code !== ERROR_CODES.BRIDGE_TIMEOUT) {
    return;
  }
  if (recordedTimeoutRuns.has(run)) {
    return;
  }
  recordedTimeoutRuns.add(run);
  timeoutObservations.push({
    command: typeof error.details?.command === "string" ? error.details.command : run.command,
    code: error.code,
    timeoutMs: error.details?.timeoutMs ?? null
  });
}

function appendTimeoutHazardNote(summary) {
  if (timeoutObservations.length === 0) {
    return;
  }

  const first = timeoutObservations[0];
  const commands = [...new Set(timeoutObservations.map((observation) => observation.command))];
  const combatAffected = commands.some((command) => command.startsWith("combat."));

  summary.notes.push(
    [
      `${timeoutObservations.length} command(s) TIMED OUT (${first.code}, details.reason "timeout"${
        first.timeoutMs ? `, ${first.timeoutMs}ms` : ""
      }); first: ${first.command}. Affected commands: ${commands.join(", ")}.`,
      "MOST LIKELY CAUSE — not a bridge fault: a module or game system WRAPPED the typed Foundry method this verb calls and made it INTERACTIVE (a confirmation dialog). The bridge invokes the method; it cannot answer a dialog, so the wrapper never resolves and the request ages out.",
      'MEASURED example (v13.351 / ghosts-of-saltmarsh, 2026-07-30): `monks-combat-details` patches `Combat.prototype.startCombat` and prompts "Not all Initiative have been rolled" whenever any combatant\'s initiative is null (its `prevent-initiative` setting defaults to ON) — `combat.start` then timed out after 60000ms and stored NOTHING (`round` stayed 0). Remedy: set/roll initiative first (`combat set-initiative` / `combat roll-initiative`), or answer the dialog in a real browser session.',
      "The write-or-not conclusion above is measured for THAT case only. Another wrapper could open its dialog AFTER writing, so treat any timeout as an UNKNOWN outcome and re-read the document before retrying.",
      ...(combatAffected
        ? [
            "Because bridge combat commands share ONE global mutation queue whose tail never settles after a task that never resolves, the LATER combat timeouts in this run may be CONSEQUENCES of the first rather than independent hazards (measured: after a hung `combat.start`, `combat.update` timed out while `chat.create` answered in 0.2s). Reloading the GM client clears it."
          ]
        : []),
      "Check the GM client for an open dialog, and grep the world's active modules for wrappers on the method this verb calls — this list of causes is not exhaustive."
    ].join(" ")
  );
}

function summarizeCommand(run) {
  recordTimeoutObservation(run);

  return {
    command: run.command,
    exitCode: run.exitCode,
    ok: Boolean(run.response?.ok),
    errorCode: run.response?.error?.code || null,
    error:
      run.response?.error ||
      (run.exitCode === 0 ? null : run.transportError || run.stderr.trim() || "Command failed")
  };
}

function printHuman(summary) {
  const lines = [];
  lines.push(`Smoke ok: ${summary.ok}`);
  lines.push(`Bridge world: ${summary.environment.worldId || "unknown"}`);
  lines.push(`Actor fixture: ${summary.environment.actorId || "missing"}`);
  lines.push(`Base URL: ${summary.environment.baseUrl}`);
  lines.push(`Foundry Data dir: ${summary.environment.foundryDataDir}`);

  if (summary.artifacts.remotePath) {
    lines.push(`Remote path: ${summary.artifacts.remotePath}`);
  }

  if (summary.artifacts.diskPath) {
    lines.push(`Disk path: ${summary.artifacts.diskPath}`);
  }

  if (summary.artifacts.httpUrl) {
    lines.push(`HTTP URL: ${summary.artifacts.httpUrl}`);
  }

  if (summary.artifacts.sceneId) {
    lines.push(`Scene fixture: ${summary.artifacts.sceneId}`);
  }

  if (summary.artifacts.itemId) {
    lines.push(`Created item: ${summary.artifacts.itemId}`);
  }

  if (summary.artifacts.journalId) {
    lines.push(`Created journal: ${summary.artifacts.journalId}`);
  }

  if (summary.artifacts.actorItemId) {
    lines.push(`Created actor item: ${summary.artifacts.actorItemId}`);
  }

  if (Array.isArray(summary.notes) && summary.notes.length > 0) {
    lines.push("");
    lines.push("Side effects left behind / performed by Foundry:");
    for (const note of summary.notes) {
      lines.push(`  - ${note}`);
    }
  }

  lines.push("");
  for (const step of summary.steps) {
    lines.push(`${step.passed ? "PASS" : "FAIL"} ${step.name}`);
    for (const key of Object.keys(step.details)) {
      lines.push(`  ${key}: ${JSON.stringify(step.details[key])}`);
    }
  }

  process.stdout.write(lines.join("\n") + "\n");
}

function emitSummary(summary, options) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  printHuman(summary);
}

function markAndPush(summary, name, passed, details = {}) {
  summary.steps.push(createStep(name, passed, details));
  if (!passed) {
    summary.ok = false;
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function createMissingId(prefix, stamp) {
  return `${prefix}-${stamp}-missing`;
}

function compareCommandInventory(actualCommands) {
  const actual = [...new Set(Array.isArray(actualCommands) ? actualCommands : [])].sort();
  const missing = EXPECTED_COMMANDS.filter((command) => !actual.includes(command));
  const unexpected = actual.filter((command) => !EXPECTED_COMMANDS.includes(command));

  return {
    passed: missing.length === 0 && unexpected.length === 0,
    missing,
    unexpected,
    actual,
    expected: EXPECTED_COMMANDS
  };
}

function isCommandSuccess(run) {
  return Boolean(run.response?.ok);
}

function isExpectedError(run, expectedCode) {
  return Boolean(!run.response?.ok && run.response?.error?.code === expectedCode);
}

function findById(entries, id) {
  return Array.isArray(entries) ? entries.find((entry) => entry?.id === id) || null : null;
}

function expectOk(summary, name, run, extra = {}) {
  markAndPush(summary, name, isCommandSuccess(run), { ...summarizeCommand(run), ...extra });
  return run.response?.result ?? null;
}

function expectErr(summary, name, run, code, extra = {}) {
  markAndPush(summary, name, isExpectedError(run, code), { ...summarizeCommand(run), ...extra });
}

const POLICY_SETTING_KEY = "commandPolicy";

const APPROVAL_TIMEOUT_SETTING_KEY = "approvalTimeoutMinutes";

const POLICY_STORAGE_VERSION = 1;

const POLICY_SEGMENT_BRANCHES = Object.freeze([
  { step: "policy.deny(read)", branch: "deny refuses a read" },
  {
    step: "policy.deny(write unchanged)",
    branch: "deny refuses a write and leaves the document unchanged"
  },
  {
    step: "policy.approve(dry-run)",
    branch: "a preview of an approve-listed write returns approvalRequired without asking the GM"
  },
  { step: "policy.approve(allow)", branch: "Allow executes the held command and the change lands" },
  { step: "policy.approve(deny)", branch: "Deny refuses it and leaves the document unchanged" },
  {
    step: "policy.approve(cancel)",
    branch: "a client cancellation is confirmed and clears the approval window"
  },
  {
    step: "policy.discovery",
    branch: "discovery hides the denied command and marks the approve-listed one"
  }
]);

const POLICY_TIMEOUT_BRANCH_STEP = "policy.approve(timeout)";

const POLICY_SEGMENT_ENABLE_HINT =
  "pass --gm-control <url>, or set FVTT_WORLD_CLI_TEST_GM_CONTROL, and run the smoke again";

const POLICY_SEGMENT_ENDPOINT_HINT =
  "make --gm-control name an endpoint that answers for the Foundry client holding the bridge, and run the smoke again";

const POLICY_SEGMENT_FIXTURE_HINT =
  "let the connected client create a journal, which is what the segment writes to, and run the smoke again";

const POLICY_SEGMENT_EARLY_EXIT_HINT =
  "satisfy the failed step that stopped the run above and run the smoke again";

const APPROVAL_POLL_INTERVAL_MS = 250;

const APPROVAL_WINDOW_WAIT_MS = 30_000;
const APPROVAL_WAIT_LINE = "Waiting for GM approval in Foundry";
const APPROVAL_WAIT_LINE_WAIT_MS = 15_000;

const APPROVAL_DECISION_WAIT_MS = 60_000;

const POLICY_PREVIEW_WAIT_MS = 30_000;

const POLICY_TIMEOUT_BRANCH_MINUTES = 1;

const POLICY_TIMEOUT_BRANCH_WAIT_MS = 180_000;

const APPROVAL_WINDOW_SCRIPT = `
const root = document.querySelector(".fvtt-world-cli-approval-window");
const button = root ? root.querySelector('button[data-action="allow"]') : null;
if (!button) return null;
const name = root.querySelector(".fvtt-world-cli-approval-command-name");
return {
  approvalId: button.dataset.approvalId || null,
  command: name ? name.textContent.trim() : null,
  executing: button.disabled === true
};
`;

function approvalClickScript(action, approvalId) {
  return `
const root = document.querySelector(".fvtt-world-cli-approval-window");
const buttons = root ? Array.from(root.querySelectorAll('button[data-action="${action}"]')) : [];
const button = buttons.find((entry) => entry.dataset.approvalId === ${JSON.stringify(approvalId)});
if (!button || button.disabled) return false;
button.click();
return true;
`;
}

function moduleSettingReadScript(key) {
  return `return globalThis.game.settings.get(${JSON.stringify(MODULE_ID)}, ${JSON.stringify(key)}) ?? null;`;
}

function moduleSettingWriteScript(key, value) {
  return `await globalThis.game.settings.set(${JSON.stringify(MODULE_ID)}, ${JSON.stringify(key)}, ${JSON.stringify(value)});
return true;`;
}

function allowEverythingOverrides() {
  return Object.fromEntries(
    COMMAND_NAMES.filter((command) => defaultProfile(command) !== "allow").map((command) => [
      command,
      "allow"
    ])
  );
}

function scratchPolicy(overrides) {
  return { version: POLICY_STORAGE_VERSION, overrides: { ...allowEverythingOverrides(), ...overrides } };
}

function delayMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluateInGmPage(gmControlUrl, script) {
  const response = await fetch(gmControlUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ script })
  });

  if (!response.ok) {
    throw new Error(`GM control endpoint answered HTTP ${response.status}`);
  }

  const body = await response.json();
  if (body?.ok !== true) {
    throw new Error(`GM control evaluation failed: ${body?.error || "no reason reported"}`);
  }

  return body.value ?? null;
}

function startFoundryctl(args) {
  const child = spawn(process.execPath, [localCliPath, ...args, "--json"], {
    cwd: repoRoot,
    env: localCliEnvironment,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const done = new Promise((resolve) => {
    child.on("close", (code) => {
      let response = null;
      try {
        response = stdout ? JSON.parse(stdout) : null;
      } catch {
        response = null;
      }

      resolve({
        command: commandLabel(args),
        exitCode: Number.isInteger(code) ? code : 1,
        stdout,
        stderr,
        response,
        ...(response ? {} : { transportError: stderr.trim() || "the command wrote no JSON body" })
      });
    });
  });

  return { child, done, stderrSoFar: () => stderr };
}

async function settleFoundryctl(call, waitMs) {
  const timer = setTimeout(() => call.child.kill("SIGKILL"), waitMs);
  try {
    return await call.done;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForApprovalWindow(gmControlUrl, command, handledApprovalIds) {
  const deadline = Date.now() + APPROVAL_WINDOW_WAIT_MS;

  for (;;) {
    const view = await evaluateInGmPage(gmControlUrl, APPROVAL_WINDOW_SCRIPT);
    if (
      view &&
      view.command === command &&
      view.executing === false &&
      !handledApprovalIds.has(view.approvalId)
    ) {
      return view;
    }

    if (Date.now() >= deadline) {
      return null;
    }

    await delayMs(APPROVAL_POLL_INTERVAL_MS);
  }
}

async function interruptApprovalWait(summary, call, step) {
  const deadline = Date.now() + APPROVAL_WAIT_LINE_WAIT_MS;

  for (;;) {
    if (call.stderrSoFar().includes(APPROVAL_WAIT_LINE)) {
      break;
    }

    if (Date.now() >= deadline) {
      summary.notes.push(
        `The ${step} branch interrupted its command before that command reported that it was waiting for a GM approval. The cancellation path is installed with that report, so the interrupt may have reached Node's default handler instead, leaving the approval at the head of the GM's queue for the whole approval timeout and any later approval branch reading that survivor rather than its own request.`
      );
      break;
    }

    await delayMs(APPROVAL_POLL_INTERVAL_MS);
  }

  call.child.kill("SIGINT");
}

async function waitForEmptyApprovalWindow(gmControlUrl) {
  const deadline = Date.now() + APPROVAL_WINDOW_WAIT_MS;

  for (;;) {
    const view = await evaluateInGmPage(gmControlUrl, APPROVAL_WINDOW_SCRIPT);
    if (!view) {
      return true;
    }

    if (Date.now() >= deadline) {
      return false;
    }

    await delayMs(APPROVAL_POLL_INTERVAL_MS);
  }
}

function deniedCommands(run) {
  const listed = Array.isArray(run.response?.result) ? run.response.result : [];
  const names = new Set(listed.map((entry) => entry?.command));

  return DISCOVERABLE_COMMAND_NAMES.filter((command) => !names.has(command));
}

async function approvalWindowCleared(summary, gmControlUrl, handledApprovalIds, step) {
  const cleared = await waitForEmptyApprovalWindow(gmControlUrl);
  if (!cleared) {
    const survivor = await evaluateInGmPage(gmControlUrl, APPROVAL_WINDOW_SCRIPT).catch(() => null);
    if (survivor) {
      handledApprovalIds.add(survivor.approvalId);
    }

    summary.notes.push(
      `The ${step} branch asked its command to cancel the approval it was waiting on, and the GM's approval window is still not empty. The bridge cannot withdraw a request the GM never answered: Foundry keeps it until a GM answers it or the approval timeout expires, and until then it is the request that window shows, so approval branches reported after it may have failed on that request rather than on their own.`
    );
  }

  return cleared;
}

async function holdForApproval(gmControlUrl, handledApprovalIds, command, args) {
  const call = startFoundryctl(args);
  const view = await waitForApprovalWindow(gmControlUrl, command, handledApprovalIds);
  if (view) {
    handledApprovalIds.add(view.approvalId);
  }

  return { call, window: view };
}

function reportedStep(summary, name) {
  return summary.steps.some((step) => step.name === name);
}

function createPolicyCoverage() {
  return { segment: null, timeout: null };
}

function recordSkippedPolicySegment(coverage, reason, remedy) {
  if (coverage.segment) {
    return;
  }

  coverage.segment = { reason, remedy };
}

function recordSkippedTimeoutBranch(coverage, reason) {
  if (coverage.timeout) {
    return;
  }

  coverage.timeout = { reason };
}

function flushPolicyCoverageNotes(summary, coverage) {
  const skipped = POLICY_SEGMENT_BRANCHES.filter((entry) => !reportedStep(summary, entry.step));
  if (skipped.length > 0) {
    const { reason, remedy } = coverage.segment ?? {
      reason: "the run ended before the segment",
      remedy: POLICY_SEGMENT_EARLY_EXIT_HINT
    };
    const ran = POLICY_SEGMENT_BRANCHES.length - skipped.length;
    const lead =
      ran === 0
        ? `COMMAND POLICY SEGMENT SKIPPED (${reason})`
        : `COMMAND POLICY SEGMENT INCOMPLETE (${reason}); ${ran} of its ${POLICY_SEGMENT_BRANCHES.length} branches ran and are reported as steps above`;

    summary.notes.push(
      `${lead}. Not verified by this run: ${skipped.map((entry) => entry.branch).join("; ")}. To cover ${skipped.length === 1 ? "it" : "them"}, ${remedy}.`
    );
  }

  if (reportedStep(summary, POLICY_TIMEOUT_BRANCH_STEP)) {
    return;
  }

  summary.notes.push(
    `Approval timeout branch SKIPPED (${coverage.timeout?.reason ?? "the run ended before the segment it belongs to"}); no run verified that an undecided approval expires without executing its command. It costs about a minute of wall clock and is enabled with --policy-timeout-branch (or FVTT_WORLD_CLI_TEST_POLICY_TIMEOUT_BRANCH=1).`
  );
}

function noteAbandonedRun(summary, reason, remedy) {
  summary.notes.push(
    `WHOLE SUITE NOT RUN (${reason}). It stopped at the command policy preconditions, so the steps it reports are the only ones it took: nothing after them — documents, files, scenes, search, error paths — was verified either way, and the failed step above is not one isolated check. ${remedy}.`
  );
}

async function preparePolicyHarness(summary, options, coverage) {
  summary.notes.push(
    "Command policy: the allow path is what the rest of this run exercises. With a GM control endpoint the script sets a policy that allows every command for the run and restores the stored one afterwards; without one it runs only when a policy read from that client confirms it holds no command for approval, because the shipped defaults hold every delete for a human and the suite deletes what it creates."
  );

  if (!options.gmControlUrl) {
    recordSkippedPolicySegment(coverage, "no GM control endpoint was supplied", POLICY_SEGMENT_ENABLE_HINT);
    recordSkippedTimeoutBranch(coverage, "the segment it belongs to did not run");

    const discoveryRun = runFoundryctl(["commands"]);

    if (discoveryRun.response?.policy?.applied !== true) {
      markAndPush(summary, "policy.preconditions", false, {
        ...summarizeCommand(discoveryRun),
        policy: discoveryRun.response?.policy || null,
        reason:
          "The command policy of the connected GM client could not be read, so the listing is the static registry and says nothing about what that client holds for approval."
      });
      noteAbandonedRun(
        summary,
        "the connected GM client's command policy could not be read",
        `An unread policy cannot rule out a delete the client holds for a human decision, and that would block the suite's cleanup until the approval expires, so the run refuses to start rather than hang: make the bridge answer a policy read and run the smoke again, or ${POLICY_SEGMENT_ENABLE_HINT}`
      );
      return { ready: false, restore: null };
    }

    const approvals = Array.isArray(discoveryRun.response?.result)
      ? discoveryRun.response.result.filter((entry) => entry?.approval === true).map((entry) => entry.command)
      : [];

    if (approvals.length > 0) {
      markAndPush(summary, "policy.preconditions", false, {
        ...summarizeCommand(discoveryRun),
        approvalCommands: approvals,
        reason:
          "The connected GM client holds commands for approval, so the suite would block on a human decision. Set those commands to allow in Module Settings → Command permissions, or supply --gm-control so this script can do it for the run."
      });
      noteAbandonedRun(
        summary,
        "the connected GM client holds commands for approval",
        `The suite deletes what it creates, and a delete the connected client holds for a human decision would block that cleanup until the approval expires, so the run refuses to start rather than hang: set those commands to allow in Module Settings → Command permissions, or ${POLICY_SEGMENT_ENABLE_HINT}`
      );
      return { ready: false, restore: null };
    }

    const denied = deniedCommands(discoveryRun);

    if (denied.length > 0) {
      markAndPush(summary, "policy.preconditions", false, {
        ...summarizeCommand(discoveryRun),
        deniedCommands: denied,
        reason:
          "The connected GM client denies commands the suite calls, and discovery drops a denied command from its listing instead of marking it, so the suite would fail on calls this listing never showed. Set those commands to allow in Module Settings → Command permissions, or supply --gm-control so this script can do it for the run."
      });
      noteAbandonedRun(
        summary,
        "the connected GM client denies commands the suite calls",
        `A denied delete refuses the cleanup of everything the suite creates and leaves it in the world, so the run refuses to start rather than litter it: set those commands to allow in Module Settings → Command permissions, or ${POLICY_SEGMENT_ENABLE_HINT}`
      );
      return { ready: false, restore: null };
    }

    markAndPush(summary, "policy.preconditions", true, {
      ...summarizeCommand(discoveryRun),
      approvalCommands: approvals,
      deniedCommands: denied
    });
    return { ready: true, restore: null };
  }

  let previousPolicy = null;
  let previousTimeoutMinutes = null;

  const restoreStoredSettings = async () => {
    const failures = [];
    const restoreSetting = async (key, value) => {
      try {
        await evaluateInGmPage(options.gmControlUrl, moduleSettingWriteScript(key, value));
      } catch (error) {
        failures.push({ setting: key, reason: error.message });
      }
    };

    await restoreSetting(POLICY_SETTING_KEY, previousPolicy);
    if (typeof previousTimeoutMinutes === "number") {
      await restoreSetting(APPROVAL_TIMEOUT_SETTING_KEY, previousTimeoutMinutes);
    }

    return failures;
  };

  let restore = null;

  try {
    previousPolicy =
      (await evaluateInGmPage(options.gmControlUrl, moduleSettingReadScript(POLICY_SETTING_KEY))) ?? {};
    previousTimeoutMinutes = await evaluateInGmPage(
      options.gmControlUrl,
      moduleSettingReadScript(APPROVAL_TIMEOUT_SETTING_KEY)
    );
    restore = restoreStoredSettings;
    await evaluateInGmPage(
      options.gmControlUrl,
      moduleSettingWriteScript(POLICY_SETTING_KEY, scratchPolicy({}))
    );
  } catch (error) {
    markAndPush(summary, "policy.preconditions", false, {
      gmControlUrl: options.gmControlUrl,
      reason: `The GM control endpoint could not read or write the command policy: ${error.message}`
    });
    recordSkippedPolicySegment(
      coverage,
      "the GM control endpoint did not answer",
      POLICY_SEGMENT_ENDPOINT_HINT
    );
    recordSkippedTimeoutBranch(coverage, "the segment it belongs to did not run");
    noteAbandonedRun(
      summary,
      "the GM control endpoint did not answer",
      "The script could not read or write the command policy through the endpoint named by --gm-control, so it could not keep the run from blocking on a human decision: make that endpoint reachable and run the smoke again"
    );
    return { ready: false, restore };
  }

  const confirmRun = runFoundryctl(["commands"]);
  const listed = Array.isArray(confirmRun.response?.result) ? confirmRun.response.result : [];
  const heldForApproval = listed.filter((entry) => entry?.approval === true).map((entry) => entry.command);
  const denied = confirmRun.response?.policy?.applied === true ? deniedCommands(confirmRun) : [];
  const scratchPolicyHolds =
    confirmRun.response?.policy?.applied === true && heldForApproval.length === 0 && denied.length === 0;

  if (!scratchPolicyHolds) {
    markAndPush(summary, "policy.preconditions", false, {
      ...summarizeCommand(confirmRun),
      gmControlUrl: options.gmControlUrl,
      policy: confirmRun.response?.policy || null,
      approvalCommands: heldForApproval,
      deniedCommands: denied,
      reason:
        "The policy this script wrote through the GM control endpoint is not the policy the client holding the bridge reports, so the endpoint drives a different Foundry client than the one that answers commands."
    });
    recordSkippedPolicySegment(
      coverage,
      "the policy written through the GM control endpoint never reached the client holding the bridge",
      POLICY_SEGMENT_ENDPOINT_HINT
    );
    recordSkippedTimeoutBranch(coverage, "the segment it belongs to did not run");
    noteAbandonedRun(
      summary,
      "the policy written through the GM control endpoint never reached the client holding the bridge",
      "The endpoint answers for one Foundry client and another one holds the bridge, so the suite would run under a policy this script neither chose nor knows, and a delete that client holds for a human decision would block its cleanup until the approval expires: point --gm-control at the client that holds the bridge and run the smoke again"
    );
    return { ready: false, restore };
  }

  markAndPush(summary, "policy.preconditions", true, {
    ...summarizeCommand(confirmRun),
    gmControlUrl: options.gmControlUrl,
    previousTimeoutMinutes
  });

  return { ready: true, restore };
}

async function runPolicySegment(summary, options, { stamp, coverage }) {
  const gmControlUrl = options.gmControlUrl;
  if (!gmControlUrl) {
    return;
  }

  const handledApprovalIds = new Set();
  const journalName = `CLI Smoke Policy ${stamp}`;
  const createRun = runFoundryctl(["journal", "create", "--name", journalName]);
  const journalId = createRun.response?.result?.journal?.id || null;
  markAndPush(summary, "policy.fixture", Boolean(journalId), {
    ...summarizeCommand(createRun),
    journalId
  });

  if (!journalId) {
    recordSkippedPolicySegment(
      coverage,
      "the scratch journal the segment writes to could not be created",
      POLICY_SEGMENT_FIXTURE_HINT
    );
    recordSkippedTimeoutBranch(coverage, "the segment it belongs to did not run");
    return;
  }

  try {
    await evaluateInGmPage(
      gmControlUrl,
      moduleSettingWriteScript(
        POLICY_SETTING_KEY,
        scratchPolicy({ "journal.get": "deny", "journal.update": "deny" })
      )
    );

    expectErr(
      summary,
      "policy.deny(read)",
      runFoundryctl(["journal", "get", "--journal-id", journalId]),
      ERROR_CODES.COMMAND_DENIED
    );

    expectErr(
      summary,
      "policy.deny(write)",
      runFoundryctl(["journal", "update", "--journal-id", journalId, "--name", `${journalName} denied`]),
      ERROR_CODES.COMMAND_DENIED
    );

    await evaluateInGmPage(
      gmControlUrl,
      moduleSettingWriteScript(
        POLICY_SETTING_KEY,
        scratchPolicy({ "journal.update": "approve", "chat.delete": "deny" })
      )
    );

    const afterDenyRun = runFoundryctl(["journal", "get", "--journal-id", journalId]);
    const afterDenyName = afterDenyRun.response?.result?.journal?.name || null;
    markAndPush(
      summary,
      "policy.deny(write unchanged)",
      Boolean(afterDenyRun.response?.ok && afterDenyName === journalName),
      {
        ...summarizeCommand(afterDenyRun),
        expectedName: journalName,
        actualName: afterDenyName
      }
    );

    const previewName = `${journalName} preview`;
    const previewRun = await settleFoundryctl(
      startFoundryctl(["--dry-run", "journal", "update", "--journal-id", journalId, "--name", previewName]),
      POLICY_PREVIEW_WAIT_MS
    );
    const previewResult = previewRun.response?.result || null;
    const previewWindow = await evaluateInGmPage(gmControlUrl, APPROVAL_WINDOW_SCRIPT);
    if (previewWindow) {
      handledApprovalIds.add(previewWindow.approvalId);
    }
    markAndPush(
      summary,
      "policy.approve(dry-run)",
      Boolean(
        previewRun.response?.ok &&
        previewResult?.dryRun === true &&
        previewResult?.approvalRequired === true &&
        previewWindow === null
      ),
      {
        ...summarizeCommand(previewRun),
        dryRun: previewResult?.dryRun ?? null,
        approvalRequired: previewResult?.approvalRequired ?? null,
        approvalWindow: previewWindow
      }
    );

    const allowedName = `${journalName} allowed`;
    const allowHold = await holdForApproval(gmControlUrl, handledApprovalIds, "journal.update", [
      "journal",
      "update",
      "--journal-id",
      journalId,
      "--name",
      allowedName
    ]);
    const allowWindow = allowHold.window;
    const allowClicked = allowWindow
      ? await evaluateInGmPage(gmControlUrl, approvalClickScript("allow", allowWindow.approvalId))
      : false;
    if (allowClicked !== true) {
      await interruptApprovalWait(summary, allowHold.call, "policy.approve(allow)");
      await approvalWindowCleared(summary, gmControlUrl, handledApprovalIds, "policy.approve(allow)");
    }
    const allowRun = await settleFoundryctl(allowHold.call, APPROVAL_DECISION_WAIT_MS);
    const allowGetRun = runFoundryctl(["journal", "get", "--journal-id", journalId]);
    markAndPush(
      summary,
      "policy.approve(allow)",
      Boolean(
        allowClicked === true &&
        allowRun.response?.ok &&
        allowRun.response?.result?.journal?.name === allowedName &&
        allowGetRun.response?.result?.journal?.name === allowedName
      ),
      {
        ...summarizeCommand(allowRun),
        approvalWindow: allowWindow,
        clicked: allowClicked,
        waitingLine: allowRun.stderr.trim() || null,
        storedName: allowGetRun.response?.result?.journal?.name || null
      }
    );

    const deniedName = `${journalName} refused`;
    const denyHold = await holdForApproval(gmControlUrl, handledApprovalIds, "journal.update", [
      "journal",
      "update",
      "--journal-id",
      journalId,
      "--name",
      deniedName
    ]);
    const denyWindow = denyHold.window;
    const denyClicked = denyWindow
      ? await evaluateInGmPage(gmControlUrl, approvalClickScript("deny", denyWindow.approvalId))
      : false;
    if (denyClicked !== true) {
      await interruptApprovalWait(summary, denyHold.call, "policy.approve(deny)");
      await approvalWindowCleared(summary, gmControlUrl, handledApprovalIds, "policy.approve(deny)");
    }
    const denyRun = await settleFoundryctl(denyHold.call, APPROVAL_DECISION_WAIT_MS);
    const denyGetRun = runFoundryctl(["journal", "get", "--journal-id", journalId]);
    markAndPush(
      summary,
      "policy.approve(deny)",
      Boolean(
        denyClicked === true &&
        isExpectedError(denyRun, ERROR_CODES.APPROVAL_DENIED) &&
        denyGetRun.response?.result?.journal?.name === allowedName
      ),
      {
        ...summarizeCommand(denyRun),
        approvalWindow: denyWindow,
        clicked: denyClicked,
        storedName: denyGetRun.response?.result?.journal?.name || null
      }
    );

    const cancelHold = await holdForApproval(gmControlUrl, handledApprovalIds, "journal.update", [
      "journal",
      "update",
      "--journal-id",
      journalId,
      "--name",
      `${journalName} cancelled`
    ]);
    const cancelWindow = cancelHold.window;
    await interruptApprovalWait(summary, cancelHold.call, "policy.approve(cancel)");
    const cancelRun = await settleFoundryctl(cancelHold.call, APPROVAL_DECISION_WAIT_MS);
    const cancelWindowCleared = await approvalWindowCleared(
      summary,
      gmControlUrl,
      handledApprovalIds,
      "policy.approve(cancel)"
    );
    const cancelGetRun = runFoundryctl(["journal", "get", "--journal-id", journalId]);
    markAndPush(
      summary,
      "policy.approve(cancel)",
      Boolean(
        isExpectedError(cancelRun, ERROR_CODES.APPROVAL_CANCELLED) &&
        cancelWindowCleared &&
        cancelGetRun.response?.result?.journal?.name === allowedName
      ),
      {
        ...summarizeCommand(cancelRun),
        approvalWindow: cancelWindow,
        windowCleared: cancelWindowCleared,
        storedName: cancelGetRun.response?.result?.journal?.name || null
      }
    );

    const discoveryRun = runFoundryctl(["commands"]);
    const listed = Array.isArray(discoveryRun.response?.result) ? discoveryRun.response.result : [];
    const deniedEntry = listed.find((entry) => entry?.command === "chat.delete") || null;
    const approveEntry = listed.find((entry) => entry?.command === "journal.update") || null;
    markAndPush(
      summary,
      "policy.discovery",
      Boolean(
        discoveryRun.response?.ok &&
        discoveryRun.response?.policy?.applied === true &&
        discoveryRun.response?.policy?.source === "bridge" &&
        deniedEntry === null &&
        approveEntry?.approval === true &&
        listed.length === DISCOVERABLE_COMMAND_NAMES.length - 1
      ),
      {
        ...summarizeCommand(discoveryRun),
        policy: discoveryRun.response?.policy || null,
        deniedCommandListed: deniedEntry !== null,
        approveCommandMarked: approveEntry?.approval ?? null,
        listedCount: listed.length,
        expectedCount: DISCOVERABLE_COMMAND_NAMES.length - 1
      }
    );

    if (options.policyTimeoutBranch) {
      await evaluateInGmPage(
        gmControlUrl,
        moduleSettingWriteScript(APPROVAL_TIMEOUT_SETTING_KEY, POLICY_TIMEOUT_BRANCH_MINUTES)
      );
      const timeoutHold = await holdForApproval(gmControlUrl, handledApprovalIds, "journal.update", [
        "journal",
        "update",
        "--journal-id",
        journalId,
        "--name",
        `${journalName} expired`
      ]);
      const timeoutWindow = timeoutHold.window;
      if (!timeoutWindow) {
        await interruptApprovalWait(summary, timeoutHold.call, POLICY_TIMEOUT_BRANCH_STEP);
        await approvalWindowCleared(summary, gmControlUrl, handledApprovalIds, POLICY_TIMEOUT_BRANCH_STEP);
      }
      const timeoutRun = await settleFoundryctl(timeoutHold.call, POLICY_TIMEOUT_BRANCH_WAIT_MS);
      const timeoutGetRun = runFoundryctl(["journal", "get", "--journal-id", journalId]);
      markAndPush(
        summary,
        POLICY_TIMEOUT_BRANCH_STEP,
        Boolean(
          isExpectedError(timeoutRun, ERROR_CODES.APPROVAL_TIMEOUT) &&
          timeoutGetRun.response?.result?.journal?.name === allowedName
        ),
        {
          ...summarizeCommand(timeoutRun),
          approvalWindow: timeoutWindow,
          timeoutMinutes: POLICY_TIMEOUT_BRANCH_MINUTES,
          storedName: timeoutGetRun.response?.result?.journal?.name || null
        }
      );
    }
  } catch (error) {
    markAndPush(summary, "policy.segment", false, { reason: error.message });
    recordSkippedPolicySegment(
      coverage,
      `the segment stopped on an error: ${error.message}`,
      POLICY_SEGMENT_ENDPOINT_HINT
    );
  } finally {
    recordSkippedTimeoutBranch(
      coverage,
      options.policyTimeoutBranch ? "the segment stopped before it" : "it was not requested"
    );

    await evaluateInGmPage(
      gmControlUrl,
      moduleSettingWriteScript(POLICY_SETTING_KEY, scratchPolicy({}))
    ).catch(() => null);
    expectOk(
      summary,
      "policy.fixture(cleanup)",
      runFoundryctl(["journal", "delete", "--journal-id", journalId])
    );
  }
}

function runExtendedCoverage(
  summary,
  { actorId, targetSceneId, targetSceneActive, gmUserId, stamp, worldId, isV14 = false }
) {
  const created = {
    scenes: [],
    actors: [],
    items: [],
    journals: [],
    tokens: [],
    tiles: [],
    sounds: [],
    walls: [],
    notes: [],
    drawings: [],
    lights: [],
    templates: [],
    regions: [],
    playlists: [],
    macros: [],
    messages: [],
    tables: [],
    combats: [],
    cards: [],
    folders: [],
    combatsToReactivate: []
  };

  try {
    const sceneCreate = expectOk(
      summary,
      "scene.create",
      runFoundryctl([
        "scene",
        "create",
        "--name",
        `Smoke Scene ${stamp}`,
        "--width",
        "1000",
        "--height",
        "800"
      ])
    );
    const createdSceneId = sceneCreate?.scene?.id ?? null;
    if (createdSceneId) {
      created.scenes.push(createdSceneId);
      const sceneClone = expectOk(
        summary,
        "scene.clone",
        runFoundryctl(["scene", "clone", "--scene-id", createdSceneId, "--name", `Smoke Scene Copy ${stamp}`])
      );
      const clonedSceneId = sceneClone?.scene?.id ?? null;
      if (clonedSceneId) {
        created.scenes.push(clonedSceneId);

        markAndPush(summary, "scene.clone(inactive)", sceneClone?.scene?.active === false, {
          active: sceneClone?.scene?.active
        });
      }

      const thumbDryRun = expectOk(
        summary,
        "scene.thumbnail.generate(dry-run)",
        runFoundryctl([
          "--dry-run",
          "scene",
          "thumbnail",
          "generate",
          "--scene-id",
          createdSceneId,
          "--width",
          "64",
          "--height",
          "64"
        ])
      );
      markAndPush(
        summary,
        "scene.thumbnail.generate(dry-run shape: nothing rendered or persisted)",
        thumbDryRun?.dryRun === true &&
          thumbDryRun?.thumbnail?.thumb === null &&
          thumbDryRun?.thumbnail?.storedPath === null &&
          thumbDryRun?.thumbnail?.sizeBytes === null &&
          thumbDryRun?.thumbnail?.persisted === false &&
          thumbDryRun?.thumbnail?.outputWidth === 64 &&
          thumbDryRun?.thumbnail?.outputHeight === 64,
        { thumbnail: thumbDryRun?.thumbnail ?? null, dryRun: thumbDryRun?.dryRun ?? null }
      );

      const thumbRun = expectOk(
        summary,
        "scene.thumbnail.generate",
        runFoundryctl([
          "scene",
          "thumbnail",
          "generate",
          "--scene-id",
          createdSceneId,
          "--width",
          "64",
          "--height",
          "64",
          "--include-thumb"
        ])
      );
      const generatedThumb = thumbRun?.thumbnail ?? null;
      markAndPush(
        summary,
        "scene.thumbnail.generate(rendered + persisted)",
        generatedThumb?.persisted === true &&
          typeof generatedThumb?.thumb === "string" &&
          generatedThumb.thumb.startsWith("data:image/") &&
          typeof generatedThumb?.storedPath === "string" &&
          generatedThumb.storedPath.startsWith("worlds/") &&
          !generatedThumb.storedPath.startsWith("data:") &&
          typeof generatedThumb?.sizeBytes === "number" &&
          generatedThumb.sizeBytes > 0 &&
          generatedThumb?.outputWidth === 64 &&
          generatedThumb?.outputHeight === 64,
        {
          persisted: generatedThumb?.persisted ?? null,
          storedPath: generatedThumb?.storedPath ?? null,
          sizeBytes: generatedThumb?.sizeBytes ?? null,
          outputWidth: generatedThumb?.outputWidth ?? null,
          outputHeight: generatedThumb?.outputHeight ?? null,
          thumbPrefix: typeof generatedThumb?.thumb === "string" ? generatedThumb.thumb.slice(0, 24) : null
        }
      );

      markAndPush(
        summary,
        isV14
          ? "scene.thumbnail.generate(v14: no source dims reported)"
          : "scene.thumbnail.generate(v13: source dims reported)",
        isV14
          ? generatedThumb?.sourceWidth === null && generatedThumb?.sourceHeight === null
          : typeof generatedThumb?.sourceWidth === "number" &&
              typeof generatedThumb?.sourceHeight === "number",
        {
          generation: isV14 ? 14 : 13,
          sourceWidth: generatedThumb?.sourceWidth ?? null,
          sourceHeight: generatedThumb?.sourceHeight ?? null
        }
      );

      const sceneAfterThumb = expectOk(
        summary,
        "scene.get(after thumbnail)",
        runFoundryctl(["scene", "get", "--scene-id", createdSceneId])
      );

      const persistedThumb = sceneAfterThumb?.scene?.thumb ?? null;
      markAndPush(
        summary,
        "scene.thumbnail.generate(managed thumb path persisted on the scene document, uncorrupted)",
        typeof persistedThumb === "string" &&
          persistedThumb.startsWith("worlds/") &&
          !persistedThumb.startsWith("data:") &&
          !persistedThumb.includes("?") &&
          persistedThumb === generatedThumb?.storedPath,
        {
          persistedThumb,
          matchesReportedStoredPath: persistedThumb === generatedThumb?.storedPath,
          hasQuerySuffix: typeof persistedThumb === "string" ? persistedThumb.includes("?") : null
        }
      );

      markAndPush(summary, "scene.thumbnail.generate(extracted asset file left on disk)", true, {
        storedPath: generatedThumb?.storedPath ?? null,
        reclaimedOnSceneDelete: isV14 ? false : true,
        note: isV14
          ? "v14 names the extracted file from an md5 of the image bytes, so the server never reclaims it — delete it manually if the world's assets dir matters"
          : "v13 names it <sceneId>-thumb.webp, reclaimed when the scratch scene is deleted below"
      });

      const fogDryRun = expectOk(
        summary,
        "scene.fog.reset(dry-run count on a non-viewed scratch scene)",
        runFoundryctl(["--dry-run", "scene", "fog", "reset", "--scene-id", createdSceneId])
      );
      markAndPush(
        summary,
        "scene.fog.reset(dry-run shape: count, reset:false, confirmation:not-dispatched, nothing reset)",
        fogDryRun?.dryRun === true &&
          fogDryRun?.reset === false &&
          typeof fogDryRun?.clearedCount === "number" &&
          fogDryRun.clearedCount >= 0 &&
          fogDryRun?.confirmation === "not-dispatched" &&
          fogDryRun?.sceneId === createdSceneId,
        {
          clearedCount: fogDryRun?.clearedCount ?? null,
          reset: fogDryRun?.reset ?? null,
          confirmation: fogDryRun?.confirmation ?? null,
          viewedSceneId: fogDryRun?.viewedSceneId ?? null
        }
      );
      expectErr(
        summary,
        "scene.fog.reset(real reset of a non-viewed scene -> SCENE_NOT_VIEWED)",
        runFoundryctl(["scene", "fog", "reset", "--scene-id", createdSceneId]),
        ERROR_CODES.SCENE_NOT_VIEWED
      );

      markAndPush(summary, "scene.fog.reset(coverage split: NOT full reset coverage)", true, {
        coveredLive: "dry-run count shape + prescriptive SCENE_NOT_VIEWED on a non-viewed scene",
        notVerifiedLive:
          'the real reset (viewed scene, fog docs present, snapshot-id-absence confirmation => confirmation:"observed", FOG_RESET_UNCONFIRMED timeout) was NOT exercised in this run — it needs a viewed scene with explored fog, which this script cannot arrange',
        automatedCoverage: "module router tests (packages/foundry-module/tests/router-scenes.test.js)",
        toVerifyLive:
          'run the documented procedure: docs/commands.md -> "scene.fog.reset" -> "Manual verification of the real reset path"'
      });
    }

    const itemCreate = expectOk(
      summary,
      "item.create(extended)",
      runFoundryctl(["item", "create", "--name", `Smoke Loot ${stamp}`, "--type", "loot"])
    );
    const createdItemId = itemCreate?.item?.id ?? null;
    if (createdItemId) {
      created.items.push(createdItemId);
      const itemClone = expectOk(
        summary,
        "item.clone",
        runFoundryctl(["item", "clone", "--item-id", createdItemId, "--name", `Smoke Loot Copy ${stamp}`])
      );
      if (itemClone?.item?.id) {
        created.items.push(itemClone.item.id);
      }

      const bulkItemA = expectOk(
        summary,
        "item.create(bulk element A)",
        runFoundryctl(["item", "create", "--name", `Smoke Bulk Item A ${stamp}`, "--type", "loot"])
      );
      const bulkItemB = expectOk(
        summary,
        "item.create(bulk element B)",
        runFoundryctl(["item", "create", "--name", `Smoke Bulk Item B ${stamp}`, "--type", "loot"])
      );
      const bulkItemIds = [bulkItemA?.item?.id, bulkItemB?.item?.id].filter(Boolean);
      for (const id of bulkItemIds) created.items.push(id);
      if (bulkItemIds.length === 2) {
        const renamed = `Smoke Bulk Item A renamed ${stamp}`;
        const bulkItemUpdate = expectOk(
          summary,
          "item.update-many(one real change + one no-op, NO scope param)",
          runFoundryctl([
            "item",
            "update-many",
            "--patches-json",
            JSON.stringify([
              { id: bulkItemIds[0], patch: { name: renamed } },

              { id: bulkItemIds[1], patch: { name: `Smoke Bulk Item B ${stamp}` } }
            ])
          ])
        );
        markAndPush(
          summary,
          "item.update-many(updated beside unchanged, both successes, complete, name reported)",
          bulkItemUpdate?.complete === true &&
            bulkItemUpdate?.outcomes?.[0]?.status === "updated" &&
            bulkItemUpdate?.outcomes?.[0]?.name === renamed &&
            bulkItemUpdate?.outcomes?.[1]?.status === "unchanged",
          { observed: bulkItemUpdate?.outcomes }
        );
        const afterItemUpdate = expectOk(
          summary,
          "item.get(after update-many)",
          runFoundryctl(["item", "get", "--item-id", bulkItemIds[0]])
        );
        markAndPush(
          summary,
          "item.update-many(the patch really landed in STORED state)",
          afterItemUpdate?.item?.name === renamed,
          { observed: afterItemUpdate?.item?.name, expected: renamed }
        );

        const itemMissingRun = runFoundryctl([
          "item",
          "update-many",
          "--patches-json",
          JSON.stringify([
            { id: bulkItemIds[0], patch: { name: `${renamed} again` } },
            { id: "nosuchid00000001", patch: { name: "nope" } }
          ])
        ]);
        expectErr(
          summary,
          "item.update-many(unknown id → ITEM_NOT_FOUND)",
          itemMissingRun,
          ERROR_CODES.ITEM_NOT_FOUND
        );
        markAndPush(
          summary,
          "item.update-many(the rejection NAMES the offending element index)",
          itemMissingRun.response?.error?.details?.index === 1,
          { details: itemMissingRun.response?.error?.details ?? null }
        );
        const bulkItemDelete = expectOk(
          summary,
          "item.delete-many(2 live ids + 1 already gone)",
          runFoundryctl([
            "item",
            "delete-many",
            "--ids",
            [bulkItemIds[0], "nosuchid00000001", bulkItemIds[1]].join(",")
          ])
        );
        markAndPush(
          summary,
          "item.delete-many(deleted / alreadyDeleted / deleted, complete, no name key)",
          bulkItemDelete?.complete === true &&
            bulkItemDelete?.outcomes?.map((outcome) => outcome.status).join(",") ===
              "deleted,alreadyDeleted,deleted" &&
            bulkItemDelete.outcomes.every((outcome) => !Object.hasOwn(outcome ?? {}, "name")),
          { observed: bulkItemDelete?.outcomes }
        );
        const stillTracked = new Set(bulkItemIds);
        for (let index = created.items.length - 1; index >= 0; index -= 1) {
          if (stillTracked.has(created.items[index])) created.items.splice(index, 1);
        }
      }

      const userList = expectOk(summary, "user.list", runFoundryctl(["user", "list"]));
      const gmUser = (userList?.users ?? []).find((user) => user?.id === gmUserId) ?? null;
      markAndPush(summary, "user.list(contains GM)", Boolean(gmUser), {
        gmUserId,
        found: Boolean(gmUser)
      });
      if (gmUserId) {
        const userGet = expectOk(summary, "user.get", runFoundryctl(["user", "get", "--user-id", gmUserId]));
        markAndPush(summary, "user.get(id matches)", userGet?.user?.id === gmUserId, {
          expected: gmUserId,
          actual: userGet?.user?.id ?? null
        });
      }
      expectErr(
        summary,
        "user.get(missing → USER_NOT_FOUND)",
        runFoundryctl(["user", "get", "--user-id", createMissingId("user", stamp)]),
        ERROR_CODES.USER_NOT_FOUND
      );

      const settingList = expectOk(
        summary,
        "setting.list",
        runFoundryctl(["setting", "list", "--limit", "200"])
      );
      const settingRows = settingList?.settings ?? [];
      markAndPush(
        summary,
        "setting.list(rows present, total reported)",
        settingRows.length > 0 && typeof settingList?.total === "number",
        {
          rows: settingRows.length,
          total: settingList?.total ?? null,
          hasMore: settingList?.hasMore ?? null
        }
      );

      markAndPush(
        summary,
        "setting.list(no row carries a value)",
        settingRows.length > 0 && settingRows.every((row) => !Object.hasOwn(row ?? {}, "value")),
        {
          rowsWithValue: settingRows.filter((row) => Object.hasOwn(row ?? {}, "value")).map((row) => row?.id)
        }
      );

      const pageSize = 25;
      const settingPageOne = expectOk(
        summary,
        `setting.list(--limit ${pageSize})`,
        runFoundryctl(["setting", "list", "--limit", String(pageSize)])
      );
      const settingPageTwo = expectOk(
        summary,
        `setting.list(--limit ${pageSize} --offset ${pageSize})`,
        runFoundryctl(["setting", "list", "--limit", String(pageSize), "--offset", String(pageSize)])
      );
      const pagedRows = [...(settingPageOne?.settings ?? []), ...(settingPageTwo?.settings ?? [])];
      const pagedTuples = pagedRows.map((row) => [String(row?.namespace ?? ""), String(row?.key ?? "")]);
      const tupleOrdered = pagedTuples.every((tuple, index) => {
        if (index === 0) {
          return true;
        }
        const previous = pagedTuples[index - 1];
        return previous[0] < tuple[0] || (previous[0] === tuple[0] && previous[1] <= tuple[1]);
      });
      const pagedIds = pagedRows.map((row) => String(row?.id ?? ""));
      const duplicatePagedIds = pagedIds.filter((id, index) => pagedIds.indexOf(id) !== index);
      markAndPush(
        summary,
        "setting.list(tuple order holds ACROSS a page boundary, no duplicate ids)",
        pagedRows.length > 0 && tupleOrdered && duplicatePagedIds.length === 0,
        {
          pageOne: settingPageOne?.settings?.length ?? 0,
          pageTwo: settingPageTwo?.settings?.length ?? 0,
          boundary: pagedIds.slice(Math.max(0, pageSize - 1), pageSize + 1),
          duplicates: duplicatePagedIds
        }
      );

      const kindLooksLikeId = settingRows.filter(
        (row) => typeof row?.type?.kind === "string" && row.type.kind === row?.id
      );
      markAndPush(summary, "setting.list(type.kind is never the setting id)", kindLooksLikeId.length === 0, {
        offenders: kindLooksLikeId.map((row) => row?.id)
      });

      const matchesSettingNameFilter = (row, needle) =>
        [row?.namespace, row?.key, row?.name, row?.nameLocalized].some(
          (candidate) => typeof candidate === "string" && candidate.toLowerCase().includes(needle)
        );
      const settingFiltered = expectOk(
        summary,
        "setting.list(--name core)",
        runFoundryctl(["setting", "list", "--name", "core", "--limit", "200"])
      );
      const settingFilteredRows = settingFiltered?.settings ?? [];
      const filterOffenders = settingFilteredRows.filter((row) => !matchesSettingNameFilter(row, "core"));
      markAndPush(
        summary,
        "setting.list(--name matches namespace/key/name/nameLocalized, each field on its own)",
        settingFilteredRows.length > 0 && filterOffenders.length === 0,
        {
          filteredTotal: settingFiltered?.total ?? null,
          unfilteredTotal: settingList?.total ?? null,
          offenders: filterOffenders.slice(0, 5).map((row) => row?.id)
        }
      );

      const dottedProbe = settingFilteredRows.find(
        (row) => typeof row?.namespace === "string" && typeof row?.key === "string" && !row?.unaddressable
      );
      if (dottedProbe) {
        const dottedQuery = `${dottedProbe.namespace}.${dottedProbe.key}`;
        const dottedFiltered = expectOk(
          summary,
          `setting.list(--name ${dottedQuery})`,
          runFoundryctl(["setting", "list", "--name", dottedQuery, "--limit", "200"])
        );
        const dottedRows = dottedFiltered?.settings ?? [];

        const dottedOffenders = dottedRows.filter(
          (row) => !matchesSettingNameFilter(row, dottedQuery.toLowerCase())
        );
        markAndPush(
          summary,
          "setting.list(a query spanning the dot boundary never matches on the id)",
          dottedOffenders.length === 0,
          {
            query: dottedQuery,
            returned: dottedRows.length,
            offenders: dottedOffenders.slice(0, 5).map((row) => row?.id)
          }
        );
      }

      const coreTime = expectOk(
        summary,
        "setting.get(core.time)",
        runFoundryctl(["setting", "get", "--namespace", "core", "--key", "time"])
      );
      markAndPush(
        summary,
        "setting.get(metadata + value present, scope world)",
        coreTime?.setting?.id === "core.time" &&
          coreTime.setting.scope === "world" &&
          Object.hasOwn(coreTime.setting, "value") &&
          Object.hasOwn(coreTime.setting, "nameLocalized"),
        {
          id: coreTime?.setting?.id ?? null,
          scope: coreTime?.setting?.scope ?? null,
          type: coreTime?.setting?.type ?? null,
          value: coreTime?.setting?.value ?? null
        }
      );

      expectErr(
        summary,
        "setting.get(unregistered → SETTING_NOT_FOUND)",
        runFoundryctl(["setting", "get", "--namespace", `smoke-missing-${stamp}`, "--key", "nope"]),
        ERROR_CODES.SETTING_NOT_FOUND
      );

      const credentialsId = `${MODULE_ID}.credentials`;

      const credentialsListing = expectOk(
        summary,
        "setting.list(--name credentials)",
        runFoundryctl(["setting", "list", "--name", "credentials", "--limit", "50"])
      );
      const credentialsListed = (credentialsListing?.settings ?? []).find((row) => row?.id === credentialsId);
      markAndPush(
        summary,
        "setting.list(the bridge's own pairing-credentials row is marked valueRedacted)",
        credentialsListed?.valueRedacted === true,
        {
          id: credentialsListed?.id ?? null,
          scope: credentialsListed?.scope ?? null
        }
      );
      const credentialsResult = expectOk(
        summary,
        "setting.get(own credentials)",
        runFoundryctl(["setting", "get", "--namespace", MODULE_ID, "--key", "credentials"])
      );
      markAndPush(
        summary,
        "setting.get(own credentials REDACTED: value null + marker, credential never read)",
        credentialsResult?.setting?.value === null && credentialsResult.setting.valueRedacted === true,
        {
          value: credentialsResult?.setting?.value ?? null,
          valueRedacted: credentialsResult?.setting?.valueRedacted ?? null,
          scope: credentialsResult?.setting?.scope ?? null
        }
      );

      const itemOwnGet = expectOk(
        summary,
        "item.get(ownership present)",
        runFoundryctl(["item", "get", "--item-id", createdItemId])
      );
      markAndPush(
        summary,
        "item.get(ownership is an object)",
        itemOwnGet?.item != null &&
          typeof itemOwnGet.item.ownership === "object" &&
          itemOwnGet.item.ownership !== null,
        { ownership: itemOwnGet?.item?.ownership ?? null }
      );

      const hide = expectOk(
        summary,
        "item.ownership.set(default 0 hide)",
        runFoundryctl(["item", "ownership", "set", "--item-id", createdItemId, "--default", "0"])
      );
      markAndPush(summary, "item.ownership.set(default==0)", hide?.item?.ownership?.default === 0, {
        ownership: hide?.item?.ownership ?? null
      });

      const ownDry = runFoundryctl([
        "--dry-run",
        "item",
        "ownership",
        "set",
        "--item-id",
        createdItemId,
        "--default",
        "2"
      ]);
      markAndPush(
        summary,
        "item.ownership.set(dry-run merged, dryRun:true, no preview)",
        Boolean(
          ownDry.response?.ok &&
          ownDry.response.result?.dryRun === true &&
          ownDry.response.result?.item?.ownership?.default === 2 &&
          !("preview" in (ownDry.response.result ?? {})) &&
          !("current" in (ownDry.response.result ?? {}))
        ),
        summarizeCommand(ownDry)
      );
      const afterDry = expectOk(
        summary,
        "item.get(after dry-run)",
        runFoundryctl(["item", "get", "--item-id", createdItemId])
      );
      markAndPush(
        summary,
        "item.ownership dry-run did not persist",
        afterDry?.item?.ownership?.default === 0,
        {
          ownership: afterDry?.item?.ownership ?? null
        }
      );

      if (gmUserId) {
        const grant = expectOk(
          summary,
          "item.ownership.set(users merge)",
          runFoundryctl([
            "item",
            "ownership",
            "set",
            "--item-id",
            createdItemId,
            "--users-json",
            JSON.stringify({ [gmUserId]: 3 })
          ])
        );
        markAndPush(
          summary,
          "item.ownership.set(user granted, default preserved)",
          grant?.item?.ownership?.[gmUserId] === 3 && grant?.item?.ownership?.default === 0,
          { ownership: grant?.item?.ownership ?? null }
        );
      }

      expectErr(
        summary,
        "item.ownership.set(unknown user → INVALID_PARAMS)",
        runFoundryctl([
          "item",
          "ownership",
          "set",
          "--item-id",
          createdItemId,
          "--users-json",
          JSON.stringify({ "ghost-user": 3 })
        ]),
        ERROR_CODES.INVALID_PARAMS
      );
    }

    const journalCreate = expectOk(
      summary,
      "journal.create(extended)",
      runFoundryctl([
        "journal",
        "create",
        "--name",
        `Smoke Journal ${stamp}`,
        "--pages-json",
        JSON.stringify([{ name: "Page A", type: "text", text: { content: "a" } }])
      ])
    );
    const createdJournalId = journalCreate?.journal?.id ?? null;
    const firstPageId = journalCreate?.journal?.pages?.[0]?.id ?? null;
    if (createdJournalId) {
      created.journals.push(createdJournalId);
      if (firstPageId) {
        expectOk(
          summary,
          "journal.update(deletePage)",
          runFoundryctl([
            "journal",
            "update",
            "--journal-id",
            createdJournalId,
            "--delete-page-ids",
            firstPageId
          ])
        );
      }
      const journalClone = expectOk(
        summary,
        "journal.clone",
        runFoundryctl([
          "journal",
          "clone",
          "--journal-id",
          createdJournalId,
          "--name",
          `Smoke Journal Copy ${stamp}`
        ])
      );
      if (journalClone?.journal?.id) {
        created.journals.push(journalClone.journal.id);
      }

      const pageOpPeerId = journalClone?.journal?.id ?? "nosuchjournal001";
      for (const pageOp of ["pages", "deletePageIds"]) {
        const pageOpValue = pageOp === "pages" ? [{ name: "Nope", type: "text" }] : ["nosuchid00000001"];
        const pageOpRun = runFoundryctl([
          "journal",
          "update-many",
          "--patches-json",
          JSON.stringify([
            { id: createdJournalId, patch: { name: `Smoke Journal ${stamp}` } },
            { id: pageOpPeerId, patch: { [pageOp]: pageOpValue } }
          ])
        ]);
        expectErr(
          summary,
          `journal.update-many(a ${pageOp} key inside an element → INVALID_PARAMS)`,
          pageOpRun,
          ERROR_CODES.INVALID_PARAMS
        );
        markAndPush(
          summary,
          `journal.update-many(the ${pageOp} rejection lists the four fields the element DOES accept)`,
          (pageOpRun?.response?.error?.details?.errors ?? []).some(
            (message) =>
              typeof message === "string" &&
              message.includes(`patch.${pageOp}`) &&
              message.includes("allowed fields: name, folder, sort, flags")
          ),
          { errors: pageOpRun?.response?.error?.details?.errors ?? null }
        );
      }

      const journalBulkName = `Smoke Journal bulk ${stamp}`;
      const journalBulkUpdate = expectOk(
        summary,
        "journal.update-many(document-only patch)",
        runFoundryctl([
          "journal",
          "update-many",
          "--patches-json",
          JSON.stringify([{ id: createdJournalId, patch: { name: journalBulkName } }])
        ])
      );
      markAndPush(
        summary,
        "journal.update-many(updated, name reported, no scope param)",
        journalBulkUpdate?.complete === true &&
          journalBulkUpdate?.outcomes?.[0]?.status === "updated" &&
          journalBulkUpdate?.outcomes?.[0]?.name === journalBulkName,
        { observed: journalBulkUpdate?.outcomes }
      );
    }

    const searchNameMarker = `Zsmknamemarker${stamp}`;
    const searchBodyMarker = `Qbodytextonly${stamp}`;
    const searchJournalCreate = expectOk(
      summary,
      "journal.create(search fixture)",
      runFoundryctl([
        "journal",
        "create",
        "--name",
        `Smoke Search ${searchNameMarker}`,
        "--pages-json",
        JSON.stringify([
          { name: "Search Page", type: "text", text: { content: `body text ${searchBodyMarker}`, format: 1 } }
        ])
      ])
    );
    const searchJournalId = searchJournalCreate?.journal?.id ?? null;
    if (searchJournalId) {
      created.journals.push(searchJournalId);

      const searchByName = expectOk(
        summary,
        "world.search(name marker)",
        runFoundryctl(["world", "search", "--query", searchNameMarker])
      );
      const nameHits = searchByName?.results ?? [];
      markAndPush(
        summary,
        "world.search(finds the journal by its NAME; refKey is world:<uuid>)",
        nameHits.length === 1 &&
          nameHits[0]?.documentType === "JournalEntry" &&
          nameHits[0]?.id === searchJournalId &&
          nameHits[0]?.refKey === `world:JournalEntry.${searchJournalId}` &&
          nameHits[0]?.resolved === true &&
          nameHits[0]?.source === "world" &&
          typeof nameHits[0]?.score === "number" &&
          nameHits[0]?.snippet === null,
        { hits: nameHits.length, first: nameHits[0] ?? null, journalId: searchJournalId }
      );

      markAndPush(
        summary,
        "world.search(exact total/hasMore + echoed mode/source)",
        searchByName?.total === 1 &&
          searchByName?.hasMore === false &&
          searchByName?.mode === "name" &&
          searchByName?.includeCompendia === false &&
          searchByName?.source === null,
        {
          total: searchByName?.total ?? null,
          hasMore: searchByName?.hasMore ?? null,
          mode: searchByName?.mode ?? null,
          source: searchByName?.source ?? null
        }
      );

      markAndPush(
        summary,
        "world.search(index.world reported; index.compendium null when not requested)",
        searchByName?.index?.world?.status === "ready" &&
          typeof searchByName?.index?.world?.entryCount === "number" &&
          searchByName.index.world.entryCount > 0 &&
          searchByName?.index?.world?.matchCount === 1 &&
          typeof searchByName?.index?.world?.textTruncatedCount === "number" &&
          searchByName?.index?.compendium === null,
        { world: searchByName?.index?.world ?? null, compendium: searchByName?.index?.compendium ?? null }
      );

      const searchByBody = expectOk(
        summary,
        "world.search(body marker in name mode)",
        runFoundryctl(["world", "search", "--query", searchBodyMarker])
      );
      markAndPush(
        summary,
        "world.search(name mode does NOT match page BODY text — chunk 8.3 adds --mode full)",
        (searchByBody?.results ?? []).length === 0 && searchByBody?.total === 0,
        { hits: (searchByBody?.results ?? []).length, total: searchByBody?.total ?? null }
      );

      const searchFull = expectOk(
        summary,
        "world.search(--mode full, body marker)",
        runFoundryctl(["world", "search", "--query", searchBodyMarker, "--mode", "full"])
      );
      const fullHits = searchFull?.results ?? [];
      markAndPush(
        summary,
        "world.search(--mode full FINDS the page body marker name mode could not)",
        fullHits.length === 1 &&
          fullHits[0]?.documentType === "JournalEntryPage" &&
          fullHits[0]?.refKey ===
            `world:JournalEntry.${searchJournalId}.JournalEntryPage.${fullHits[0]?.id}` &&
          fullHits[0]?.resolved === true &&
          searchFull?.mode === "full" &&
          searchFull?.total === 1 &&
          searchFull?.hasMore === false,
        {
          hits: fullHits.length,
          first: fullHits[0] ?? null,
          total: searchFull?.total ?? null,
          hasMore: searchFull?.hasMore ?? null,
          mode: searchFull?.mode ?? null
        }
      );

      const fullSnippet = fullHits[0]?.snippet ?? null;
      const markerTerms = searchBodyMarker.split(/[\n\r\p{Z}\p{P}]+/u).filter((term) => term.length > 0);
      const snippetSlices = (fullSnippet?.matches ?? []).map((match) =>
        String(fullSnippet.text).slice(match.start, match.start + match.length)
      );
      markAndPush(
        summary,
        "world.search(full-mode snippet is plain text with USABLE per-term UTF-16 match offsets)",
        Boolean(fullSnippet) &&
          fullSnippet.field === "text" &&
          typeof fullSnippet.text === "string" &&
          fullSnippet.text.length > 0 &&
          fullSnippet.text.length <= 240 &&
          !/<\/?[A-Za-z!?]/.test(fullSnippet.text) &&
          fullSnippet.text.includes(searchBodyMarker) &&
          snippetSlices.length > 0 &&
          snippetSlices.length <= 5 &&
          snippetSlices.every((slice) => markerTerms.includes(slice)) &&
          snippetSlices[0] === markerTerms[0] &&
          fullSnippet.truncated === false,
        { snippet: fullSnippet, snippetSlices, markerTerms }
      );

      const fullByName = expectOk(
        summary,
        "world.search(--mode full, name marker)",
        runFoundryctl(["world", "search", "--query", searchNameMarker, "--mode", "full"])
      );
      markAndPush(
        summary,
        "world.search(--mode full still finds the NAME marker, snippet from the name field)",
        (fullByName?.results ?? []).length === 1 &&
          fullByName.results[0]?.documentType === "JournalEntry" &&
          fullByName.results[0]?.id === searchJournalId &&
          fullByName.results[0]?.snippet?.field === "name" &&
          String(fullByName.results[0]?.snippet?.text ?? "").includes(searchNameMarker) &&
          (fullByName.results[0]?.snippet?.matches ?? []).length > 0 &&
          searchNameMarker
            .split(/[\n\r\p{Z}\p{P}]+/u)
            .includes(
              String(fullByName.results[0].snippet.text).slice(
                fullByName.results[0].snippet.matches[0].start,
                fullByName.results[0].snippet.matches[0].start +
                  fullByName.results[0].snippet.matches[0].length
              )
            ),
        { total: fullByName?.total ?? null, first: fullByName?.results?.[0] ?? null }
      );

      const badModeRefusal = runFoundryctl([
        "world",
        "search",
        "--query",
        searchNameMarker,
        "--mode",
        "text"
      ]);
      markAndPush(
        summary,
        "world.search(--mode text rejected locally by the CLI choice list, no round-trip)",
        badModeRefusal.exitCode !== 0,
        { exitCode: badModeRefusal.exitCode, stderr: (badModeRefusal.stderr ?? "").slice(0, 200) }
      );

      const typedHit = expectOk(
        summary,
        "world.search(--types JournalEntry)",
        runFoundryctl(["world", "search", "--query", searchNameMarker, "--types", "JournalEntry"])
      );
      const typedMiss = expectOk(
        summary,
        "world.search(--types Actor)",
        runFoundryctl(["world", "search", "--query", searchNameMarker, "--types", "Actor"])
      );
      markAndPush(
        summary,
        "world.search(types filter narrows the EXACT total, not just the page)",
        (typedHit?.results ?? []).length === 1 &&
          typedMiss?.total === 0 &&
          (typedMiss?.results ?? []).length === 0,
        { typed: (typedHit?.results ?? []).length, missTotal: typedMiss?.total ?? null }
      );

      const searchPacks = expectOk(
        summary,
        "world.search(--include-compendia)",
        runFoundryctl(["world", "search", "--query", "sword", "--include-compendia", "--limit", "50"])
      );
      const packRows = (searchPacks?.results ?? []).filter((ref) => ref?.source === "compendium");
      const worldRows = (searchPacks?.results ?? []).filter((ref) => ref?.source === "world");
      markAndPush(
        summary,
        "world.search(compendium corpus BUILT and reported when requested)",
        searchPacks?.index?.compendium?.status === "ready" &&
          typeof searchPacks?.index?.compendium?.skippedPackCount === "number" &&
          typeof searchPacks?.index?.compendium?.failedPackCount === "number",
        { compendium: searchPacks?.index?.compendium ?? null, packRows: packRows.length }
      );

      const firstPackIndex = (searchPacks?.results ?? []).findIndex((ref) => ref?.source === "compendium");
      const lastWorldIndex = (searchPacks?.results ?? []).reduce(
        (last, ref, index) => (ref?.source === "world" ? index : last),
        -1
      );
      markAndPush(
        summary,
        "world.search(SECTIONED: world rows precede pack rows)",
        firstPackIndex === -1 || lastWorldIndex === -1 || lastWorldIndex < firstPackIndex,
        {
          worldRows: worldRows.length,
          packRows: packRows.length,
          lastWorldIndex,
          firstPackIndex,
          note:
            packRows.length === 0 || worldRows.length === 0
              ? "one section empty — the ordering assertion is vacuous for this world/pack library"
              : "both sections non-empty"
        }
      );

      if (packRows.length > 0) {
        markAndPush(
          summary,
          "world.search(merged call: a pack ref carries pack.id + label and a pack:<packId>:<entryId> refKey)",
          typeof packRows[0]?.pack?.id === "string" &&
            packRows[0].pack.id.length > 0 &&
            packRows[0]?.refKey === `pack:${packRows[0].pack.id}:${packRows[0].id}` &&
            packRows[0]?.snippet === null,
          { first: packRows[0] ?? null }
        );
      }

      const codePointLength = (value) => [...value].length;
      const packQueryFromEntryName = (name) => {
        const value = typeof name === "string" ? name.normalize("NFC").trim() : "";
        if (!value) {
          return null;
        }
        const terms = [];
        let length = 0;
        for (const token of value.split(/[\n\r\p{Z}\p{P}]+/u)) {
          if (codePointLength(token) < 2) {
            continue;
          }
          const next = length + (terms.length > 0 ? 1 : 0) + token.length;
          if (next > 256) {
            break;
          }
          terms.push(token);
          length = next;
        }

        return terms.length > 0 ? terms.join(" ") : null;
      };

      const SEARCHABLE_PACK_TYPES = new Set([
        "Actor",
        "Item",
        "JournalEntry",
        "Scene",
        "Macro",
        "Playlist",
        "RollTable",
        "Cards",
        "ActiveEffect"
      ]);
      const searchPackList = expectOk(
        summary,
        "compendium.list(world.search pack preflight)",
        runFoundryctl(["compendium", "list", "--limit", "500"])
      );
      const searchPackInventory = Array.isArray(searchPackList?.packs) ? searchPackList.packs : [];
      let packProbe = null;
      for (const candidate of searchPackInventory) {
        if (!candidate?.id || !SEARCHABLE_PACK_TYPES.has(candidate?.type)) {
          continue;
        }

        const packIndex = runFoundryctl(["compendium", "index", "--pack", candidate.id, "--limit", "5"]);
        if (!isCommandSuccess(packIndex)) {
          continue;
        }
        for (const entry of packIndex?.response?.result?.entries ?? []) {
          const query = packQueryFromEntryName(entry?.name);
          if (entry?.id && query) {
            packProbe = { pack: candidate, entry, query };
            break;
          }
        }
        if (packProbe) {
          break;
        }
      }
      if (!packProbe) {
        summary.notes.push(
          `world.search: this world exposes no compendium pack of a searchable type holding a usable named entry (${searchPackInventory.length} packs listed) — the PACK side of world.search is covered by unit/router tests only for this run; to live-test it, install the repo fixture packs (node scripts/fixtures/foundry-test-packs/install.mjs --data-dir <Data>, then enable the module in the world) and re-run`
        );
      } else {
        const packSearch = expectOk(
          summary,
          "world.search(--source pack, query taken from a REAL pack entry)",
          runFoundryctl([
            "world",
            "search",
            "--query",
            packProbe.query,
            "--include-compendia",
            "--source",
            "pack",
            "--types",
            packProbe.pack.type,
            "--limit",
            "50"
          ])
        );
        const probeRows = (packSearch?.results ?? []).filter((ref) => ref?.source === "compendium");

        markAndPush(
          summary,
          "world.search(--source pack: pack rows OBSERVED, every row a resolved pack:<packId>:<entryId> ref)",
          probeRows.length > 0 &&
            probeRows.length === (packSearch?.results ?? []).length &&
            packSearch?.index?.compendium?.status === "ready" &&
            packSearch?.index?.world === null &&
            probeRows.every(
              (ref) =>
                typeof ref?.pack?.id === "string" &&
                ref.pack.id.length > 0 &&
                ref?.refKey === `pack:${ref.pack.id}:${ref.id}` &&
                ref?.documentType === packProbe.pack.type &&
                ref?.resolved === true &&
                ref?.snippet === null &&
                (ref?.parents ?? []).length === 0 &&
                typeof ref?.score === "number"
            ),
          {
            pack: packProbe.pack.id,
            type: packProbe.pack.type,
            entryId: packProbe.entry.id,
            query: packProbe.query,
            packRows: probeRows.length,
            totalRows: (packSearch?.results ?? []).length,
            total: packSearch?.total ?? null,
            compendium: packSearch?.index?.compendium ?? null
          }
        );

        const expectedPackRefKey = `pack:${packProbe.pack.id}:${packProbe.entry.id}`;
        const targetFound = probeRows.some((ref) => ref?.refKey === expectedPackRefKey);
        if ((packSearch?.total ?? 0) <= 50) {
          markAndPush(
            summary,
            "world.search(--source pack finds the SPECIFIC pack entry the query was taken from)",
            targetFound,
            { expectedRefKey: expectedPackRefKey, total: packSearch?.total ?? null, rows: probeRows.length }
          );
        } else {
          summary.notes.push(
            `world.search: the pack-entry probe query matched ${packSearch?.total} rows, more than the 50-row page, so the specific-entry arm was recorded rather than asserted (target ${expectedPackRefKey}, found on page: ${targetFound})`
          );
        }

        const packSearchFull = expectOk(
          summary,
          "world.search(--mode full --source pack, same REAL pack entry query)",
          runFoundryctl([
            "world",
            "search",
            "--query",
            packProbe.query,
            "--include-compendia",
            "--source",
            "pack",
            "--types",
            packProbe.pack.type,
            "--mode",
            "full",
            "--limit",
            "50"
          ])
        );
        const probeRowsFull = (packSearchFull?.results ?? []).filter((ref) => ref?.source === "compendium");
        markAndPush(
          summary,
          "world.search(--mode full: pack rows STILL returned, ranked among themselves, snippet ALWAYS null)",
          probeRowsFull.length > 0 &&
            probeRowsFull.length === (packSearchFull?.results ?? []).length &&
            packSearchFull?.mode === "full" &&
            packSearchFull?.index?.compendium?.status === "ready" &&
            packSearchFull?.index?.world === null &&
            typeof packSearchFull?.total === "number" &&
            typeof packSearchFull?.hasMore === "boolean" &&
            probeRowsFull.every(
              (ref) =>
                ref?.snippet === null &&
                ref?.resolved === true &&
                typeof ref?.pack?.id === "string" &&
                ref.refKey === `pack:${ref.pack.id}:${ref.id}` &&
                typeof ref?.score === "number"
            ),
          {
            mode: packSearchFull?.mode ?? null,
            packRows: probeRowsFull.length,
            totalRows: (packSearchFull?.results ?? []).length,
            total: packSearchFull?.total ?? null,
            hasMore: packSearchFull?.hasMore ?? null,
            compendium: packSearchFull?.index?.compendium ?? null,
            snippetsNull: probeRowsFull.every((ref) => ref?.snippet === null)
          }
        );

        if ((packSearch?.total ?? 0) <= 50 && (packSearchFull?.total ?? 0) <= 50) {
          const nameKeys = probeRows.map((ref) => ref?.refKey).sort();
          const fullKeys = probeRowsFull.map((ref) => ref?.refKey).sort();
          markAndPush(
            summary,
            "world.search(--mode full returns the SAME pack rows as name mode — packs are name-only in both)",
            nameKeys.length === fullKeys.length && nameKeys.every((key, index) => key === fullKeys[index]),
            { nameRows: nameKeys.length, fullRows: fullKeys.length }
          );
        } else {
          summary.notes.push(
            `world.search: the pack probe matched more than the 50-row page in at least one mode (name ${packSearch?.total}, full ${packSearchFull?.total}), so the name-vs-full row-set identity was recorded rather than asserted`
          );
        }
      }

      const sourcePairRun = runFoundryctl([
        "world",
        "search",
        "--query",
        searchNameMarker,
        "--source",
        "pack"
      ]);
      expectErr(
        summary,
        "world.search(--source pack without --include-compendia → INVALID_PARAMS)",
        sourcePairRun,
        ERROR_CODES.INVALID_PARAMS
      );
      markAndPush(
        summary,
        "world.search(pairing refusal names includeCompendia)",
        String(sourcePairRun.response?.error?.message ?? "").includes("includeCompendia"),
        { message: (sourcePairRun.response?.error?.message ?? "").slice(0, 200) }
      );

      const sourceWorld = expectOk(
        summary,
        "world.search(--source world + --include-compendia)",
        runFoundryctl([
          "world",
          "search",
          "--query",
          searchNameMarker,
          "--include-compendia",
          "--source",
          "world"
        ])
      );
      markAndPush(
        summary,
        "world.search(--source world does NOT build the pack corpus)",
        sourceWorld?.index?.compendium === null &&
          sourceWorld?.source === "world" &&
          sourceWorld?.total === 1,
        { compendium: sourceWorld?.index?.compendium ?? null, total: sourceWorld?.total ?? null }
      );

      expectErr(
        summary,
        "world.search(1-character query → INVALID_PARAMS)",
        runFoundryctl(["world", "search", "--query", "a"]),
        ERROR_CODES.INVALID_PARAMS
      );

      for (const padded of ["a,", "  ,, "]) {
        const paddedRun = runFoundryctl(["world", "search", "--query", padded]);
        expectErr(
          summary,
          `world.search(padded query ${JSON.stringify(padded)} → INVALID_PARAMS)`,
          paddedRun,
          ERROR_CODES.INVALID_PARAMS
        );
        markAndPush(
          summary,
          `world.search(effective-length refusal names the searchable content for ${JSON.stringify(padded)})`,
          String(paddedRun.response?.error?.message ?? "").includes("searchable character(s)") &&
            typeof paddedRun.response?.error?.details?.effectiveLength === "number",
          {
            message: (paddedRun.response?.error?.message ?? "").slice(0, 200),
            effectiveLength: paddedRun.response?.error?.details?.effectiveLength ?? null
          }
        );
      }

      const renamedMarker = `${searchNameMarker}renamed`;
      expectOk(
        summary,
        "journal.update(rename search fixture)",
        runFoundryctl([
          "journal",
          "update",
          "--journal-id",
          searchJournalId,
          "--name",
          `Smoke Search ${renamedMarker}`
        ])
      );
      const afterRename = expectOk(
        summary,
        "world.search(after rename)",
        runFoundryctl(["world", "search", "--query", renamedMarker])
      );
      markAndPush(
        summary,
        "world.search(a rename INVALIDATES the index and the new name is findable)",
        (afterRename?.results ?? []).length === 1 && afterRename?.results?.[0]?.id === searchJournalId,
        { hits: (afterRename?.results ?? []).length, first: afterRename?.results?.[0] ?? null }
      );
    }

    const pageJournalCreate = expectOk(
      summary,
      "journal.create(text+image pages)",
      runFoundryctl([
        "journal",
        "create",
        "--name",
        `Smoke Journal Pages ${stamp}`,
        "--pages-json",
        JSON.stringify([
          { name: "Text Page", type: "text", text: { content: "hello", format: 1 } },
          {
            name: "Image Page",
            type: "image",
            src: "icons/svg/book.svg",
            image: { caption: "first caption" },
            title: { level: 2 }
          }
        ])
      ])
    );
    const pageJournalId = pageJournalCreate?.journal?.id ?? null;
    if (pageJournalId) {
      created.journals.push(pageJournalId);
      const createdImagePage =
        pageJournalCreate?.journal?.pages?.find((page) => page.type === "image") ?? null;
      const createdTextPage = pageJournalCreate?.journal?.pages?.find((page) => page.type === "text") ?? null;
      const imagePageId = createdImagePage?.id ?? null;
      const textPageId = createdTextPage?.id ?? null;

      const pageGet = expectOk(
        summary,
        "journal.get(page fields)",
        runFoundryctl(["journal", "get", "--journal-id", pageJournalId])
      );
      const gotImagePage = pageGet?.journal?.pages?.find((page) => page.id === imagePageId) ?? null;
      markAndPush(
        summary,
        "journal.get(caption/title/category round-trip)",
        Boolean(
          gotImagePage?.image?.caption === "first caption" &&
          gotImagePage?.title?.level === 2 &&
          gotImagePage?.category === null &&
          Array.isArray(pageGet?.journal?.categories)
        ),
        {
          caption: gotImagePage?.image?.caption ?? null,
          titleLevel: gotImagePage?.title?.level ?? null,
          category: gotImagePage?.category ?? null
        }
      );

      markAndPush(
        summary,
        "journal.get(entry+page ownership present)",
        pageGet?.journal != null &&
          typeof pageGet.journal.ownership === "object" &&
          gotImagePage != null &&
          typeof gotImagePage.ownership === "object",
        {
          entryOwnership: pageGet?.journal?.ownership ?? null,
          pageOwnership: gotImagePage?.ownership ?? null
        }
      );

      const journalHide = expectOk(
        summary,
        "journal.ownership.set(entry default 0)",
        runFoundryctl(["journal", "ownership", "set", "--journal-id", pageJournalId, "--default", "0"])
      );
      markAndPush(
        summary,
        "journal.ownership.set(entry default==0)",
        journalHide?.journal?.ownership?.default === 0,
        {
          ownership: journalHide?.journal?.ownership ?? null
        }
      );

      expectErr(
        summary,
        "journal.ownership.set(entry -1 → INVALID_PARAMS)",
        runFoundryctl(["journal", "ownership", "set", "--journal-id", pageJournalId, "--default", "-1"]),
        ERROR_CODES.INVALID_PARAMS
      );
      if (imagePageId) {
        const pageInherit = expectOk(
          summary,
          "journal.ownership.set(page inherit -1)",
          runFoundryctl([
            "journal",
            "ownership",
            "set",
            "--journal-id",
            pageJournalId,
            "--page-id",
            imagePageId,
            "--default",
            "-1"
          ])
        );
        const inheritedPage = pageInherit?.journal?.pages?.find((page) => page.id === imagePageId) ?? null;
        markAndPush(
          summary,
          "journal.ownership.set(page ownership default==-1)",
          inheritedPage?.ownership?.default === -1,
          {
            ownership: inheritedPage?.ownership ?? null
          }
        );
      }

      if (imagePageId) {
        const dryCaption = runFoundryctl([
          "--dry-run",
          "journal",
          "update",
          "--journal-id",
          pageJournalId,
          "--pages-json",
          JSON.stringify([{ id: imagePageId, image: { caption: "second caption" } }])
        ]);
        const dryPreviewImage =
          dryCaption.response?.result?.journal?.pages?.find((page) => page.id === imagePageId) ?? null;
        markAndPush(
          summary,
          "journal.update(dry-run caption post-merge in `journal`, no `preview`)",
          Boolean(
            dryCaption.response?.ok &&
            dryCaption.response?.result?.dryRun === true &&
            !("preview" in (dryCaption.response?.result ?? {})) &&
            dryPreviewImage?.image?.caption === "second caption"
          ),
          { ...summarizeCommand(dryCaption), previewCaption: dryPreviewImage?.image?.caption ?? null }
        );

        const afterDry = runFoundryctl(["journal", "get", "--journal-id", pageJournalId]);
        const afterDryImage =
          afterDry.response?.result?.journal?.pages?.find((page) => page.id === imagePageId) ?? null;
        markAndPush(
          summary,
          "journal.get(dry-run did not persist)",
          Boolean(afterDry.response?.ok && afterDryImage?.image?.caption === "first caption"),
          { caption: afterDryImage?.image?.caption ?? null }
        );

        const captionUpdate = expectOk(
          summary,
          "journal.update(caption)",
          runFoundryctl([
            "journal",
            "update",
            "--journal-id",
            pageJournalId,
            "--pages-json",
            JSON.stringify([{ id: imagePageId, image: { caption: "second caption" } }])
          ])
        );
        const updatedImage = captionUpdate?.journal?.pages?.find((page) => page.id === imagePageId) ?? null;
        markAndPush(
          summary,
          "journal.update(caption in response)",
          Boolean(updatedImage?.image?.caption === "second caption"),
          { caption: updatedImage?.image?.caption ?? null }
        );
        const captionGet = runFoundryctl(["journal", "get", "--journal-id", pageJournalId]);
        const captionGetImage =
          captionGet.response?.result?.journal?.pages?.find((page) => page.id === imagePageId) ?? null;
        markAndPush(
          summary,
          "journal.get(caption persisted)",
          Boolean(captionGet.response?.ok && captionGetImage?.image?.caption === "second caption"),
          { caption: captionGetImage?.image?.caption ?? null }
        );

        const textOnImage = runFoundryctl([
          "journal",
          "update",
          "--journal-id",
          pageJournalId,
          "--pages-json",
          JSON.stringify([{ id: imagePageId, text: { content: "inert" } }])
        ]);
        markAndPush(
          summary,
          "journal.update(text on image → INVALID_PARAMS names image.caption)",
          Boolean(
            isExpectedError(textOnImage, ERROR_CODES.INVALID_PARAMS) &&
            /image\.caption/.test(textOnImage.response?.error?.message ?? "")
          ),
          { ...summarizeCommand(textOnImage), message: textOnImage.response?.error?.message ?? null }
        );
      }

      if (textPageId) {
        const markdownOnHtml = runFoundryctl([
          "journal",
          "update",
          "--journal-id",
          pageJournalId,
          "--pages-json",
          JSON.stringify([{ id: textPageId, text: { markdown: "# nope" } }])
        ]);
        markAndPush(
          summary,
          "journal.update(markdown without format 2 → INVALID_PARAMS)",
          isExpectedError(markdownOnHtml, ERROR_CODES.INVALID_PARAMS),
          { ...summarizeCommand(markdownOnHtml), message: markdownOnHtml.response?.error?.message ?? null }
        );
      }

      const categoryCreate = expectOk(
        summary,
        "journal.category.create",
        runFoundryctl([
          "journal",
          "category",
          "create",
          "--journal-id",
          pageJournalId,
          "--name",
          `Smoke Chapter ${stamp}`,
          "--sort",
          "100"
        ])
      );
      const categoryId = categoryCreate?.category?.id ?? null;
      markAndPush(
        summary,
        "journal.category.create(full projection incl. flags, no ownership key)",
        Boolean(
          categoryId &&
          categoryCreate.journalId === pageJournalId &&
          categoryCreate.category.name === `Smoke Chapter ${stamp}` &&
          categoryCreate.category.sort === 100 &&
          categoryCreate.category._id === categoryId &&
          typeof categoryCreate.category.flags === "object" &&
          !Object.hasOwn(categoryCreate.category, "ownership")
        ),
        {
          categoryId,
          name: categoryCreate?.category?.name ?? null,
          sort: categoryCreate?.category?.sort ?? null,
          hasFlags: typeof categoryCreate?.category?.flags === "object",
          hasOwnership: Boolean(
            categoryCreate?.category && Object.hasOwn(categoryCreate.category, "ownership")
          )
        }
      );

      const blankCategory = expectOk(
        summary,
        "journal.category.create(blank name)",
        runFoundryctl(["journal", "category", "create", "--journal-id", pageJournalId, "--name", ""])
      );
      const blankCategoryId = blankCategory?.category?.id ?? null;
      markAndPush(
        summary,
        'journal.category.create(blank name stored+reported as "", not the derived display name)',
        Boolean(blankCategoryId && blankCategory.category.name === ""),
        { blankCategoryId, name: blankCategory?.category?.name ?? null }
      );
      if (blankCategoryId) {
        const blankGet = runFoundryctl([
          "journal",
          "category",
          "get",
          "--journal-id",
          pageJournalId,
          "--category-id",
          blankCategoryId
        ]);
        markAndPush(
          summary,
          'journal.category.get(blank name still "" on re-read)',
          Boolean(blankGet.response?.ok && blankGet.response.result.category.name === ""),
          { ...summarizeCommand(blankGet), name: blankGet.response?.result?.category?.name ?? null }
        );
      }

      if (categoryId) {
        const categoryDryCreate = runFoundryctl([
          "journal",
          "category",
          "create",
          "--journal-id",
          pageJournalId,
          "--name",
          `Smoke Preview ${stamp}`,
          "--dry-run"
        ]);
        markAndPush(
          summary,
          "journal.category.create(dry-run: same key, dryRun:true, null id, nothing persisted)",
          Boolean(
            categoryDryCreate.response?.ok &&
            categoryDryCreate.response.result.dryRun === true &&
            categoryDryCreate.response.result.category.id === null &&
            categoryDryCreate.response.result.category._id === null &&
            categoryDryCreate.response.result.category.name === `Smoke Preview ${stamp}`
          ),
          {
            ...summarizeCommand(categoryDryCreate),
            id: categoryDryCreate.response?.result?.category?.id ?? "(absent)"
          }
        );

        const categoryList = runFoundryctl(["journal", "category", "list", "--journal-id", pageJournalId]);
        const listedRow =
          categoryList.response?.result?.categories?.find((row) => row.id === categoryId) ?? null;
        markAndPush(
          summary,
          "journal.category.list(lean row, journalId echoed, no flags body)",
          Boolean(
            categoryList.response?.ok &&
            categoryList.response.result.journalId === pageJournalId &&
            listedRow &&
            listedRow._id === categoryId &&
            listedRow.sort === 100 &&
            !Object.hasOwn(listedRow, "flags") &&
            !Object.hasOwn(listedRow, "ownership") &&
            !categoryList.response.result.categories.some((row) => row.name === `Smoke Preview ${stamp}`)
          ),
          {
            ...summarizeCommand(categoryList),
            total: categoryList.response?.result?.total ?? null,
            rowKeys: listedRow ? Object.keys(listedRow).sort().join(",") : null
          }
        );

        const derivedFilter = runFoundryctl([
          "journal",
          "category",
          "list",
          "--journal-id",
          pageJournalId,
          "--name",
          "Unnamed"
        ]);
        markAndPush(
          summary,
          "journal.category.list(--name Unnamed matches nothing: the filter reads STORED names)",
          Boolean(derivedFilter.response?.ok && derivedFilter.response.result.total === 0),
          { ...summarizeCommand(derivedFilter), total: derivedFilter.response?.result?.total ?? null }
        );

        const journalWithCategories = runFoundryctl(["journal", "get", "--journal-id", pageJournalId]);
        const subSummary =
          journalWithCategories.response?.result?.journal?.categories?.find((row) => row.id === categoryId) ??
          null;
        markAndPush(
          summary,
          "journal.get(categories[] sub-summary shape unchanged: {id,name,sort}, no _id mirror)",
          Boolean(
            journalWithCategories.response?.ok &&
            subSummary &&
            Object.keys(subSummary).sort().join(",") === "id,name,sort" &&
            subSummary.name === `Smoke Chapter ${stamp}`
          ),
          { subSummaryKeys: subSummary ? Object.keys(subSummary).sort().join(",") : null }
        );

        const listedIds = categoryList.response?.result?.categories?.map((row) => row.id) ?? null;
        const subSummaryIds =
          journalWithCategories.response?.result?.journal?.categories?.map((row) => row.id) ?? null;
        const expectedCategoryOrder = [blankCategoryId, categoryId];
        markAndPush(
          summary,
          "journal.category.list + journal.get(categories[] ordered by `sort`, NOT insertion order, and identical)",
          Boolean(
            blankCategoryId &&
            categoryId &&
            listedIds &&
            subSummaryIds &&
            JSON.stringify(listedIds) === JSON.stringify(expectedCategoryOrder) &&
            JSON.stringify(subSummaryIds) === JSON.stringify(expectedCategoryOrder)
          ),
          {
            insertionOrder: [categoryId, blankCategoryId],
            expected: expectedCategoryOrder,
            listOrder: listedIds,
            journalGetOrder: subSummaryIds
          }
        );

        expectOk(
          summary,
          "journal.category.update",
          runFoundryctl([
            "journal",
            "category",
            "update",
            "--journal-id",
            pageJournalId,
            "--category-id",
            categoryId,
            "--name",
            `Smoke Chapter ${stamp} v2`,
            "--sort",
            "150"
          ])
        );
        const categoryReget = runFoundryctl([
          "journal",
          "category",
          "get",
          "--journal-id",
          pageJournalId,
          "--category-id",
          categoryId
        ]);
        markAndPush(
          summary,
          "journal.category.update(persisted, re-read off the document)",
          Boolean(
            categoryReget.response?.ok &&
            categoryReget.response.result.category.name === `Smoke Chapter ${stamp} v2` &&
            categoryReget.response.result.category.sort === 150
          ),
          {
            ...summarizeCommand(categoryReget),
            name: categoryReget.response?.result?.category?.name ?? null,
            sort: categoryReget.response?.result?.category?.sort ?? null
          }
        );

        const noOpPatch = runFoundryctl([
          "journal",
          "category",
          "update",
          "--journal-id",
          pageJournalId,
          "--category-id",
          categoryId,
          "--name",
          `Smoke Chapter ${stamp} v2`
        ]);
        markAndPush(
          summary,
          "journal.category.update(no-op patch SUCCEEDS, never reported as a veto)",
          Boolean(noOpPatch.response?.ok),
          { ...summarizeCommand(noOpPatch) }
        );

        const blankRenameDry = runFoundryctl([
          "journal",
          "category",
          "update",
          "--journal-id",
          pageJournalId,
          "--category-id",
          categoryId,
          "--name",
          "",
          "--dry-run"
        ]);
        const blankRenameDryReget = runFoundryctl([
          "journal",
          "category",
          "get",
          "--journal-id",
          pageJournalId,
          "--category-id",
          categoryId
        ]);
        markAndPush(
          summary,
          'journal.category.update(--name "" dry run reports the stored "", persists nothing)',
          Boolean(
            blankRenameDry.response?.ok &&
            blankRenameDry.response.result.dryRun === true &&
            blankRenameDry.response.result.category.name === "" &&
            blankRenameDryReget.response?.ok &&
            blankRenameDryReget.response.result.category.name === `Smoke Chapter ${stamp} v2`
          ),
          {
            ...summarizeCommand(blankRenameDry),
            previewName: blankRenameDry.response?.result?.category?.name ?? null,
            storedAfterPreview: blankRenameDryReget.response?.result?.category?.name ?? null
          }
        );
        const blankRename = runFoundryctl([
          "journal",
          "category",
          "update",
          "--journal-id",
          pageJournalId,
          "--category-id",
          categoryId,
          "--name",
          ""
        ]);
        const blankRenameReget = runFoundryctl([
          "journal",
          "category",
          "get",
          "--journal-id",
          pageJournalId,
          "--category-id",
          categoryId
        ]);
        markAndPush(
          summary,
          'journal.category.update(--name "" lands and re-reads as "", never the derived display name)',
          Boolean(
            blankRename.response?.ok &&
            blankRename.response.result.category.name === "" &&
            blankRenameReget.response?.ok &&
            blankRenameReget.response.result.category.name === ""
          ),
          {
            ...summarizeCommand(blankRename),
            updateName: blankRename.response?.result?.category?.name ?? null,
            regetName: blankRenameReget.response?.result?.category?.name ?? null
          }
        );

        expectOk(
          summary,
          "journal.category.update(restore the marked name after the blank rename)",
          runFoundryctl([
            "journal",
            "category",
            "update",
            "--journal-id",
            pageJournalId,
            "--category-id",
            categoryId,
            "--name",
            `Smoke Chapter ${stamp} v2`
          ])
        );

        const floatSort = runFoundryctl([
          "journal",
          "category",
          "update",
          "--journal-id",
          pageJournalId,
          "--category-id",
          categoryId,
          "--sort",
          "1.5"
        ]);
        markAndPush(
          summary,
          "journal.category.update(--sort 1.5 → INVALID_PARAMS, not silently rounded)",
          isExpectedError(floatSort, ERROR_CODES.INVALID_PARAMS),
          { ...summarizeCommand(floatSort), message: floatSort.response?.error?.message ?? null }
        );

        if (textPageId) {
          const linkRun = runFoundryctl([
            "journal",
            "update",
            "--journal-id",
            pageJournalId,
            "--pages-json",
            JSON.stringify([{ id: textPageId, category: categoryId }])
          ]);
          const linkedPage =
            linkRun.response?.result?.journal?.pages?.find((page) => page.id === textPageId) ?? null;
          markAndPush(
            summary,
            "journal.update(page category link accepts a bridge-created category id)",
            Boolean(linkRun.response?.ok && linkedPage?.category === categoryId),
            { ...summarizeCommand(linkRun), category: linkedPage?.category ?? null }
          );

          const deleteDry = runFoundryctl([
            "journal",
            "category",
            "delete",
            "--journal-id",
            pageJournalId,
            "--category-id",
            categoryId,
            "--dry-run"
          ]);
          markAndPush(
            summary,
            "journal.category.delete(dry-run forecasts the dangling page, deletes nothing)",
            Boolean(
              deleteDry.response?.ok &&
              deleteDry.response.result.dryRun === true &&
              deleteDry.response.result.deleted === false &&
              deleteDry.response.result.danglingPageCount === 1 &&
              deleteDry.response.result.danglingPageIds?.[0] === textPageId &&
              deleteDry.response.result.danglingPageIdsTruncated === false
            ),
            {
              ...summarizeCommand(deleteDry),
              danglingPageCount: deleteDry.response?.result?.danglingPageCount ?? null,
              danglingPageIds: deleteDry.response?.result?.danglingPageIds ?? null
            }
          );
          const deleteReal = runFoundryctl([
            "journal",
            "category",
            "delete",
            "--journal-id",
            pageJournalId,
            "--category-id",
            categoryId
          ]);
          markAndPush(
            summary,
            "journal.category.delete(reports the SAME consequence the dry run forecast)",
            Boolean(
              deleteReal.response?.ok &&
              deleteReal.response.result.deleted === true &&
              deleteReal.response.result.danglingPageCount === 1 &&
              deleteReal.response.result.danglingPageIds?.[0] === textPageId
            ),
            {
              ...summarizeCommand(deleteReal),
              danglingPageCount: deleteReal.response?.result?.danglingPageCount ?? null
            }
          );

          const afterDelete = runFoundryctl(["journal", "get", "--journal-id", pageJournalId]);
          const danglingPage =
            afterDelete.response?.result?.journal?.pages?.find((page) => page.id === textPageId) ?? null;
          markAndPush(
            summary,
            "journal.get(the page keeps its DANGLING category id; the category is gone)",
            Boolean(
              afterDelete.response?.ok &&
              danglingPage?.category === categoryId &&
              !afterDelete.response.result.journal.categories.some((row) => row.id === categoryId)
            ),
            {
              pageCategory: danglingPage?.category ?? null,
              categoryStillListed: Boolean(
                afterDelete.response?.result?.journal?.categories?.some((row) => row.id === categoryId)
              )
            }
          );

          const repair = runFoundryctl([
            "journal",
            "update",
            "--journal-id",
            pageJournalId,
            "--pages-json",
            JSON.stringify([{ id: textPageId, category: null }])
          ]);
          const repairedPage =
            repair.response?.result?.journal?.pages?.find((page) => page.id === textPageId) ?? null;
          markAndPush(
            summary,
            "journal.update(clearing a dangling category is the documented repair)",
            Boolean(repair.response?.ok && repairedPage?.category === null),
            { ...summarizeCommand(repair), category: repairedPage?.category ?? null }
          );
        }

        const deletedGet = runFoundryctl([
          "journal",
          "category",
          "get",
          "--journal-id",
          pageJournalId,
          "--category-id",
          categoryId
        ]);
        markAndPush(
          summary,
          "journal.category.get(deleted id → JOURNAL_CATEGORY_NOT_FOUND)",
          isExpectedError(deletedGet, ERROR_CODES.JOURNAL_CATEGORY_NOT_FOUND),
          { ...summarizeCommand(deletedGet) }
        );
        const badCategory = runFoundryctl([
          "journal",
          "category",
          "get",
          "--journal-id",
          pageJournalId,
          "--category-id",
          "missing-category-id"
        ]);
        markAndPush(
          summary,
          "journal.category.get(bad category id → JOURNAL_CATEGORY_NOT_FOUND naming the discovery path)",
          Boolean(
            isExpectedError(badCategory, ERROR_CODES.JOURNAL_CATEGORY_NOT_FOUND) &&
            /journal\.category\.list/.test(badCategory.response?.error?.message ?? "")
          ),
          { ...summarizeCommand(badCategory), message: badCategory.response?.error?.message ?? null }
        );
        const badJournalBothWrong = runFoundryctl([
          "journal",
          "category",
          "get",
          "--journal-id",
          "missing-journal-id",
          "--category-id",
          "missing-category-id"
        ]);
        markAndPush(
          summary,
          "journal.category.get(bad journalId resolves FIRST → JOURNAL_NOT_FOUND, guard order is contract)",
          isExpectedError(badJournalBothWrong, ERROR_CODES.JOURNAL_NOT_FOUND),
          { ...summarizeCommand(badJournalBothWrong) }
        );
      }
    }

    expectOk(summary, "actor.list", runFoundryctl(["actor", "list"]));
    const actorCreate = expectOk(
      summary,
      "actor.create",
      runFoundryctl(["actor", "create", "--name", `Smoke NPC ${stamp}`, "--type", "npc"])
    );
    const createdActorId = actorCreate?.actor?.id ?? null;
    if (createdActorId) {
      created.actors.push(createdActorId);
      expectOk(summary, "actor.get", runFoundryctl(["actor", "get", "--actor-id", createdActorId]));
      expectOk(
        summary,
        "actor.update",
        runFoundryctl(["actor", "update", "--actor-id", createdActorId, "--name", `Smoke NPC ${stamp} v2`])
      );

      const protoWriteRun = runFoundryctl([
        "actor",
        "update",
        "--actor-id",
        createdActorId,
        "--patch-json",
        JSON.stringify({ prototypeToken: { displayName: 20, sight: { range: 42 } } })
      ]);
      const protoGetRun = runFoundryctl(["actor", "get", "--actor-id", createdActorId]);
      const gotProto = protoGetRun.response?.result?.actor?.prototypeToken ?? null;
      markAndPush(
        summary,
        "actor.get(prototypeToken-full-round-trip)",
        Boolean(
          protoWriteRun.response?.ok &&
          protoGetRun.response?.ok &&
          gotProto &&
          gotProto.displayName === 20 &&
          gotProto.sight?.range === 42
        ),
        {
          ...summarizeCommand(protoGetRun),
          displayName: gotProto?.displayName ?? null,
          sightRange: gotProto?.sight?.range ?? null
        }
      );

      const actorClone = expectOk(
        summary,
        "actor.clone",
        runFoundryctl(["actor", "clone", "--actor-id", createdActorId, "--name", `Smoke NPC Copy ${stamp}`])
      );
      if (actorClone?.actor?.id) {
        created.actors.push(actorClone.actor.id);
      }

      const tokenItemSource = expectOk(
        summary,
        "actor.item.create(extended)",
        runFoundryctl([
          "actor",
          "item",
          "create",
          "--actor-id",
          createdActorId,
          "--name",
          `Smoke Spear ${stamp}`,
          "--type",
          "weapon"
        ])
      );
      const createdActorItemId = tokenItemSource?.item?.id ?? null;
      if (createdActorItemId) {
        expectOk(
          summary,
          "actor.item.get",
          runFoundryctl([
            "actor",
            "item",
            "get",
            "--actor-id",
            createdActorId,
            "--item-id",
            createdActorItemId
          ])
        );
        const actorItemClone = expectOk(
          summary,
          "actor.item.clone",
          runFoundryctl([
            "actor",
            "item",
            "clone",
            "--actor-id",
            createdActorId,
            "--item-id",
            createdActorItemId,
            "--name",
            `Smoke Spear Copy ${stamp}`
          ])
        );
        const clonedActorItemId = actorItemClone?.item?.id ?? null;
        if (clonedActorItemId) {
          expectOk(
            summary,
            "actor.item.delete",
            runFoundryctl([
              "actor",
              "item",
              "delete",
              "--actor-id",
              createdActorId,
              "--item-id",
              clonedActorItemId
            ])
          );
        }
      }

      const actorEffectCreate = expectOk(
        summary,
        "actor.effect.create",
        runFoundryctl([
          "actor",
          "effect",
          "create",
          "--actor-id",
          createdActorId,
          "--name",
          `Smoke Effect ${stamp}`,

          "--transfer",
          "true"
        ])
      );
      const actorEffectId = actorEffectCreate?.effect?.id ?? null;

      markAndPush(
        summary,
        "actor.effect.create(transfer-coerced-false)",
        actorEffectCreate?.effect?.transfer === false,
        {
          transfer: actorEffectCreate?.effect?.transfer
        }
      );
      if (actorEffectId) {
        expectOk(
          summary,
          "actor.effect.list",
          runFoundryctl(["actor", "effect", "list", "--actor-id", createdActorId])
        );
        expectOk(
          summary,
          "actor.effect.get",
          runFoundryctl([
            "actor",
            "effect",
            "get",
            "--actor-id",
            createdActorId,
            "--effect-id",
            actorEffectId
          ])
        );
        expectOk(
          summary,
          "actor.effect.update(disable)",
          runFoundryctl([
            "actor",
            "effect",
            "update",
            "--actor-id",
            createdActorId,
            "--effect-id",
            actorEffectId,
            "--disabled",
            "true"
          ])
        );
        const actorEffectClone = expectOk(
          summary,
          "actor.effect.clone",
          runFoundryctl([
            "actor",
            "effect",
            "clone",
            "--actor-id",
            createdActorId,
            "--effect-id",
            actorEffectId,
            "--name",
            `Smoke Effect Copy ${stamp}`
          ])
        );
        if (actorEffectClone?.effect?.id) {
          expectOk(
            summary,
            "actor.effect.delete(clone)",
            runFoundryctl([
              "actor",
              "effect",
              "delete",
              "--actor-id",
              createdActorId,
              "--effect-id",
              actorEffectClone.effect.id
            ])
          );
        }
        expectOk(
          summary,
          "actor.effect.applied",
          runFoundryctl(["actor", "effect", "applied", "--actor-id", createdActorId])
        );
        expectOk(
          summary,
          "actor.effect.delete",
          runFoundryctl([
            "actor",
            "effect",
            "delete",
            "--actor-id",
            createdActorId,
            "--effect-id",
            actorEffectId
          ])
        );

        expectErr(
          summary,
          "actor.effect.get(missing)",
          runFoundryctl([
            "actor",
            "effect",
            "get",
            "--actor-id",
            createdActorId,
            "--effect-id",
            createMissingId("effect", stamp)
          ]),
          ERROR_CODES.EFFECT_NOT_FOUND
        );
      }

      const bulkEffectCreate = expectOk(
        summary,
        "actor.effect.create-many(3 elements, ONE call)",
        runFoundryctl([
          "actor",
          "effect",
          "create-many",
          "--actor-id",
          createdActorId,
          "--data-json",
          JSON.stringify([
            { name: `Bulk effect A ${stamp}`, transfer: true, disabled: false },
            { name: `Bulk effect B ${stamp}`, disabled: true },
            { name: `Bulk effect C ${stamp}`, disabled: false }
          ]),
          "--idempotency-key",
          `bulk-actor-effect-${stamp}`
        ])
      );
      const bulkEffectIds = (bulkEffectCreate?.outcomes ?? []).map((outcome) => outcome.id).filter(Boolean);
      markAndPush(
        summary,
        "actor.effect.create-many(complete, 3 created, input order, distinct ids, name reported)",
        bulkEffectCreate?.complete === true &&
          bulkEffectCreate?.outcomes?.length === 3 &&
          bulkEffectCreate.outcomes.every(
            (outcome, index) => outcome.index === index && outcome.status === "created"
          ) &&
          bulkEffectCreate.outcomes[0]?.name === `Bulk effect A ${stamp}` &&
          new Set(bulkEffectIds).size === 3,
        { observed: bulkEffectCreate?.outcomes }
      );
      if (bulkEffectIds.length === 3) {
        const firstEffect = expectOk(
          summary,
          "actor.effect.get(a batch-created effect resolves)",
          runFoundryctl([
            "actor",
            "effect",
            "get",
            "--actor-id",
            createdActorId,
            "--effect-id",
            bulkEffectIds[0]
          ])
        );

        markAndPush(
          summary,
          "actor.effect.create-many(transfer coerced FALSE per element on an Actor parent)",
          firstEffect?.effect?.id === bulkEffectIds[0] && firstEffect?.effect?.transfer === false,
          { observed: { id: firstEffect?.effect?.id, transfer: firstEffect?.effect?.transfer } }
        );
        const bulkEffectUpdate = expectOk(
          summary,
          "actor.effect.update-many(one real change + one no-op)",
          runFoundryctl([
            "actor",
            "effect",
            "update-many",
            "--actor-id",
            createdActorId,
            "--patches-json",
            JSON.stringify([
              { id: bulkEffectIds[0], patch: { disabled: true } },

              { id: bulkEffectIds[1], patch: { disabled: true } }
            ])
          ])
        );
        markAndPush(
          summary,
          "actor.effect.update-many(updated beside unchanged, both successes, complete)",
          bulkEffectUpdate?.complete === true &&
            bulkEffectUpdate?.outcomes?.[0]?.status === "updated" &&
            bulkEffectUpdate?.outcomes?.[1]?.status === "unchanged",
          { observed: bulkEffectUpdate?.outcomes }
        );
        const afterEffectUpdate = expectOk(
          summary,
          "actor.effect.get(after update-many)",
          runFoundryctl([
            "actor",
            "effect",
            "get",
            "--actor-id",
            createdActorId,
            "--effect-id",
            bulkEffectIds[0]
          ])
        );
        markAndPush(
          summary,
          "actor.effect.update-many(the patch really landed in STORED state)",
          afterEffectUpdate?.effect?.disabled === true,
          { observed: afterEffectUpdate?.effect?.disabled }
        );

        const effectMissingRun = runFoundryctl([
          "actor",
          "effect",
          "update-many",
          "--actor-id",
          createdActorId,
          "--patches-json",
          JSON.stringify([
            { id: bulkEffectIds[0], patch: { disabled: false } },
            { id: "nosuchid00000001", patch: { disabled: false } }
          ])
        ]);
        expectErr(
          summary,
          "actor.effect.update-many(unknown id → EFFECT_NOT_FOUND)",
          effectMissingRun,
          ERROR_CODES.EFFECT_NOT_FOUND
        );
        markAndPush(
          summary,
          "actor.effect.update-many(the rejection NAMES the offending element index)",
          effectMissingRun.response?.error?.details?.index === 1,
          { details: effectMissingRun.response?.error?.details ?? null }
        );
        const bulkEffectDelete = expectOk(
          summary,
          "actor.effect.delete-many(3 live ids + 1 already gone)",
          runFoundryctl([
            "actor",
            "effect",
            "delete-many",
            "--actor-id",
            createdActorId,
            "--ids",
            [...bulkEffectIds, "nosuchid00000001"].join(",")
          ])
        );
        markAndPush(
          summary,
          "actor.effect.delete-many(3 deleted + alreadyDeleted, complete)",
          bulkEffectDelete?.complete === true &&
            bulkEffectDelete?.outcomes?.map((outcome) => outcome.status).join(",") ===
              "deleted,deleted,deleted,alreadyDeleted",
          { observed: bulkEffectDelete?.outcomes }
        );
      }

      const effectSourceItem = expectOk(
        summary,
        "actor.item.create(effect-source)",
        runFoundryctl([
          "actor",
          "item",
          "create",
          "--actor-id",
          createdActorId,
          "--name",
          `Smoke Aura Item ${stamp}`,
          "--type",
          "weapon"
        ])
      );
      const effectSourceItemId = effectSourceItem?.item?.id ?? null;
      if (effectSourceItemId) {
        const itemEffectCreate = expectOk(
          summary,
          "actor.item.effect.create",
          runFoundryctl([
            "actor",
            "item",
            "effect",
            "create",
            "--actor-id",
            createdActorId,
            "--item-id",
            effectSourceItemId,
            "--name",
            `Smoke Transferred ${stamp}`,
            "--transfer",
            "true"
          ])
        );
        const itemEffectId = itemEffectCreate?.effect?.id ?? null;

        markAndPush(
          summary,
          "actor.item.effect.create(transfer-kept)",
          itemEffectCreate?.effect?.transfer === true,
          {
            transfer: itemEffectCreate?.effect?.transfer
          }
        );
        if (itemEffectId) {
          const plainItemGet = runFoundryctl([
            "actor",
            "item",
            "get",
            "--actor-id",
            createdActorId,
            "--item-id",
            effectSourceItemId
          ]);
          const plainItem = plainItemGet.response?.result?.item ?? null;
          const plainEffectNames = Array.isArray(plainItem?.effects)
            ? plainItem.effects.map((effect) => effect?.name)
            : [];
          markAndPush(
            summary,
            "actor.item.get(effects-visible-without-include)",
            Boolean(
              plainItemGet.response?.ok &&
              Array.isArray(plainItem?.effects) &&
              plainEffectNames.includes(`Smoke Transferred ${stamp}`) &&
              plainItem?.flags &&
              typeof plainItem.flags === "object"
            ),
            {
              ...summarizeCommand(plainItemGet),
              effectNames: plainEffectNames,
              hasFlagsKey: plainItem ? Object.prototype.hasOwnProperty.call(plainItem, "flags") : false
            }
          );
          expectOk(
            summary,
            "actor.item.effect.list",
            runFoundryctl([
              "actor",
              "item",
              "effect",
              "list",
              "--actor-id",
              createdActorId,
              "--item-id",
              effectSourceItemId
            ])
          );
          expectOk(
            summary,
            "actor.item.effect.get",
            runFoundryctl([
              "actor",
              "item",
              "effect",
              "get",
              "--actor-id",
              createdActorId,
              "--item-id",
              effectSourceItemId,
              "--effect-id",
              itemEffectId
            ])
          );
          expectOk(
            summary,
            "actor.item.effect.update(disable)",
            runFoundryctl([
              "actor",
              "item",
              "effect",
              "update",
              "--actor-id",
              createdActorId,
              "--item-id",
              effectSourceItemId,
              "--effect-id",
              itemEffectId,
              "--disabled",
              "false"
            ])
          );
          const itemEffectClone = expectOk(
            summary,
            "actor.item.effect.clone",
            runFoundryctl([
              "actor",
              "item",
              "effect",
              "clone",
              "--actor-id",
              createdActorId,
              "--item-id",
              effectSourceItemId,
              "--effect-id",
              itemEffectId,
              "--name",
              `Smoke Transferred Copy ${stamp}`
            ])
          );
          if (itemEffectClone?.effect?.id) {
            expectOk(
              summary,
              "actor.item.effect.delete(clone)",
              runFoundryctl([
                "actor",
                "item",
                "effect",
                "delete",
                "--actor-id",
                createdActorId,
                "--item-id",
                effectSourceItemId,
                "--effect-id",
                itemEffectClone.effect.id
              ])
            );
          }

          const appliedRun = expectOk(
            summary,
            "actor.effect.applied(transferred)",
            runFoundryctl(["actor", "effect", "applied", "--actor-id", createdActorId])
          );
          const appliedNames = (appliedRun?.effects ?? []).map((effect) => effect.name);
          markAndPush(
            summary,
            "actor.effect.applied(includes-transferred)",
            appliedNames.includes(`Smoke Transferred ${stamp}`),
            {
              appliedNames
            }
          );
        }
      }
    }

    if (targetSceneId && actorId) {
      const tokenCreate = expectOk(
        summary,
        "scene.token.create(headline)",
        runFoundryctl([
          "scene",
          "token",
          "create",
          "--scene-id",
          targetSceneId,
          "--actor-id",
          actorId,
          "--x",
          "1500",
          "--y",
          "1500",
          "--unlinked"
        ])
      );
      const tokenId = tokenCreate?.token?.id ?? null;
      const tokenUnlinked = tokenCreate?.token?.actorLink === false;
      markAndPush(summary, "scene.token.create(unlinked)", Boolean(tokenId) && tokenUnlinked, {
        tokenId,
        actorLink: tokenCreate?.token?.actorLink
      });

      if (tokenId) {
        created.tokens.push({ sceneId: targetSceneId, tokenId });
        expectOk(
          summary,
          "scene.token.list",
          runFoundryctl(["scene", "token", "list", "--scene-id", targetSceneId])
        );

        expectOk(
          summary,
          "scene.token.effect.list",
          runFoundryctl([
            "scene",
            "token",
            "effect",
            "list",
            "--scene-id",
            targetSceneId,
            "--token-id",
            tokenId
          ])
        );
        expectOk(
          summary,
          "scene.token.effect.applied",
          runFoundryctl([
            "scene",
            "token",
            "effect",
            "applied",
            "--scene-id",
            targetSceneId,
            "--token-id",
            tokenId
          ])
        );
        const weaponName = `Smoke Flaming Sword ${stamp}`;
        const weaponCreate = expectOk(
          summary,
          "scene.token.item.create(weapon)",
          runFoundryctl([
            "scene",
            "token",
            "item",
            "create",
            "--scene-id",
            targetSceneId,
            "--token-id",
            tokenId,
            "--name",
            weaponName,
            "--type",
            "weapon"
          ])
        );
        markAndPush(
          summary,
          "scene.token.item.create(mutatesWorldActor=false)",
          weaponCreate?.mutatesWorldActor === false,
          { mutatesWorldActor: weaponCreate?.mutatesWorldActor }
        );

        const tokenItems = expectOk(
          summary,
          "scene.token.item.list(weapon present)",
          runFoundryctl([
            "scene",
            "token",
            "item",
            "list",
            "--scene-id",
            targetSceneId,
            "--token-id",
            tokenId
          ])
        );
        const weaponOnToken = (tokenItems?.items ?? []).some((item) => item?.name === weaponName);
        markAndPush(summary, "headline.weaponOnToken", weaponOnToken, { weaponName });

        const worldItems = runFoundryctl(["actor", "item", "list", "--actor-id", actorId]);
        const weaponOnWorld = (worldItems.response?.result?.items ?? []).some(
          (item) => item?.name === weaponName
        );
        markAndPush(summary, "headline.worldActorIsolation", isCommandSuccess(worldItems) && !weaponOnWorld, {
          weaponOnWorld
        });

        expectOk(
          summary,
          "scene.token.get",
          runFoundryctl(["scene", "token", "get", "--scene-id", targetSceneId, "--token-id", tokenId])
        );
        expectOk(
          summary,
          "scene.token.update",
          runFoundryctl([
            "scene",
            "token",
            "update",
            "--scene-id",
            targetSceneId,
            "--token-id",
            tokenId,
            "--hidden",
            "true"
          ])
        );

        const weaponId = weaponCreate?.item?.id ?? null;
        if (weaponId) {
          expectOk(
            summary,
            "scene.token.item.get",
            runFoundryctl([
              "scene",
              "token",
              "item",
              "get",
              "--scene-id",
              targetSceneId,
              "--token-id",
              tokenId,
              "--item-id",
              weaponId
            ])
          );
          expectOk(
            summary,
            "scene.token.item.update",
            runFoundryctl([
              "scene",
              "token",
              "item",
              "update",
              "--scene-id",
              targetSceneId,
              "--token-id",
              tokenId,
              "--item-id",
              weaponId,
              "--name",
              `${weaponName} +1`
            ])
          );

          const weaponCloneName = `${weaponName} Copy`;
          const weaponClone = expectOk(
            summary,
            "scene.token.item.clone",
            runFoundryctl([
              "scene",
              "token",
              "item",
              "clone",
              "--scene-id",
              targetSceneId,
              "--token-id",
              tokenId,
              "--item-id",
              weaponId,
              "--name",
              weaponCloneName
            ])
          );
          markAndPush(
            summary,
            "scene.token.item.clone(mutatesWorldActor=false)",
            weaponClone?.mutatesWorldActor === false,
            { mutatesWorldActor: weaponClone?.mutatesWorldActor }
          );
          const weaponCloneId = weaponClone?.item?.id ?? null;
          const worldItemsAfterClone = runFoundryctl(["actor", "item", "list", "--actor-id", actorId]);
          const cloneOnWorld = (worldItemsAfterClone.response?.result?.items ?? []).some(
            (item) => item?.name === weaponCloneName
          );
          markAndPush(
            summary,
            "scene.token.item.clone(worldActorIsolation)",
            isCommandSuccess(worldItemsAfterClone) && !cloneOnWorld,
            { cloneOnWorld }
          );
          if (weaponCloneId) {
            expectOk(
              summary,
              "scene.token.item.delete(clone)",
              runFoundryctl([
                "scene",
                "token",
                "item",
                "delete",
                "--scene-id",
                targetSceneId,
                "--token-id",
                tokenId,
                "--item-id",
                weaponCloneId
              ])
            );
          }
          expectOk(
            summary,
            "scene.token.item.delete",
            runFoundryctl([
              "scene",
              "token",
              "item",
              "delete",
              "--scene-id",
              targetSceneId,
              "--token-id",
              tokenId,
              "--item-id",
              weaponId
            ])
          );
        }

        const tokenEffectName = `Smoke Token Buff ${stamp}`;
        const tokenEffectCreate = expectOk(
          summary,
          "scene.token.effect.create",
          runFoundryctl([
            "scene",
            "token",
            "effect",
            "create",
            "--scene-id",
            targetSceneId,
            "--token-id",
            tokenId,
            "--name",
            tokenEffectName
          ])
        );
        markAndPush(
          summary,
          "scene.token.effect.create(mutatesWorldActor=false)",
          tokenEffectCreate?.mutatesWorldActor === false,
          { mutatesWorldActor: tokenEffectCreate?.mutatesWorldActor }
        );

        const worldEffects = runFoundryctl(["actor", "effect", "list", "--actor-id", actorId]);
        const effectOnWorld = (worldEffects.response?.result?.effects ?? []).some(
          (effect) => effect?.name === tokenEffectName
        );
        markAndPush(
          summary,
          "scene.token.effect.worldActorIsolation",
          isCommandSuccess(worldEffects) && !effectOnWorld,
          { effectOnWorld }
        );

        const tokenEffectId = tokenEffectCreate?.effect?.id ?? null;
        if (tokenEffectId) {
          expectOk(
            summary,
            "scene.token.effect.get",
            runFoundryctl([
              "scene",
              "token",
              "effect",
              "get",
              "--scene-id",
              targetSceneId,
              "--token-id",
              tokenId,
              "--effect-id",
              tokenEffectId
            ])
          );
          expectOk(
            summary,
            "scene.token.effect.update",
            runFoundryctl([
              "scene",
              "token",
              "effect",
              "update",
              "--scene-id",
              targetSceneId,
              "--token-id",
              tokenId,
              "--effect-id",
              tokenEffectId,
              "--disabled",
              "true"
            ])
          );
          const tokenEffectClone = expectOk(
            summary,
            "scene.token.effect.clone",
            runFoundryctl([
              "scene",
              "token",
              "effect",
              "clone",
              "--scene-id",
              targetSceneId,
              "--token-id",
              tokenId,
              "--effect-id",
              tokenEffectId,
              "--name",
              `${tokenEffectName} 2`
            ])
          );
          const clonedTokenEffectId = tokenEffectClone?.effect?.id ?? null;
          if (clonedTokenEffectId) {
            expectOk(
              summary,
              "scene.token.effect.delete(clone)",
              runFoundryctl([
                "scene",
                "token",
                "effect",
                "delete",
                "--scene-id",
                targetSceneId,
                "--token-id",
                tokenId,
                "--effect-id",
                clonedTokenEffectId
              ])
            );
          }
          expectOk(
            summary,
            "scene.token.effect.delete",
            runFoundryctl([
              "scene",
              "token",
              "effect",
              "delete",
              "--scene-id",
              targetSceneId,
              "--token-id",
              tokenId,
              "--effect-id",
              tokenEffectId
            ])
          );
        }

        const deltaBulkCreate = expectOk(
          summary,
          "scene.token.effect.create-many(2 elements on an UNLINKED token's delta actor)",
          runFoundryctl([
            "scene",
            "token",
            "effect",
            "create-many",
            "--scene-id",
            targetSceneId,
            "--token-id",
            tokenId,
            "--data-json",
            JSON.stringify([
              { name: `Bulk Token Buff A ${stamp}`, disabled: false },
              { name: `Bulk Token Buff B ${stamp}`, disabled: true }
            ]),
            "--idempotency-key",
            `bulk-token-effect-${stamp}`
          ])
        );
        const deltaBulkIds = (deltaBulkCreate?.outcomes ?? []).map((outcome) => outcome.id).filter(Boolean);
        markAndPush(
          summary,
          "scene.token.effect.create-many(complete, 2 created, distinct ids, mutatesWorldActor=false)",
          deltaBulkCreate?.complete === true &&
            deltaBulkCreate?.outcomes?.length === 2 &&
            deltaBulkCreate.outcomes.every(
              (outcome, index) => outcome.index === index && outcome.status === "created"
            ) &&
            new Set(deltaBulkIds).size === 2 &&
            deltaBulkCreate?.mutatesWorldActor === false,
          { observed: deltaBulkCreate?.outcomes, mutatesWorldActor: deltaBulkCreate?.mutatesWorldActor }
        );
        if (deltaBulkIds.length === 2) {
          for (const [index, deltaEffectId] of deltaBulkIds.entries()) {
            const readBack = expectOk(
              summary,
              `scene.token.effect.get(batch-created element ${index} resolves by its reported id)`,
              runFoundryctl([
                "scene",
                "token",
                "effect",
                "get",
                "--scene-id",
                targetSceneId,
                "--token-id",
                tokenId,
                "--effect-id",
                deltaEffectId
              ])
            );
            markAndPush(
              summary,
              `scene.token.effect.create-many(element ${index} kept the bridge's own id)`,
              readBack?.effect?.id === deltaEffectId,
              { reported: deltaEffectId, stored: readBack?.effect?.id ?? null }
            );
          }

          const worldEffectsAfterBulk = runFoundryctl(["actor", "effect", "list", "--actor-id", actorId]);

          const bulkNamesOnWorld = (worldEffectsAfterBulk.response?.result?.effects ?? []).some(
            (effect) =>
              /^Bulk Token Buff [AB] /.test(String(effect?.name ?? "")) &&
              String(effect?.name ?? "").endsWith(stamp)
          );
          markAndPush(
            summary,
            "scene.token.effect.create-many(worldActorIsolation)",
            isCommandSuccess(worldEffectsAfterBulk) && !bulkNamesOnWorld,
            { bulkNamesOnWorld }
          );
          const deltaBulkDelete = expectOk(
            summary,
            "scene.token.effect.delete-many(both batch-created effects)",
            runFoundryctl([
              "scene",
              "token",
              "effect",
              "delete-many",
              "--scene-id",
              targetSceneId,
              "--token-id",
              tokenId,
              "--ids",
              deltaBulkIds.join(",")
            ])
          );
          markAndPush(
            summary,
            "scene.token.effect.delete-many(both deleted, complete)",
            deltaBulkDelete?.complete === true &&
              deltaBulkDelete?.outcomes?.map((outcome) => outcome.status).join(",") === "deleted,deleted",
            { observed: deltaBulkDelete?.outcomes }
          );
        }

        const tieWeaponName = `Smoke TIE Sword ${stamp}`;
        const tieWeaponCreate = expectOk(
          summary,
          "scene.token.item.create(for token-item effect)",
          runFoundryctl([
            "scene",
            "token",
            "item",
            "create",
            "--scene-id",
            targetSceneId,
            "--token-id",
            tokenId,
            "--name",
            tieWeaponName,
            "--type",
            "weapon"
          ])
        );
        const tieWeaponId = tieWeaponCreate?.item?.id ?? null;
        if (tieWeaponId) {
          const tieEffectName = `Smoke Item Aura ${stamp}`;
          const tieEffectCreate = expectOk(
            summary,
            "scene.token.item.effect.create",
            runFoundryctl([
              "scene",
              "token",
              "item",
              "effect",
              "create",
              "--scene-id",
              targetSceneId,
              "--token-id",
              tokenId,
              "--item-id",
              tieWeaponId,
              "--name",
              tieEffectName,
              "--transfer",
              "true"
            ])
          );
          markAndPush(
            summary,
            "scene.token.item.effect.create(mutatesWorldActor=false)",
            tieEffectCreate?.mutatesWorldActor === false,
            { mutatesWorldActor: tieEffectCreate?.mutatesWorldActor }
          );

          const worldActorItems = runFoundryctl(["actor", "item", "list", "--actor-id", actorId]);
          let tieEffectOnWorld = false;
          for (const worldItem of worldActorItems.response?.result?.items ?? []) {
            const worldItemEffects = runFoundryctl([
              "actor",
              "item",
              "effect",
              "list",
              "--actor-id",
              actorId,
              "--item-id",
              worldItem.id
            ]);
            if ((worldItemEffects.response?.result?.effects ?? []).some((e) => e?.name === tieEffectName)) {
              tieEffectOnWorld = true;
              break;
            }
          }
          markAndPush(
            summary,
            "scene.token.item.effect.worldActorIsolation",
            isCommandSuccess(worldActorItems) && !tieEffectOnWorld,
            { tieEffectOnWorld }
          );

          const tieEffectId = tieEffectCreate?.effect?.id ?? null;
          if (tieEffectId) {
            expectOk(
              summary,
              "scene.token.item.effect.list",
              runFoundryctl([
                "scene",
                "token",
                "item",
                "effect",
                "list",
                "--scene-id",
                targetSceneId,
                "--token-id",
                tokenId,
                "--item-id",
                tieWeaponId
              ])
            );
            expectOk(
              summary,
              "scene.token.item.effect.get",
              runFoundryctl([
                "scene",
                "token",
                "item",
                "effect",
                "get",
                "--scene-id",
                targetSceneId,
                "--token-id",
                tokenId,
                "--item-id",
                tieWeaponId,
                "--effect-id",
                tieEffectId
              ])
            );
            expectOk(
              summary,
              "scene.token.item.effect.update",
              runFoundryctl([
                "scene",
                "token",
                "item",
                "effect",
                "update",
                "--scene-id",
                targetSceneId,
                "--token-id",
                tokenId,
                "--item-id",
                tieWeaponId,
                "--effect-id",
                tieEffectId,
                "--disabled",
                "true"
              ])
            );
            const tieEffectClone = expectOk(
              summary,
              "scene.token.item.effect.clone",
              runFoundryctl([
                "scene",
                "token",
                "item",
                "effect",
                "clone",
                "--scene-id",
                targetSceneId,
                "--token-id",
                tokenId,
                "--item-id",
                tieWeaponId,
                "--effect-id",
                tieEffectId,
                "--name",
                `${tieEffectName} 2`
              ])
            );
            const clonedTieEffectId = tieEffectClone?.effect?.id ?? null;
            if (clonedTieEffectId) {
              expectOk(
                summary,
                "scene.token.item.effect.delete(clone)",
                runFoundryctl([
                  "scene",
                  "token",
                  "item",
                  "effect",
                  "delete",
                  "--scene-id",
                  targetSceneId,
                  "--token-id",
                  tokenId,
                  "--item-id",
                  tieWeaponId,
                  "--effect-id",
                  clonedTieEffectId
                ])
              );
            }
            expectOk(
              summary,
              "scene.token.item.effect.delete",
              runFoundryctl([
                "scene",
                "token",
                "item",
                "effect",
                "delete",
                "--scene-id",
                targetSceneId,
                "--token-id",
                tokenId,
                "--item-id",
                tieWeaponId,
                "--effect-id",
                tieEffectId
              ])
            );
          }

          expectOk(
            summary,
            "scene.token.item.delete(token-item effect cleanup)",
            runFoundryctl([
              "scene",
              "token",
              "item",
              "delete",
              "--scene-id",
              targetSceneId,
              "--token-id",
              tokenId,
              "--item-id",
              tieWeaponId
            ])
          );
        }

        const tokenClone = expectOk(
          summary,
          "scene.token.clone",
          runFoundryctl(["scene", "token", "clone", "--scene-id", targetSceneId, "--token-id", tokenId])
        );
        if (tokenClone?.token?.id) {
          created.tokens.push({ sceneId: targetSceneId, tokenId: tokenClone.token.id });
        }
      }
    }

    if (targetSceneId) {
      const tileCreate = expectOk(
        summary,
        "scene.tile.create",
        runFoundryctl([
          "scene",
          "tile",
          "create",
          "--scene-id",
          targetSceneId,
          "--x",
          "0",
          "--y",
          "0",
          "--width",
          "100",
          "--height",
          "100",
          "--data-json",
          JSON.stringify({ texture: { src: "icons/svg/door-steel.svg" } })
        ])
      );
      const tileId = tileCreate?.tile?.id ?? null;
      if (tileId) {
        created.tiles.push({ sceneId: targetSceneId, tileId });
        expectOk(
          summary,
          "scene.tile.list",
          runFoundryctl(["scene", "tile", "list", "--scene-id", targetSceneId])
        );
        expectOk(
          summary,
          "scene.tile.get",
          runFoundryctl(["scene", "tile", "get", "--scene-id", targetSceneId, "--tile-id", tileId])
        );
        expectOk(
          summary,
          "scene.tile.update",
          runFoundryctl([
            "scene",
            "tile",
            "update",
            "--scene-id",
            targetSceneId,
            "--tile-id",
            tileId,
            "--hidden",
            "true"
          ])
        );
        const tileClone = expectOk(
          summary,
          "scene.tile.clone",
          runFoundryctl([
            "scene",
            "tile",
            "clone",
            "--scene-id",
            targetSceneId,
            "--tile-id",
            tileId,
            "--x",
            "300"
          ])
        );
        if (tileClone?.tile?.id) {
          created.tiles.push({ sceneId: targetSceneId, tileId: tileClone.tile.id });
        }
      }

      const soundCreate = expectOk(
        summary,
        "scene.sound.create",
        runFoundryctl([
          "scene",
          "sound",
          "create",
          "--scene-id",
          targetSceneId,
          "--path",
          "sounds/combat/general-fight.ogg",
          "--x",
          "200",
          "--y",
          "200",
          "--radius",
          "20"
        ])
      );
      const soundId = soundCreate?.sound?.id ?? null;
      if (soundId) {
        created.sounds.push({ sceneId: targetSceneId, soundId });
        expectOk(
          summary,
          "scene.sound.list",
          runFoundryctl(["scene", "sound", "list", "--scene-id", targetSceneId])
        );
        expectOk(
          summary,
          "scene.sound.get",
          runFoundryctl(["scene", "sound", "get", "--scene-id", targetSceneId, "--sound-id", soundId])
        );
        expectOk(
          summary,
          "scene.sound.update",
          runFoundryctl([
            "scene",
            "sound",
            "update",
            "--scene-id",
            targetSceneId,
            "--sound-id",
            soundId,
            "--radius",
            "40"
          ])
        );
        const soundClone = expectOk(
          summary,
          "scene.sound.clone",
          runFoundryctl([
            "scene",
            "sound",
            "clone",
            "--scene-id",
            targetSceneId,
            "--sound-id",
            soundId,
            "--x",
            "400"
          ])
        );
        if (soundClone?.sound?.id) {
          created.sounds.push({ sceneId: targetSceneId, soundId: soundClone.sound.id });
        }
      }

      const wallCreate = expectOk(
        summary,
        "scene.wall.create",
        runFoundryctl([
          "scene",
          "wall",
          "create",
          "--scene-id",
          targetSceneId,
          "--data-json",
          JSON.stringify({ c: [0, 0, 100, 0], door: 1, ds: 0, doorSound: "woodBasic" })
        ])
      );
      const wallId = wallCreate?.wall?.id ?? null;
      if (wallId) {
        created.walls.push({ sceneId: targetSceneId, wallId });
        const wallGet = expectOk(
          summary,
          "scene.wall.get",
          runFoundryctl(["scene", "wall", "get", "--scene-id", targetSceneId, "--wall-id", wallId])
        );
        markAndPush(
          summary,
          "scene.wall.get(door/ds/doorSound/c round-trip)",
          wallGet?.wall?.door === 1 &&
            wallGet?.wall?.ds === 0 &&
            wallGet?.wall?.doorSound === "woodBasic" &&
            Array.isArray(wallGet?.wall?.c) &&
            wallGet.wall.c.length === 4,
          {
            observed: {
              door: wallGet?.wall?.door,
              ds: wallGet?.wall?.ds,
              doorSound: wallGet?.wall?.doorSound,
              c: wallGet?.wall?.c
            }
          }
        );
        const wallList = expectOk(
          summary,
          "scene.wall.list(--door)",
          runFoundryctl(["scene", "wall", "list", "--scene-id", targetSceneId, "--door"])
        );
        markAndPush(
          summary,
          "scene.wall.list(--door contains created door)",
          Array.isArray(wallList?.walls) && wallList.walls.some((wall) => wall.id === wallId),
          { count: wallList?.walls?.length }
        );
        expectOk(
          summary,
          "scene.wall.update",
          runFoundryctl([
            "scene",
            "wall",
            "update",
            "--scene-id",
            targetSceneId,
            "--wall-id",
            wallId,
            "--patch-json",
            JSON.stringify({ doorSound: "stoneBasic", ds: 1 })
          ])
        );
        const wallClone = expectOk(
          summary,
          "scene.wall.clone",
          runFoundryctl([
            "scene",
            "wall",
            "clone",
            "--scene-id",
            targetSceneId,
            "--wall-id",
            wallId,
            "--patch-json",
            JSON.stringify({ door: 2 })
          ])
        );
        if (wallClone?.wall?.id) {
          created.walls.push({ sceneId: targetSceneId, wallId: wallClone.wall.id });
        }
      }

      const bulkWallData = Array.from({ length: 20 }, (_unused, index) => ({
        c: [100 + index * 10, 100, 100 + index * 10, 300]
      }));
      const bulkDryRun = expectOk(
        summary,
        "scene.wall.create-many --dry-run",
        runFoundryctl([
          "--dry-run",
          "scene",
          "wall",
          "create-many",
          "--scene-id",
          targetSceneId,
          "--data-json",
          JSON.stringify(bulkWallData.slice(0, 3))
        ])
      );
      markAndPush(
        summary,
        "scene.wall.create-many --dry-run (3 previews, NO ids minted, complete)",
        bulkDryRun?.dryRun === true &&
          bulkDryRun?.complete === true &&
          Array.isArray(bulkDryRun?.outcomes) &&
          bulkDryRun.outcomes.length === 3 &&
          bulkDryRun.outcomes.every(
            (outcome, index) => outcome.index === index && outcome.id === null && outcome.status === "created"
          ),
        { observed: bulkDryRun?.outcomes }
      );
      const wallsBeforeBulk = expectOk(
        summary,
        "scene.wall.list(before bulk create)",
        runFoundryctl(["scene", "wall", "list", "--scene-id", targetSceneId, "--limit", "1"])
      );
      const bulkCreate = expectOk(
        summary,
        "scene.wall.create-many(20 walls, ONE call)",
        runFoundryctl([
          "scene",
          "wall",
          "create-many",
          "--scene-id",
          targetSceneId,
          "--idempotency-key",
          `smoke-walls-${stamp}`,
          "--data-json",
          JSON.stringify(bulkWallData)
        ])
      );
      const bulkWallIds = Array.isArray(bulkCreate?.outcomes)
        ? bulkCreate.outcomes
            .filter((outcome) => outcome.status === "created" && outcome.id)
            .map((outcome) => outcome.id)
        : [];
      for (const wallId of bulkWallIds) {
        created.walls.push({ sceneId: targetSceneId, wallId });
      }
      markAndPush(
        summary,
        "scene.wall.create-many(complete, 20 created, input order, distinct ids)",
        bulkCreate?.complete === true &&
          bulkWallIds.length === 20 &&
          new Set(bulkWallIds).size === 20 &&
          bulkCreate.outcomes.every((outcome, index) => outcome.index === index),
        { created: bulkWallIds.length, complete: bulkCreate?.complete }
      );
      const wallsAfterBulk = expectOk(
        summary,
        "scene.wall.list(after bulk create)",
        runFoundryctl(["scene", "wall", "list", "--scene-id", targetSceneId, "--limit", "1"])
      );
      markAndPush(
        summary,
        "scene.wall.create-many(the walls really landed: total rose by 20)",
        typeof wallsBeforeBulk?.total === "number" &&
          typeof wallsAfterBulk?.total === "number" &&
          wallsAfterBulk.total - wallsBeforeBulk.total === 20,
        { before: wallsBeforeBulk?.total, after: wallsAfterBulk?.total }
      );

      const badElementRun = runFoundryctl([
        "scene",
        "wall",
        "create-many",
        "--scene-id",
        targetSceneId,
        "--data-json",
        JSON.stringify([{ c: [0, 0, 50, 50] }, { c: [1, 2] }])
      ]);
      expectErr(
        summary,
        "scene.wall.create-many(one bad element → whole-call INVALID_PARAMS)",
        badElementRun,
        "INVALID_PARAMS"
      );

      markAndPush(
        summary,
        "scene.wall.create-many(the rejection NAMES the offending element index)",
        badElementRun.response?.error?.details?.index === 1,
        { details: badElementRun.response?.error?.details ?? null }
      );
      const wallsAfterBadElement = expectOk(
        summary,
        "scene.wall.list(after the rejected batch)",
        runFoundryctl(["scene", "wall", "list", "--scene-id", targetSceneId, "--limit", "1"])
      );
      markAndPush(
        summary,
        "scene.wall.create-many(rejected batch wrote NOTHING)",
        wallsAfterBadElement?.total === wallsAfterBulk?.total,
        { before: wallsAfterBulk?.total, after: wallsAfterBadElement?.total }
      );

      if (bulkWallIds.length >= 11) {
        const bulkUpdate = expectOk(
          summary,
          "scene.wall.update-many(2 real + 1 no-op)",
          runFoundryctl([
            "scene",
            "wall",
            "update-many",
            "--scene-id",
            targetSceneId,
            "--patches-json",
            JSON.stringify([
              { id: bulkWallIds[0], patch: { door: 1, doorSound: "woodBasic" } },
              { id: bulkWallIds[1], patch: { door: 1, doorSound: "stoneBasic" } },
              { id: bulkWallIds[2], patch: { ds: 0 } }
            ])
          ])
        );
        markAndPush(
          summary,
          "scene.wall.update-many(complete; updated/updated/unchanged in input order)",
          bulkUpdate?.complete === true &&
            bulkUpdate?.outcomes?.length === 3 &&
            bulkUpdate.outcomes[0].status === "updated" &&
            bulkUpdate.outcomes[1].status === "updated" &&
            bulkUpdate.outcomes[2].status === "unchanged",
          { observed: bulkUpdate?.outcomes?.map((outcome) => outcome.status) }
        );
        const patchedWall = expectOk(
          summary,
          "scene.wall.get(after update-many)",
          runFoundryctl(["scene", "wall", "get", "--scene-id", targetSceneId, "--wall-id", bulkWallIds[0]])
        );
        markAndPush(
          summary,
          "scene.wall.update-many(the patch is in STORED state, not just in the outcome)",
          patchedWall?.wall?.door === 1 && patchedWall?.wall?.doorSound === "woodBasic",
          { observed: { door: patchedWall?.wall?.door, doorSound: patchedWall?.wall?.doorSound } }
        );

        expectErr(
          summary,
          "scene.wall.update-many(dotted array path c.0 → INVALID_PARAMS on both versions)",
          runFoundryctl([
            "scene",
            "wall",
            "update-many",
            "--scene-id",
            targetSceneId,
            "--patches-json",
            JSON.stringify([{ id: bulkWallIds[0], patch: { "c.0": 5 } }])
          ]),
          "INVALID_PARAMS"
        );
        const unmovedWall = expectOk(
          summary,
          "scene.wall.get(after the refused dotted write)",
          runFoundryctl(["scene", "wall", "get", "--scene-id", targetSceneId, "--wall-id", bulkWallIds[0]])
        );
        markAndPush(
          summary,
          "scene.wall.update-many(the refused dotted write moved NOTHING)",
          Array.isArray(unmovedWall?.wall?.c) &&
            unmovedWall.wall.c.length === 4 &&
            unmovedWall.wall.c[0] === patchedWall?.wall?.c?.[0],
          { observed: { before: patchedWall?.wall?.c, after: unmovedWall?.wall?.c } }
        );

        expectErr(
          summary,
          "scene.wall.update-many(duplicate id → INVALID_PARAMS)",
          runFoundryctl([
            "scene",
            "wall",
            "update-many",
            "--scene-id",
            targetSceneId,
            "--patches-json",
            JSON.stringify([
              { id: bulkWallIds[0], patch: { ds: 1 } },
              { id: bulkWallIds[0], patch: { ds: 2 } }
            ])
          ]),
          "INVALID_PARAMS"
        );

        expectErr(
          summary,
          "scene.wall.update-many(missing target → WALL_NOT_FOUND)",
          runFoundryctl([
            "scene",
            "wall",
            "update-many",
            "--scene-id",
            targetSceneId,
            "--patches-json",
            JSON.stringify([
              { id: bulkWallIds[0], patch: { ds: 1 } },
              { id: createMissingId("wall", stamp), patch: { ds: 1 } }
            ])
          ]),
          "WALL_NOT_FOUND"
        );

        const deleteFirst = bulkWallIds.slice(0, 10);
        const bulkDelete = expectOk(
          summary,
          "scene.wall.delete-many(10 walls)",
          runFoundryctl([
            "scene",
            "wall",
            "delete-many",
            "--scene-id",
            targetSceneId,
            "--ids",
            deleteFirst.join(",")
          ])
        );
        markAndPush(
          summary,
          "scene.wall.delete-many(complete, all deleted)",
          bulkDelete?.complete === true &&
            bulkDelete?.outcomes?.length === 10 &&
            bulkDelete.outcomes.every((outcome) => outcome.status === "deleted"),
          { observed: bulkDelete?.outcomes?.map((outcome) => outcome.status) }
        );
        const bulkDeleteReentrant = expectOk(
          summary,
          "scene.wall.delete-many(repeat + one live id → alreadyDeleted beside deleted)",
          runFoundryctl([
            "scene",
            "wall",
            "delete-many",
            "--scene-id",
            targetSceneId,
            "--ids",
            [deleteFirst[0], bulkWallIds[10]].join(",")
          ])
        );
        markAndPush(
          summary,
          "scene.wall.delete-many(reentrant: alreadyDeleted is a SUCCESS, complete stays true)",
          bulkDeleteReentrant?.complete === true &&
            bulkDeleteReentrant?.outcomes?.[0]?.status === "alreadyDeleted" &&
            bulkDeleteReentrant?.outcomes?.[1]?.status === "deleted",
          { observed: bulkDeleteReentrant?.outcomes }
        );

        const removedIds = new Set([...deleteFirst, bulkWallIds[10]]);
        for (let index = created.walls.length - 1; index >= 0; index -= 1) {
          if (removedIds.has(created.walls[index].wallId)) {
            created.walls.splice(index, 1);
          }
        }
      }

      const bulkFamilies = [
        {
          family: "tile",
          idKey: "tileId",
          ledger: created.tiles,
          data: [
            { x: 1200, y: 100, width: 100, height: 100 },
            { x: 1200, y: 250, width: 100, height: 100 },
            { x: 1200, y: 400, width: 100, height: 100 }
          ],
          patch: { x: 1500 },
          read: (doc) => doc?.x,
          patched: 1500,
          getKey: "tile",
          notFound: "TILE_NOT_FOUND"
        },
        {
          family: "sound",
          idKey: "soundId",
          ledger: created.sounds,
          data: [
            { path: "sounds/notifications/hover.ogg", x: 1200, y: 600, radius: 20 },
            { path: "sounds/notifications/hover.ogg", x: 1300, y: 600, radius: 20 },
            { path: "sounds/notifications/hover.ogg", x: 1400, y: 600, radius: 20 }
          ],
          patch: { radius: 45 },
          read: (doc) => doc?.radius,
          patched: 45,
          getKey: "sound",
          notFound: "SOUND_NOT_FOUND"
        },
        {
          family: "drawing",
          idKey: "drawingId",
          ledger: created.drawings,
          data: [
            { shape: { type: "r", width: 60, height: 60 }, x: 1900, y: 100, text: `Bulk zone A ${stamp}` },
            { shape: { type: "r", width: 60, height: 60 }, x: 1900, y: 250, text: `Bulk zone B ${stamp}` },
            { shape: { type: "r", width: 60, height: 60 }, x: 1900, y: 400, text: `Bulk zone C ${stamp}` }
          ],
          patch: { x: 2100 },
          read: (doc) => doc?.x,
          patched: 2100,
          getKey: "drawing",
          notFound: "DRAWING_NOT_FOUND"
        },
        {
          family: "light",
          idKey: "lightId",
          ledger: created.lights,
          data: [
            { x: 2000, y: 100, config: { dim: 20, bright: 10 } },
            { x: 2000, y: 250, config: { dim: 20, bright: 10 } },
            { x: 2000, y: 400, config: { dim: 20, bright: 10 } }
          ],
          patch: { x: 2200 },
          read: (doc) => doc?.x,
          patched: 2200,
          getKey: "light",
          notFound: "LIGHT_NOT_FOUND"
        },
        {
          family: "region",
          idKey: "regionId",
          ledger: created.regions,
          data: [
            {
              name: `Bulk region A ${stamp}`,
              shapes: [{ type: "rectangle", x: 2300, y: 100, width: 50, height: 50 }]
            },
            { name: `Bulk region B ${stamp}`, shapes: [] },
            { name: `Bulk region C ${stamp}`, shapes: [] }
          ],
          patch: { name: `Bulk region renamed ${stamp}` },
          read: (doc) => doc?.name,
          patched: `Bulk region renamed ${stamp}`,
          getKey: "region",
          notFound: "REGION_NOT_FOUND"
        },
        {
          family: "note",
          idKey: "noteId",
          ledger: created.notes,

          data: [
            { entryId: null, x: 1600, y: 100, text: `Bulk pin A ${stamp}` },
            { entryId: null, x: 1600, y: 250, text: `Bulk pin B ${stamp}` },
            { entryId: null, x: 1600, y: 400, text: `Bulk pin C ${stamp}` }
          ],
          patch: { text: `Bulk pin renamed ${stamp}` },
          read: (doc) => doc?.text,
          patched: `Bulk pin renamed ${stamp}`,
          getKey: "note",
          notFound: "NOTE_NOT_FOUND"
        }
      ];
      for (const spec of bulkFamilies) {
        const label = `scene.${spec.family}`;
        const bulkCreate = expectOk(
          summary,
          `${label}.create-many(3 elements, ONE call)`,
          runFoundryctl([
            "scene",
            spec.family,
            "create-many",
            "--scene-id",
            targetSceneId,
            "--data-json",
            JSON.stringify(spec.data),
            "--idempotency-key",
            `bulk-${spec.family}-${stamp}`
          ])
        );
        const ids = (bulkCreate?.outcomes ?? []).map((outcome) => outcome.id).filter(Boolean);
        markAndPush(
          summary,
          `${label}.create-many(complete, 3 created, input order, distinct ids)`,
          bulkCreate?.complete === true &&
            bulkCreate?.outcomes?.length === 3 &&
            bulkCreate.outcomes.every(
              (outcome, index) => outcome.index === index && outcome.status === "created"
            ) &&
            new Set(ids).size === 3,
          { observed: bulkCreate?.outcomes }
        );
        for (const id of ids) {
          spec.ledger.push({ sceneId: targetSceneId, [spec.idKey]: id });
        }
        if (ids.length === 3) {
          const firstGet = expectOk(
            summary,
            `${label}.get(a batch-created id resolves)`,
            runFoundryctl([
              "scene",
              spec.family,
              "get",
              "--scene-id",
              targetSceneId,
              `--${spec.family}-id`,
              ids[0]
            ])
          );
          markAndPush(
            summary,
            `${label}.create-many(the created document is really there)`,
            Boolean(firstGet?.[spec.getKey]?.id === ids[0]),
            { observed: firstGet?.[spec.getKey]?.id, expected: ids[0] }
          );

          const noOpPatch = Object.fromEntries(
            Object.keys(spec.patch).map((key) => [key, spec.data[1][key]])
          );
          const bulkUpdate = expectOk(
            summary,
            `${label}.update-many(one real change + one no-op)`,
            runFoundryctl([
              "scene",
              spec.family,
              "update-many",
              "--scene-id",
              targetSceneId,
              "--patches-json",
              JSON.stringify([
                { id: ids[0], patch: spec.patch },
                { id: ids[1], patch: noOpPatch }
              ])
            ])
          );
          markAndPush(
            summary,
            `${label}.update-many(updated beside unchanged, both successes, complete)`,
            bulkUpdate?.complete === true &&
              bulkUpdate?.outcomes?.[0]?.status === "updated" &&
              bulkUpdate?.outcomes?.[1]?.status === "unchanged",
            { observed: bulkUpdate?.outcomes }
          );
          const afterUpdate = expectOk(
            summary,
            `${label}.get(after update-many)`,
            runFoundryctl([
              "scene",
              spec.family,
              "get",
              "--scene-id",
              targetSceneId,
              `--${spec.family}-id`,
              ids[0]
            ])
          );
          markAndPush(
            summary,
            `${label}.update-many(the patch really landed in STORED state)`,
            spec.read(afterUpdate?.[spec.getKey]) === spec.patched,
            { observed: spec.read(afterUpdate?.[spec.getKey]), expected: spec.patched }
          );

          const missingRun = runFoundryctl([
            "scene",
            spec.family,
            "update-many",
            "--scene-id",
            targetSceneId,
            "--patches-json",
            JSON.stringify([
              { id: ids[0], patch: spec.patch },
              { id: "nosuchid00000001", patch: spec.patch }
            ])
          ]);
          expectErr(
            summary,
            `${label}.update-many(unknown id → ${spec.notFound})`,
            missingRun,
            spec.notFound
          );
          markAndPush(
            summary,
            `${label}.update-many(the rejection NAMES the offending element index)`,
            missingRun.response?.error?.details?.index === 1,
            { details: missingRun.response?.error?.details ?? null }
          );

          const bulkDeleteFamily = expectOk(
            summary,
            `${label}.delete-many(2 live ids + 1 already gone)`,
            runFoundryctl([
              "scene",
              spec.family,
              "delete-many",
              "--scene-id",
              targetSceneId,
              "--ids",
              [ids[0], "nosuchid00000001", ids[1]].join(",")
            ])
          );
          markAndPush(
            summary,
            `${label}.delete-many(deleted / alreadyDeleted / deleted, complete)`,
            bulkDeleteFamily?.complete === true &&
              bulkDeleteFamily?.outcomes?.map((outcome) => outcome.status).join(",") ===
                "deleted,alreadyDeleted,deleted",
            { observed: bulkDeleteFamily?.outcomes }
          );
          const removed = new Set([ids[0], ids[1]]);
          for (let index = spec.ledger.length - 1; index >= 0; index -= 1) {
            if (removed.has(spec.ledger[index][spec.idKey])) {
              spec.ledger.splice(index, 1);
            }
          }
        }
      }

      const bulkNamedFamilies = [
        {
          family: "drawing",
          idKey: "drawingId",
          getKey: "drawing",
          ledger: created.drawings,
          suppliedName: `Bulk named drawing ${stamp}`,
          nameLandsOn: "v14-only",
          data: [
            {
              name: `Bulk named drawing ${stamp}`,
              shape: { type: "r", width: 40, height: 40 },
              x: 2400,
              y: 100
            }
          ]
        },
        {
          family: "light",
          idKey: "lightId",
          getKey: "light",
          ledger: created.lights,
          suppliedName: `Bulk named light ${stamp}`,
          nameLandsOn: "v14-only",
          data: [{ name: `Bulk named light ${stamp}`, x: 2400, y: 250, config: { dim: 15, bright: 5 } }]
        },
        {
          family: "region",
          idKey: "regionId",
          getKey: "region",
          ledger: created.regions,
          suppliedName: `Bulk named region ${stamp}`,
          nameLandsOn: "both",
          data: [{ name: `Bulk named region ${stamp}`, shapes: [] }]
        }
      ];
      for (const spec of bulkNamedFamilies) {
        const label = `scene.${spec.family}`;
        const namedCreate = expectOk(
          summary,
          `${label}.create-many(outcome carries a name)`,
          runFoundryctl([
            "scene",
            spec.family,
            "create-many",
            "--scene-id",
            targetSceneId,
            "--data-json",
            JSON.stringify(spec.data),
            "--idempotency-key",
            `bulk-named-${spec.family}-${stamp}`
          ])
        );
        const namedId = namedCreate?.outcomes?.[0]?.id ?? null;
        if (namedId) {
          spec.ledger.push({ sceneId: targetSceneId, [spec.idKey]: namedId });
          const namedGet = expectOk(
            summary,
            `${label}.get(the batch-created id resolves)`,
            runFoundryctl([
              "scene",
              spec.family,
              "get",
              "--scene-id",
              targetSceneId,
              `--${spec.family}-id`,
              namedId
            ])
          );

          markAndPush(
            summary,
            `${label}.create-many(outcome name == the name ${label}.get reports)`,
            "name" in (namedCreate?.outcomes?.[0] ?? {}) &&
              (namedCreate.outcomes[0].name ?? null) === (namedGet?.[spec.getKey]?.name ?? null),
            {
              observed: namedCreate?.outcomes?.[0]?.name ?? null,
              expected: namedGet?.[spec.getKey]?.name ?? null,
              generation: isV14 ? 14 : 13
            }
          );

          const nameLands = spec.nameLandsOn === "both" || isV14;
          const expectedName = nameLands ? spec.suppliedName : null;
          markAndPush(
            summary,
            `${label}.create-many(the SUPPLIED name round-trips: ${nameLands ? "stored" : "null on v13"})`,
            (namedCreate?.outcomes?.[0]?.name ?? null) === expectedName &&
              (namedGet?.[spec.getKey]?.name ?? null) === expectedName,
            {
              outcomeName: namedCreate?.outcomes?.[0]?.name ?? null,
              getName: namedGet?.[spec.getKey]?.name ?? null,
              expected: expectedName,
              generation: isV14 ? 14 : 13
            }
          );
        }
      }

      if (isV14) {
        for (const [verbLabel, argv] of [
          [
            "create-many",
            [
              "scene",
              "template",
              "create-many",
              "--scene-id",
              targetSceneId,
              "--data-json",
              JSON.stringify([{ t: "circle", x: 10, y: 10, distance: 5 }])
            ]
          ],
          [
            "update-many",
            [
              "scene",
              "template",
              "update-many",
              "--scene-id",
              targetSceneId,
              "--patches-json",
              JSON.stringify([{ id: "nosuchid00000001", patch: { distance: 9 } }])
            ]
          ],
          [
            "delete-many",
            ["scene", "template", "delete-many", "--scene-id", targetSceneId, "--ids", "nosuchid00000001"]
          ]
        ]) {
          expectErr(
            summary,
            `scene.template.${verbLabel}(v14 gate)`,
            runFoundryctl(argv),
            ERROR_CODES.UNSUPPORTED_OPERATION
          );
        }

        expectErr(
          summary,
          "scene.template.delete-many(v14 gate BEATS the duplicate-id refusal)",
          runFoundryctl([
            "scene",
            "template",
            "delete-many",
            "--scene-id",
            targetSceneId,
            "--ids",
            "nosuchid00000001,nosuchid00000001"
          ]),
          ERROR_CODES.UNSUPPORTED_OPERATION
        );
        expectErr(
          summary,
          "scene.template.delete-many(v14 gate BEATS the element cap)",
          runFoundryctl([
            "scene",
            "template",
            "delete-many",
            "--scene-id",
            targetSceneId,
            "--ids",
            Array.from({ length: 101 }, (_unused, index) => `tplid${String(index).padStart(11, "0")}`).join(
              ","
            )
          ]),
          ERROR_CODES.UNSUPPORTED_OPERATION
        );
      } else {
        const bulkTemplateCreate = expectOk(
          summary,
          "scene.template.create-many(2 elements, ONE call)",
          runFoundryctl([
            "scene",
            "template",
            "create-many",
            "--scene-id",
            targetSceneId,
            "--data-json",
            JSON.stringify([
              { t: "circle", x: 2500, y: 100, distance: 10 },
              { t: "cone", x: 2500, y: 250, distance: 10, direction: 90, angle: 53 }
            ]),
            "--idempotency-key",
            `bulk-template-${stamp}`
          ])
        );
        const bulkTemplateIds = (bulkTemplateCreate?.outcomes ?? [])
          .map((outcome) => outcome.id)
          .filter(Boolean);
        markAndPush(
          summary,
          "scene.template.create-many(complete, 2 created, no `name` key on any outcome)",
          bulkTemplateCreate?.complete === true &&
            bulkTemplateIds.length === 2 &&
            bulkTemplateCreate.outcomes.every(
              (outcome) => outcome.status === "created" && !("name" in outcome)
            ),
          { observed: bulkTemplateCreate?.outcomes }
        );
        for (const templateId of bulkTemplateIds) {
          created.templates.push({ sceneId: targetSceneId, templateId });
        }
        if (bulkTemplateIds.length === 2) {
          const bulkTemplateUpdate = expectOk(
            summary,
            "scene.template.update-many(one real change + one no-op)",
            runFoundryctl([
              "scene",
              "template",
              "update-many",
              "--scene-id",
              targetSceneId,
              "--patches-json",
              JSON.stringify([
                { id: bulkTemplateIds[0], patch: { distance: 25 } },
                { id: bulkTemplateIds[1], patch: { distance: 10 } }
              ])
            ])
          );
          markAndPush(
            summary,
            "scene.template.update-many(updated beside unchanged, complete)",
            bulkTemplateUpdate?.complete === true &&
              bulkTemplateUpdate?.outcomes?.[0]?.status === "updated" &&
              bulkTemplateUpdate?.outcomes?.[1]?.status === "unchanged",
            { observed: bulkTemplateUpdate?.outcomes }
          );
          const bulkTemplateDelete = expectOk(
            summary,
            "scene.template.delete-many(2 live ids + 1 already gone)",
            runFoundryctl([
              "scene",
              "template",
              "delete-many",
              "--scene-id",
              targetSceneId,
              "--ids",
              [bulkTemplateIds[0], "nosuchid00000001", bulkTemplateIds[1]].join(",")
            ])
          );
          markAndPush(
            summary,
            "scene.template.delete-many(deleted / alreadyDeleted / deleted, complete)",
            bulkTemplateDelete?.complete === true &&
              bulkTemplateDelete?.outcomes?.map((outcome) => outcome.status).join(",") ===
                "deleted,alreadyDeleted,deleted",
            { observed: bulkTemplateDelete?.outcomes }
          );
          const removedTemplates = new Set(bulkTemplateIds);
          for (let index = created.templates.length - 1; index >= 0; index -= 1) {
            if (removedTemplates.has(created.templates[index].templateId)) {
              created.templates.splice(index, 1);
            }
          }
        }
      }

      const armedRegionRun = runFoundryctl([
        "scene",
        "region",
        "create-many",
        "--scene-id",
        targetSceneId,
        "--data-json",
        JSON.stringify([
          { name: `Bulk legal region ${stamp}`, shapes: [] },
          {
            name: `Bulk armed region ${stamp}`,
            behaviors: [{ type: "executeScript", system: { source: "console.log(1)" } }]
          }
        ])
      ]);
      expectErr(
        summary,
        "scene.region.create-many(an executeScript element → INVALID_PARAMS)",
        armedRegionRun,
        "INVALID_PARAMS"
      );
      markAndPush(
        summary,
        "scene.region.create-many(the refusal NAMES the element index and the behavior type)",
        armedRegionRun.response?.error?.details?.index === 1 &&
          armedRegionRun.response?.error?.details?.behaviorType === "executeScript",
        { details: armedRegionRun.response?.error?.details ?? null }
      );

      const armedRegionMessage = armedRegionRun.response?.error?.message ?? "";
      markAndPush(
        summary,
        "scene.region.create-many(the refusal message names the element and states nothing was written)",
        armedRegionMessage.startsWith("scene.region.create-many element 1: ") &&
          armedRegionMessage.endsWith("Nothing was written."),
        { message: armedRegionMessage || null }
      );
      const afterArmed = expectOk(
        summary,
        "scene.region.list(after the refused batch)",
        runFoundryctl([
          "scene",
          "region",
          "list",
          "--scene-id",
          targetSceneId,
          "--name",
          `Bulk legal region ${stamp}`
        ])
      );
      markAndPush(
        summary,
        "scene.region.create-many(the refused batch wrote NOTHING — not even the legal element)",
        (afterArmed?.regions ?? []).length === 0,
        { observed: (afterArmed?.regions ?? []).length }
      );

      if (actorId) {
        const bulkTokenCreate = expectOk(
          summary,
          "scene.token.create-many(2 actor-backed + 1 raw, ONE call)",
          runFoundryctl([
            "scene",
            "token",
            "create-many",
            "--scene-id",
            targetSceneId,
            "--data-json",
            JSON.stringify([
              { actorId, x: 1800, y: 100 },
              { actorId, x: 1800, y: 250, actorLink: true },
              { name: `Bulk marker ${stamp}`, x: 1800, y: 400 }
            ]),
            "--idempotency-key",
            `bulk-token-${stamp}`
          ])
        );
        const bulkTokenIds = (bulkTokenCreate?.outcomes ?? []).map((outcome) => outcome.id).filter(Boolean);
        markAndPush(
          summary,
          "scene.token.create-many(complete, 3 created, distinct ids)",
          bulkTokenCreate?.complete === true &&
            bulkTokenCreate?.outcomes?.length === 3 &&
            bulkTokenCreate.outcomes.every((outcome) => outcome.status === "created") &&
            new Set(bulkTokenIds).size === 3,
          { observed: bulkTokenCreate?.outcomes }
        );
        for (const tokenId of bulkTokenIds) {
          created.tokens.push({ sceneId: targetSceneId, tokenId });
        }
        if (bulkTokenIds.length === 3) {
          const reads = bulkTokenIds.map((tokenId) =>
            runFoundryctl(["scene", "token", "get", "--scene-id", targetSceneId, "--token-id", tokenId])
          );
          const tokens = reads.map((run) => run.response?.result?.token ?? null);

          markAndPush(
            summary,
            "scene.token.create-many(element 0: actor resolved, actorLink defaults to false)",
            tokens[0]?.actorId === actorId && tokens[0]?.actorLink === false,
            { observed: { actorId: tokens[0]?.actorId, actorLink: tokens[0]?.actorLink } }
          );
          markAndPush(
            summary,
            "scene.token.create-many(element 1: explicit actorLink override wins for THAT element)",
            tokens[1]?.actorId === actorId && tokens[1]?.actorLink === true,
            { observed: { actorId: tokens[1]?.actorId, actorLink: tokens[1]?.actorLink } }
          );
          markAndPush(
            summary,
            "scene.token.create-many(element 2: no actorId → a raw token)",
            (tokens[2]?.actorId ?? null) === null && tokens[2]?.name === `Bulk marker ${stamp}`,
            { observed: { actorId: tokens[2]?.actorId, name: tokens[2]?.name } }
          );

          markAndPush(
            summary,
            "scene.token.create-many(each outcome's name == the name scene.token.get reports)",
            bulkTokenCreate.outcomes.every(
              (outcome, index) => "name" in outcome && outcome.name === (tokens[index]?.name ?? null)
            ),
            {
              observed: bulkTokenCreate.outcomes.map((outcome) => outcome.name),
              expected: tokens.map((token) => token?.name ?? null)
            }
          );

          const protoRun = runFoundryctl(["actor", "get", "--actor-id", actorId]);
          const protoSrc = protoRun.response?.result?.actor?.prototypeToken?.texture?.src ?? null;
          markAndPush(
            summary,
            "scene.token.create-many(built from the actor's PROTOTYPE token, per element)",
            typeof protoSrc === "string" &&
              protoSrc.length > 0 &&
              tokens[0]?.texture?.src === protoSrc &&
              tokens[1]?.texture?.src === protoSrc,
            { observed: [tokens[0]?.texture?.src, tokens[1]?.texture?.src], expected: protoSrc }
          );

          const badActorRun = runFoundryctl([
            "scene",
            "token",
            "create-many",
            "--scene-id",
            targetSceneId,
            "--data-json",
            JSON.stringify([{ actorId, x: 1900, y: 100 }, { actorId: "nosuchactor00001" }])
          ]);
          expectErr(
            summary,
            "scene.token.create-many(unknown actorId → ACTOR_NOT_FOUND, not INVALID_PARAMS)",
            badActorRun,
            "ACTOR_NOT_FOUND"
          );
          markAndPush(
            summary,
            "scene.token.create-many(the actor rejection NAMES the offending element index)",
            badActorRun.response?.error?.details?.index === 1,
            { details: badActorRun.response?.error?.details ?? null }
          );

          const bulkTokenDelete = expectOk(
            summary,
            "scene.token.delete-many(3 tokens)",
            runFoundryctl([
              "scene",
              "token",
              "delete-many",
              "--scene-id",
              targetSceneId,
              "--ids",
              bulkTokenIds.join(",")
            ])
          );
          markAndPush(
            summary,
            "scene.token.delete-many(complete, all deleted)",
            bulkTokenDelete?.complete === true &&
              bulkTokenDelete?.outcomes?.every((outcome) => outcome.status === "deleted"),
            { observed: bulkTokenDelete?.outcomes }
          );
          const deletedTokens = new Set(bulkTokenIds);
          for (let index = created.tokens.length - 1; index >= 0; index -= 1) {
            if (deletedTokens.has(created.tokens[index].tokenId)) {
              created.tokens.splice(index, 1);
            }
          }
        }
      }

      const noteJournalCreate = expectOk(
        summary,
        "journal.create(note target)",
        runFoundryctl(["journal", "create", "--name", `Smoke Note Journal ${stamp}`])
      );
      const noteJournalId = noteJournalCreate?.journal?.id ?? null;
      if (noteJournalId) {
        created.journals.push(noteJournalId);
        const noteCreate = expectOk(
          summary,
          "scene.note.create",
          runFoundryctl([
            "scene",
            "note",
            "create",
            "--scene-id",
            targetSceneId,
            "--data-json",
            JSON.stringify({
              entryId: noteJournalId,
              x: 500,
              y: 500,
              iconSize: 40,
              text: "Smoke Pin",
              texture: { src: "icons/svg/book.svg" }
            })
          ])
        );
        const noteId = noteCreate?.note?.id ?? null;
        if (noteId) {
          created.notes.push({ sceneId: targetSceneId, noteId });
          const noteGet = expectOk(
            summary,
            "scene.note.get",
            runFoundryctl(["scene", "note", "get", "--scene-id", targetSceneId, "--note-id", noteId])
          );
          markAndPush(
            summary,
            "scene.note.get(entryId/text/texture round-trip)",
            noteGet?.note?.entryId === noteJournalId &&
              noteGet?.note?.text === "Smoke Pin" &&
              noteGet?.note?.texture?.src === "icons/svg/book.svg",
            {
              observed: {
                entryId: noteGet?.note?.entryId,
                text: noteGet?.note?.text,
                src: noteGet?.note?.texture?.src
              }
            }
          );
          expectOk(
            summary,
            "scene.note.list",
            runFoundryctl(["scene", "note", "list", "--scene-id", targetSceneId])
          );

          expectOk(
            summary,
            "scene.note.update",
            runFoundryctl([
              "scene",
              "note",
              "update",
              "--scene-id",
              targetSceneId,
              "--note-id",
              noteId,
              "--patch-json",
              JSON.stringify({ texture: { src: "icons/svg/info.svg" } })
            ])
          );
          const noteClone = expectOk(
            summary,
            "scene.note.clone",
            runFoundryctl([
              "scene",
              "note",
              "clone",
              "--scene-id",
              targetSceneId,
              "--note-id",
              noteId,
              "--patch-json",
              JSON.stringify({ x: 600 })
            ])
          );
          if (noteClone?.note?.id) {
            created.notes.push({ sceneId: targetSceneId, noteId: noteClone.note.id });
          }
        }
      }

      const drawingCreate = expectOk(
        summary,
        "scene.drawing.create",
        runFoundryctl([
          "scene",
          "drawing",
          "create",
          "--scene-id",
          targetSceneId,
          "--data-json",
          JSON.stringify({
            x: 100,
            y: 100,
            text: "Smoke Zone",

            author: "spoofed-author-id",
            shape: { type: "r", width: 200, height: 120 }
          })
        ])
      );
      const drawingId = drawingCreate?.drawing?.id ?? null;
      if (drawingId) {
        created.drawings.push({ sceneId: targetSceneId, drawingId });
        const drawingGet = expectOk(
          summary,
          "scene.drawing.get",
          runFoundryctl(["scene", "drawing", "get", "--scene-id", targetSceneId, "--drawing-id", drawingId])
        );
        markAndPush(
          summary,
          "scene.drawing.get(shape.type/text round-trip)",
          drawingGet?.drawing?.shape?.type === "r" && drawingGet?.drawing?.text === "Smoke Zone",
          { observed: { type: drawingGet?.drawing?.shape?.type, text: drawingGet?.drawing?.text } }
        );
        markAndPush(
          summary,
          "scene.drawing.create(author present and not spoofed)",
          typeof drawingGet?.drawing?.author === "string" &&
            drawingGet.drawing.author.length > 0 &&
            drawingGet.drawing.author !== "spoofed-author-id",
          { author: drawingGet?.drawing?.author }
        );
        expectOk(
          summary,
          "scene.drawing.list",
          runFoundryctl(["scene", "drawing", "list", "--scene-id", targetSceneId])
        );
        expectOk(
          summary,
          "scene.drawing.update",
          runFoundryctl([
            "scene",
            "drawing",
            "update",
            "--scene-id",
            targetSceneId,
            "--drawing-id",
            drawingId,
            "--patch-json",
            JSON.stringify({ text: "Smoke Zone (renamed)" })
          ])
        );
        const drawingClone = expectOk(
          summary,
          "scene.drawing.clone",
          runFoundryctl([
            "scene",
            "drawing",
            "clone",
            "--scene-id",
            targetSceneId,
            "--drawing-id",
            drawingId,
            "--patch-json",
            JSON.stringify({ x: 320 })
          ])
        );
        if (drawingClone?.drawing?.id) {
          created.drawings.push({ sceneId: targetSceneId, drawingId: drawingClone.drawing.id });
        }
      }

      const lightCreate = expectOk(
        summary,
        "scene.light.create",
        runFoundryctl([
          "scene",
          "light",
          "create",
          "--scene-id",
          targetSceneId,
          "--data-json",
          JSON.stringify({ x: 400, y: 400, config: { dim: 40, bright: 20, color: "#ff9900" } })
        ])
      );
      const lightId = lightCreate?.light?.id ?? null;
      if (lightId) {
        created.lights.push({ sceneId: targetSceneId, lightId });
        const lightGet = expectOk(
          summary,
          "scene.light.get",
          runFoundryctl(["scene", "light", "get", "--scene-id", targetSceneId, "--light-id", lightId])
        );
        markAndPush(
          summary,
          "scene.light.get(config.dim/bright/color round-trip)",
          lightGet?.light?.config?.dim === 40 &&
            lightGet?.light?.config?.bright === 20 &&
            lightGet?.light?.config?.color === "#ff9900",
          { observed: lightGet?.light?.config ?? null }
        );
        expectOk(
          summary,
          "scene.light.list",
          runFoundryctl(["scene", "light", "list", "--scene-id", targetSceneId])
        );
        expectOk(
          summary,
          "scene.light.update",
          runFoundryctl([
            "scene",
            "light",
            "update",
            "--scene-id",
            targetSceneId,
            "--light-id",
            lightId,
            "--patch-json",
            JSON.stringify({ config: { dim: 10 } })
          ])
        );
        const lightClone = expectOk(
          summary,
          "scene.light.clone",
          runFoundryctl([
            "scene",
            "light",
            "clone",
            "--scene-id",
            targetSceneId,
            "--light-id",
            lightId,
            "--patch-json",
            JSON.stringify({ x: 420 })
          ])
        );
        if (lightClone?.light?.id) {
          created.lights.push({ sceneId: targetSceneId, lightId: lightClone.light.id });
        }
      }

      const templateCreateRun = runFoundryctl([
        "scene",
        "template",
        "create",
        "--scene-id",
        targetSceneId,
        "--data-json",
        JSON.stringify({ t: "circle", x: 600, y: 600, distance: 20 })
      ]);
      let templateCreate = null;
      if (isV14) {
        expectErr(
          summary,
          "scene.template.create(v14 gate)",
          templateCreateRun,
          ERROR_CODES.UNSUPPORTED_OPERATION
        );
        expectErr(
          summary,
          "scene.template.list(v14 gate)",
          runFoundryctl(["scene", "template", "list", "--scene-id", targetSceneId]),
          ERROR_CODES.UNSUPPORTED_OPERATION
        );
      } else {
        templateCreate = expectOk(summary, "scene.template.create", templateCreateRun);
      }
      const templateId = templateCreate?.template?.id ?? null;
      if (templateId) {
        created.templates.push({ sceneId: targetSceneId, templateId });
        const templateGet = expectOk(
          summary,
          "scene.template.get",
          runFoundryctl([
            "scene",
            "template",
            "get",
            "--scene-id",
            targetSceneId,
            "--template-id",
            templateId
          ])
        );
        markAndPush(
          summary,
          "scene.template.get(t/distance round-trip)",
          templateGet?.template?.t === "circle" && templateGet?.template?.distance === 20,
          { observed: { t: templateGet?.template?.t, distance: templateGet?.template?.distance } }
        );
        expectOk(
          summary,
          "scene.template.list",
          runFoundryctl(["scene", "template", "list", "--scene-id", targetSceneId])
        );
        expectOk(
          summary,
          "scene.template.update",
          runFoundryctl([
            "scene",
            "template",
            "update",
            "--scene-id",
            targetSceneId,
            "--template-id",
            templateId,
            "--patch-json",
            JSON.stringify({ distance: 30 })
          ])
        );
        const templateClone = expectOk(
          summary,
          "scene.template.clone",
          runFoundryctl([
            "scene",
            "template",
            "clone",
            "--scene-id",
            targetSceneId,
            "--template-id",
            templateId,
            "--patch-json",
            JSON.stringify({ x: 620 })
          ])
        );
        if (templateClone?.template?.id) {
          created.templates.push({ sceneId: targetSceneId, templateId: templateClone.template.id });
        }
      }

      const regionName = `Smoke Region ${stamp}`;
      const regionCreate = expectOk(
        summary,
        "scene.region.create",
        runFoundryctl([
          "scene",
          "region",
          "create",
          "--scene-id",
          targetSceneId,
          "--data-json",
          JSON.stringify({
            name: regionName,
            color: "#00ff00",
            shapes: [{ type: "rectangle", x: 0, y: 0, width: 200, height: 200 }]
          })
        ])
      );
      const regionId = regionCreate?.region?.id ?? null;
      if (regionId) {
        created.regions.push({ sceneId: targetSceneId, regionId });
        const regionGet = expectOk(
          summary,
          "scene.region.get",
          runFoundryctl(["scene", "region", "get", "--scene-id", targetSceneId, "--region-id", regionId])
        );
        markAndPush(
          summary,
          "scene.region.get(name/shapes round-trip)",
          regionGet?.region?.name === regionName &&
            Array.isArray(regionGet?.region?.shapes) &&
            regionGet.region.shapes.length === 1,
          { observed: { name: regionGet?.region?.name, shapes: regionGet?.region?.shapes?.length } }
        );
        const regionList = expectOk(
          summary,
          "scene.region.list(--name)",
          runFoundryctl(["scene", "region", "list", "--scene-id", targetSceneId, "--name", regionName])
        );
        markAndPush(
          summary,
          "scene.region.list(--name contains created region)",
          Array.isArray(regionList?.regions) && regionList.regions.some((region) => region.id === regionId),
          { count: regionList?.regions?.length }
        );
        expectOk(
          summary,
          "scene.region.update",
          runFoundryctl([
            "scene",
            "region",
            "update",
            "--scene-id",
            targetSceneId,
            "--region-id",
            regionId,
            "--patch-json",
            JSON.stringify({ color: "#0000ff" })
          ])
        );
        const regionClone = expectOk(
          summary,
          "scene.region.clone",
          runFoundryctl([
            "scene",
            "region",
            "clone",
            "--scene-id",
            targetSceneId,
            "--region-id",
            regionId,
            "--patch-json",
            JSON.stringify({ name: `${regionName} (clone)` })
          ])
        );
        if (regionClone?.region?.id) {
          created.regions.push({ sceneId: targetSceneId, regionId: regionClone.region.id });
        }

        const behaviorName = `Smoke Behavior ${stamp}`;
        const behaviorDry = expectOk(
          summary,
          "scene.region.behavior.create(--dry-run)",
          runFoundryctl([
            "scene",
            "region",
            "behavior",
            "create",
            "--scene-id",
            targetSceneId,
            "--region-id",
            regionId,
            "--type",
            "pauseGame",
            "--name",
            behaviorName,
            "--dry-run"
          ])
        );
        markAndPush(
          summary,
          "scene.region.behavior.create(dry run mints NO id and persists nothing)",
          behaviorDry?.dryRun === true &&
            behaviorDry?.behavior?.id === null &&
            behaviorDry?.behavior?.name === behaviorName,
          { observed: { dryRun: behaviorDry?.dryRun, id: behaviorDry?.behavior?.id } }
        );
        const behaviorCreate = expectOk(
          summary,
          "scene.region.behavior.create",
          runFoundryctl([
            "scene",
            "region",
            "behavior",
            "create",
            "--scene-id",
            targetSceneId,
            "--region-id",
            regionId,
            "--type",
            "pauseGame",
            "--name",
            behaviorName
          ])
        );
        const behaviorId = behaviorCreate?.behavior?.id ?? null;
        markAndPush(
          summary,
          "scene.region.behavior.create(nothing was created by the dry run)",
          behaviorId !== null && behaviorId !== behaviorDry?.behavior?.id,
          { observed: { behaviorId } }
        );
        if (behaviorId) {
          const behaviorGet = expectOk(
            summary,
            "scene.region.behavior.get",
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "get",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--behavior-id",
              behaviorId
            ])
          );
          markAndPush(
            summary,
            "scene.region.behavior.get(full projection: type/disabled/system, NO ownership or _stats)",
            behaviorGet?.behavior?.type === "pauseGame" &&
              behaviorGet?.behavior?.disabled === false &&
              behaviorGet?.behavior?.system !== undefined &&
              behaviorGet?.behavior?.ownership === undefined &&
              behaviorGet?.behavior?._stats === undefined,
            { observed: behaviorGet?.behavior }
          );
          const behaviorList = expectOk(
            summary,
            "scene.region.behavior.list(--name)",
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "list",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--name",
              behaviorName
            ])
          );
          markAndPush(
            summary,
            "scene.region.behavior.list(lean row: no system/flags, contains the created behavior)",
            Array.isArray(behaviorList?.behaviors) &&
              behaviorList.behaviors.some((behavior) => behavior.id === behaviorId) &&
              behaviorList.behaviors.every(
                (behavior) => behavior.system === undefined && behavior.flags === undefined
              ),
            { count: behaviorList?.behaviors?.length }
          );

          const blankRename = expectOk(
            summary,
            "scene.region.behavior.update(--name '' accepted)",
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "update",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--behavior-id",
              behaviorId,
              "--name",
              ""
            ])
          );
          const blankReread = expectOk(
            summary,
            "scene.region.behavior.get(after blank rename)",
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "get",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--behavior-id",
              behaviorId
            ])
          );
          markAndPush(
            summary,
            'scene.region.behavior blank name reads back as the STORED "" (not the localized type label)',
            blankRename?.behavior?.name === "" && blankReread?.behavior?.name === "",
            { observed: { write: blankRename?.behavior?.name, read: blankReread?.behavior?.name } }
          );

          expectOk(
            summary,
            "scene.region.behavior.update(restore name)",
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "update",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--behavior-id",
              behaviorId,
              "--name",
              behaviorName
            ])
          );
          const behaviorDisabled = expectOk(
            summary,
            "scene.region.behavior.update(--disabled true)",
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "update",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--behavior-id",
              behaviorId,
              "--disabled",
              "true"
            ])
          );
          markAndPush(
            summary,
            "scene.region.behavior.update(disabled round-trip)",
            behaviorDisabled?.behavior?.disabled === true,
            { observed: behaviorDisabled?.behavior?.disabled }
          );

          const behaviorMetaOnly = expectOk(
            summary,
            "scene.region.behavior.update(--patch-json protected meta ONLY -> ok, no-op)",
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "update",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--behavior-id",
              behaviorId,
              "--patch-json",
              JSON.stringify({ _id: "aaaaaaaaaaaaaaaa", _stats: { lastModifiedBy: "smoke" } })
            ])
          );
          const behaviorAfterMetaOnly = expectOk(
            summary,
            "scene.region.behavior.get(after the meta-only patch)",
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "get",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--behavior-id",
              behaviorId
            ])
          );
          markAndPush(
            summary,
            "scene.region.behavior meta-only patch is a no-op success and never rewrites the id",
            behaviorMetaOnly?.behavior?.id === behaviorId &&
              behaviorAfterMetaOnly?.behavior?.id === behaviorId &&
              behaviorAfterMetaOnly?.behavior?.name === behaviorName,
            {
              observed: {
                written: behaviorMetaOnly?.behavior?.id,
                reread: behaviorAfterMetaOnly?.behavior?.id,
                name: behaviorAfterMetaOnly?.behavior?.name
              }
            }
          );

          expectErr(
            summary,
            "scene.region.behavior.update(--patch-json CHANGED type -> INVALID_PARAMS, create-only)",
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "update",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--behavior-id",
              behaviorId,
              "--patch-json",
              JSON.stringify({ type: "suppressWeather" })
            ]),
            ERROR_CODES.INVALID_PARAMS
          );

          expectErr(
            summary,
            "scene.region.behavior.update(--patch-json UNCHANGED type -> INVALID_PARAMS, policy)",
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "update",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--behavior-id",
              behaviorId,
              "--patch-json",
              JSON.stringify({ type: "pauseGame" })
            ]),
            ERROR_CODES.INVALID_PARAMS
          );

          expectErr(
            summary,
            "scene.region.behavior.clone(--patch-json type -> INVALID_PARAMS, create-only)",
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "clone",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--behavior-id",
              behaviorId,
              "--patch-json",
              JSON.stringify({ type: "suppressWeather" })
            ]),
            ERROR_CODES.INVALID_PARAMS
          );
          const behaviorClone = expectOk(
            summary,
            "scene.region.behavior.clone",
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "clone",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--behavior-id",
              behaviorId,
              "--name",
              `${behaviorName} (clone)`
            ])
          );
          markAndPush(
            summary,
            "scene.region.behavior.clone(fresh id + patched name)",
            Boolean(behaviorClone?.behavior?.id) &&
              behaviorClone.behavior.id !== behaviorId &&
              behaviorClone.behavior.name === `${behaviorName} (clone)`,
            { observed: { id: behaviorClone?.behavior?.id, name: behaviorClone?.behavior?.name } }
          );
          if (behaviorClone?.behavior?.id) {
            const cloneDelete = expectOk(
              summary,
              "scene.region.behavior.delete(clone)",
              runFoundryctl([
                "scene",
                "region",
                "behavior",
                "delete",
                "--scene-id",
                targetSceneId,
                "--region-id",
                regionId,
                "--behavior-id",
                behaviorClone.behavior.id
              ])
            );
            markAndPush(
              summary,
              "scene.region.behavior.delete(shape)",
              cloneDelete?.deleted === true && cloneDelete?.id === behaviorClone.behavior.id,
              { observed: cloneDelete }
            );
            expectErr(
              summary,
              "scene.region.behavior.get(deleted id -> REGION_BEHAVIOR_NOT_FOUND)",
              runFoundryctl([
                "scene",
                "region",
                "behavior",
                "get",
                "--scene-id",
                targetSceneId,
                "--region-id",
                regionId,
                "--behavior-id",
                behaviorClone.behavior.id
              ]),
              ERROR_CODES.REGION_BEHAVIOR_NOT_FOUND
            );
          }
        }

        for (const [type, payload] of [
          ["executeScript", { type: "executeScript", system: { source: "console.log('smoke')" } }],
          ["executeMacro", { type: "executeMacro", system: {} }]
        ]) {
          expectErr(
            summary,
            `scene.region.behavior.create(${type} -> INVALID_PARAMS)`,
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "create",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--type",
              type,
              "--data-json",
              JSON.stringify(payload)
            ]),
            ERROR_CODES.INVALID_PARAMS
          );
          expectErr(
            summary,
            `scene.region.behavior.create(${type} --dry-run -> INVALID_PARAMS too)`,
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "create",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--type",
              type,
              "--data-json",
              JSON.stringify(payload),
              "--dry-run"
            ]),
            ERROR_CODES.INVALID_PARAMS
          );
        }

        expectErr(
          summary,
          "scene.region.create(inline executeScript behavior -> INVALID_PARAMS, legacy route shares the guard)",
          runFoundryctl([
            "scene",
            "region",
            "create",
            "--scene-id",
            targetSceneId,
            "--data-json",
            JSON.stringify({
              name: `Smoke Region Script ${stamp}`,
              shapes: [{ type: "rectangle", x: 0, y: 0, width: 50, height: 50 }],
              behaviors: [{ type: "executeScript", system: { source: "console.log('smoke')" } }]
            })
          ]),
          ERROR_CODES.INVALID_PARAMS
        );
        if (behaviorId) {
          const unpatchedClone = expectOk(
            summary,
            "scene.region.behavior.clone(NO patch -> allowed)",
            runFoundryctl([
              "scene",
              "region",
              "behavior",
              "clone",
              "--scene-id",
              targetSceneId,
              "--region-id",
              regionId,
              "--behavior-id",
              behaviorId
            ])
          );
          markAndPush(
            summary,
            "scene.region.behavior.clone(unpatched clone copies the source verbatim with a fresh id)",
            Boolean(unpatchedClone?.behavior?.id) &&
              unpatchedClone.behavior.id !== behaviorId &&
              unpatchedClone.behavior.type === "pauseGame",
            { observed: { id: unpatchedClone?.behavior?.id, type: unpatchedClone?.behavior?.type } }
          );
          if (unpatchedClone?.behavior?.id) {
            expectOk(
              summary,
              "scene.region.behavior.delete(unpatched clone)",
              runFoundryctl([
                "scene",
                "region",
                "behavior",
                "delete",
                "--scene-id",
                targetSceneId,
                "--region-id",
                regionId,
                "--behavior-id",
                unpatchedClone.behavior.id
              ])
            );
          }
        }

        expectErr(
          summary,
          "scene.region.behavior.get(bad behavior id -> REGION_BEHAVIOR_NOT_FOUND)",
          runFoundryctl([
            "scene",
            "region",
            "behavior",
            "get",
            "--scene-id",
            targetSceneId,
            "--region-id",
            regionId,
            "--behavior-id",
            createMissingId("behavior", stamp)
          ]),
          ERROR_CODES.REGION_BEHAVIOR_NOT_FOUND
        );
        expectErr(
          summary,
          "scene.region.behavior.get(bad region id -> REGION_NOT_FOUND, parent resolves first)",
          runFoundryctl([
            "scene",
            "region",
            "behavior",
            "get",
            "--scene-id",
            targetSceneId,
            "--region-id",
            createMissingId("region", stamp),
            "--behavior-id",
            createMissingId("behavior", stamp)
          ]),
          ERROR_CODES.REGION_NOT_FOUND
        );
      }

      const sceneCountsGet = expectOk(
        summary,
        "scene.get(counts)",
        runFoundryctl(["scene", "get", "--scene-id", targetSceneId])
      );
      const counts = sceneCountsGet?.scene?.counts ?? null;
      const countKeys = [
        "tokens",
        "tiles",
        "sounds",
        "walls",
        "notes",
        "drawings",
        "lights",
        "templates",
        "levels",
        "regions"
      ];
      markAndPush(
        summary,
        "scene.get(counts has all ten keys)",
        counts !== null && countKeys.every((key) => typeof counts[key] === "number"),
        { observed: counts }
      );
      markAndPush(
        summary,
        "scene.get(counts.walls/notes reflect created)",
        counts !== null && counts.walls >= 1 && counts.notes >= 1,
        { walls: counts?.walls, notes: counts?.notes }
      );

      markAndPush(
        summary,
        "scene.get(counts.drawings/lights/templates/regions reflect created)",
        counts !== null &&
          counts.drawings >= 1 &&
          counts.lights >= 1 &&
          (isV14 ? typeof counts.templates === "number" : counts.templates >= 1) &&
          counts.regions >= 1,
        {
          drawings: counts?.drawings,
          lights: counts?.lights,
          templates: counts?.templates,
          templatesExpectation: isV14
            ? "number (v14: not pinned — may be synthesized from migrated MeasuredTemplate regions)"
            : ">= 1 (v13)",
          regions: counts?.regions
        }
      );
    }

    const macroBatchCreate = expectOk(
      summary,
      "macro.create(get-many fixture)",
      runFoundryctl([
        "macro",
        "create",
        "--name",
        `Smoke Batch Macro ${stamp}`,
        "--type",
        "script",
        "--command",
        "// smoke get-many fixture (never executed)"
      ])
    );
    const batchMacroId = macroBatchCreate?.macro?.id ?? null;
    if (batchMacroId) {
      const macroBatch = expectOk(
        summary,
        "macro.get-many",
        runFoundryctl(["macro", "get-many", "--ids", batchMacroId])
      );
      markAndPush(
        summary,
        "macro.get-many(order + ownership)",
        macroBatch?.macros?.[0]?.id === batchMacroId && Boolean(macroBatch?.macros?.[0]?.ownership),
        { firstId: macroBatch?.macros?.[0]?.id, hasOwnership: Boolean(macroBatch?.macros?.[0]?.ownership) }
      );

      expectErr(
        summary,
        "macro.get-many(missing)",
        runFoundryctl(["macro", "get-many", "--ids", `${batchMacroId},${createMissingId("macro", stamp)}`]),
        ERROR_CODES.MACRO_NOT_FOUND
      );
      expectOk(
        summary,
        "macro.delete(get-many fixture cleanup)",
        runFoundryctl(["macro", "delete", "--macro-id", batchMacroId])
      );
    }

    const playlistCreate = expectOk(
      summary,
      "playlist.create",
      runFoundryctl([
        "playlist",
        "create",
        "--name",
        `Smoke Playlist ${stamp}`,

        "--mode",
        "1",
        "--channel",
        "music",
        "--sorting",
        "a",
        "--sounds-json",
        JSON.stringify([{ path: "sounds/combat/general-fight.ogg", volume: 0.5 }])
      ])
    );
    const createdPlaylistId = playlistCreate?.playlist?.id ?? null;
    if (createdPlaylistId) {
      created.playlists.push(createdPlaylistId);

      markAndPush(
        summary,
        "playlist.create(mode/channel/sorting round-trip)",
        playlistCreate?.playlist?.mode === 1 &&
          playlistCreate?.playlist?.channel === "music" &&
          playlistCreate?.playlist?.sorting === "a",
        {
          mode: playlistCreate?.playlist?.mode,
          channel: playlistCreate?.playlist?.channel,
          sorting: playlistCreate?.playlist?.sorting
        }
      );

      const inlineCount = playlistCreate?.playlist?.sounds?.length ?? 0;
      markAndPush(summary, "playlist.create(inline-sounds count)", inlineCount === 1, {
        expected: 1,
        actual: inlineCount
      });
      expectOk(summary, "playlist.list", runFoundryctl(["playlist", "list"]));
      expectOk(
        summary,
        "playlist.get",
        runFoundryctl(["playlist", "get", "--playlist-id", createdPlaylistId])
      );

      const playlistBatch = expectOk(
        summary,
        "playlist.get-many",
        runFoundryctl(["playlist", "get-many", "--ids", createdPlaylistId])
      );
      markAndPush(
        summary,
        "playlist.get-many(order + ownership)",
        playlistBatch?.playlists?.[0]?.id === createdPlaylistId &&
          Boolean(playlistBatch?.playlists?.[0]?.ownership),
        {
          firstId: playlistBatch?.playlists?.[0]?.id,
          hasOwnership: Boolean(playlistBatch?.playlists?.[0]?.ownership)
        }
      );

      const playRes = expectOk(
        summary,
        "playlist.play",
        runFoundryctl(["playlist", "play", "--playlist-id", createdPlaylistId])
      );
      markAndPush(summary, "playlist.play(playing flips true)", playRes?.playlist?.playing === true, {
        observed: playRes?.playlist?.playing
      });
      expectOk(
        summary,
        "playlist.stop",
        runFoundryctl(["playlist", "stop", "--playlist-id", createdPlaylistId])
      );

      expectOk(
        summary,
        "playlist.playNext",
        runFoundryctl(["playlist", "play-next", "--playlist-id", createdPlaylistId])
      );
      expectOk(
        summary,
        "playlist.stop(after next)",
        runFoundryctl(["playlist", "stop", "--playlist-id", createdPlaylistId])
      );

      expectOk(
        summary,
        "playlist.update",
        runFoundryctl([
          "playlist",
          "update",
          "--playlist-id",
          createdPlaylistId,
          "--name",
          `Smoke Playlist ${stamp} v2`
        ])
      );
      const playlistClone = expectOk(
        summary,
        "playlist.clone",
        runFoundryctl([
          "playlist",
          "clone",
          "--playlist-id",
          createdPlaylistId,
          "--name",
          `Smoke Playlist Copy ${stamp}`
        ])
      );
      if (playlistClone?.playlist?.id) {
        created.playlists.push(playlistClone.playlist.id);
      }

      const soundCreate = expectOk(
        summary,
        "playlist.sound.create",
        runFoundryctl([
          "playlist",
          "sound",
          "create",
          "--playlist-id",
          createdPlaylistId,
          "--path",
          "sounds/combat/general-fight.ogg",
          "--volume",
          "0.5"
        ])
      );
      const playlistSoundId = soundCreate?.sound?.id ?? null;
      if (playlistSoundId) {
        expectOk(
          summary,
          "playlist.sound.list",
          runFoundryctl(["playlist", "sound", "list", "--playlist-id", createdPlaylistId])
        );
        const soundGet = expectOk(
          summary,
          "playlist.sound.get",
          runFoundryctl([
            "playlist",
            "sound",
            "get",
            "--playlist-id",
            createdPlaylistId,
            "--sound-id",
            playlistSoundId
          ])
        );

        markAndPush(
          summary,
          "playlist.sound.get(duration field present)",
          Boolean(soundGet?.sound && Object.prototype.hasOwnProperty.call(soundGet.sound, "duration")),
          { duration: soundGet?.sound?.duration ?? null }
        );

        const soundUpdate = expectOk(
          summary,
          "playlist.sound.update",
          runFoundryctl([
            "playlist",
            "sound",
            "update",
            "--playlist-id",
            createdPlaylistId,
            "--sound-id",
            playlistSoundId,
            "--volume",
            "0.5"
          ])
        );
        const observedVolume = soundUpdate?.sound?.volume ?? null;
        markAndPush(summary, "playlist.sound.update(volume round-trip)", observedVolume === 0.5, {
          expected: 0.5,
          observed: observedVolume
        });

        const sPlay = expectOk(
          summary,
          "playlist.sound.play",
          runFoundryctl([
            "playlist",
            "sound",
            "play",
            "--playlist-id",
            createdPlaylistId,
            "--sound-id",
            playlistSoundId
          ])
        );
        markAndPush(summary, "playlist.sound.play(playing flips true)", sPlay?.sound?.playing === true, {
          observed: sPlay?.sound?.playing
        });
        expectOk(
          summary,
          "playlist.sound.stop",
          runFoundryctl([
            "playlist",
            "sound",
            "stop",
            "--playlist-id",
            createdPlaylistId,
            "--sound-id",
            playlistSoundId
          ])
        );
        expectOk(
          summary,
          "playlist.sound.clone",
          runFoundryctl([
            "playlist",
            "sound",
            "clone",
            "--playlist-id",
            createdPlaylistId,
            "--sound-id",
            playlistSoundId
          ])
        );
        expectOk(
          summary,
          "playlist.sound.delete",
          runFoundryctl([
            "playlist",
            "sound",
            "delete",
            "--playlist-id",
            createdPlaylistId,
            "--sound-id",
            playlistSoundId
          ])
        );
      }
    }

    expectErr(
      summary,
      "playlist.get(missing)",
      runFoundryctl(["playlist", "get", "--playlist-id", createMissingId("playlist", stamp)]),
      ERROR_CODES.PLAYLIST_NOT_FOUND
    );

    expectErr(
      summary,
      "playlist.get-many(missing)",
      runFoundryctl([
        "playlist",
        "get-many",
        "--ids",
        `${createdPlaylistId ?? createMissingId("playlist", stamp)},${createMissingId("playlist", `${stamp}-x`)}`
      ]),
      ERROR_CODES.PLAYLIST_NOT_FOUND
    );
    if (createdPlaylistId) {
      expectErr(
        summary,
        "playlist.sound.get(missing)",
        runFoundryctl([
          "playlist",
          "sound",
          "get",
          "--playlist-id",
          createdPlaylistId,
          "--sound-id",
          createMissingId("sound", stamp)
        ]),
        ERROR_CODES.PLAYLIST_SOUND_NOT_FOUND
      );
    }

    if (worldId) {
      const auditSmokeDir = `worlds/${worldId}/fvtt-world-cli/smoke/${stamp}`;
      const auditHttpImg = `https://example.invalid/audit-${stamp}.png`;
      const auditMissingPath = `${auditSmokeDir}/audit-missing-${stamp}.ogg`;

      const auditMacro = expectOk(
        summary,
        "macro.create(audit https img)",
        runFoundryctl([
          "macro",
          "create",
          "--name",
          `Smoke Audit Macro ${stamp}`,
          "--type",
          "script",
          "--command",
          "// smoke audit (never executed)",
          "--img",
          auditHttpImg
        ])
      );
      const auditMacroId = auditMacro?.macro?.id ?? null;
      if (auditMacroId) {
        created.macros.push(auditMacroId);
      }

      const auditPlaylist = expectOk(
        summary,
        "playlist.create(audit broken sound)",
        runFoundryctl([
          "playlist",
          "create",
          "--name",
          `Smoke Audit Playlist ${stamp}`,
          "--sounds-json",
          JSON.stringify([{ path: auditMissingPath }])
        ])
      );
      const auditPlaylistId = auditPlaylist?.playlist?.id ?? null;
      if (auditPlaylistId) {
        created.playlists.push(auditPlaylistId);
      }

      const audit = expectOk(
        summary,
        "world.audit-files(scope playlist,macro)",
        runFoundryctl(["world", "audit-files", "--scope", "playlist,macro"])
      );
      const auditBroken = Array.isArray(audit?.broken) ? audit.broken : [];
      const auditSkipped = Array.isArray(audit?.skipped) ? audit.skipped : [];

      const brokenRef =
        auditBroken.find(
          (ref) =>
            ref?.docType === "PlaylistSound" && ref?.field === "path" && ref?.parent === auditPlaylistId
        ) ?? null;
      markAndPush(
        summary,
        "world.audit-files(broken playlist-sound reported)",
        Boolean(
          brokenRef && typeof brokenRef.path === "string" && brokenRef.path.includes(`audit-missing-${stamp}`)
        ),
        {
          brokenRef: brokenRef
            ? {
                docType: brokenRef.docType,
                field: brokenRef.field,
                parent: brokenRef.parent,
                path: brokenRef.path
              }
            : null,
          brokenCount: auditBroken.length
        }
      );

      const httpFlaggedBroken = auditBroken.some((ref) => ref?.path === auditHttpImg);
      const httpSkipped = auditSkipped.some(
        (entry) => entry?.path === auditHttpImg && entry?.reason === "public-or-external"
      );
      markAndPush(
        summary,
        "world.audit-files(https img skipped, not broken)",
        httpSkipped && !httpFlaggedBroken,
        {
          httpSkipped,
          httpFlaggedBroken
        }
      );
      markAndPush(summary, "world.audit-files(checkedRefs > 0)", (audit?.checkedRefs ?? 0) > 0, {
        checkedRefs: audit?.checkedRefs ?? 0
      });
    }

    if (worldId) {
      const crossSmokeDir = `worlds/${worldId}/fvtt-world-cli/smoke/${stamp}`;
      const crossNameA = `Smoke XPlaylist A ${stamp}`;
      const crossNameB = `Smoke XPlaylist B ${stamp}`;
      const crossPathA = `${crossSmokeDir}/cross-${stamp}-alpha.ogg`;
      const crossPathB = `${crossSmokeDir}/cross-${stamp}-bravo.ogg`;

      const crossA = expectOk(
        summary,
        "playlist.create(cross A)",
        runFoundryctl([
          "playlist",
          "create",
          "--name",
          crossNameA,
          "--sounds-json",
          JSON.stringify([{ path: crossPathA }])
        ])
      );
      const crossAId = crossA?.playlist?.id ?? null;
      const crossASoundId = crossA?.playlist?.sounds?.[0]?.id ?? null;
      if (crossAId) {
        created.playlists.push(crossAId);
      }
      const crossB = expectOk(
        summary,
        "playlist.create(cross B)",
        runFoundryctl([
          "playlist",
          "create",
          "--name",
          crossNameB,
          "--sounds-json",
          JSON.stringify([{ path: crossPathB }])
        ])
      );
      const crossBId = crossB?.playlist?.id ?? null;
      const crossBSoundId = crossB?.playlist?.sounds?.[0]?.id ?? null;
      if (crossBId) {
        created.playlists.push(crossBId);
      }

      const crossBoth = expectOk(
        summary,
        "playlist.sound.list(cross, no playlist-id)",
        runFoundryctl(["playlist", "sound", "list", "--path", `cross-${stamp}`])
      );
      const crossRows = Array.isArray(crossBoth?.sounds) ? crossBoth.sounds : [];
      const rowA = crossRows.find((row) => row?.id === crossASoundId) ?? null;
      const rowB = crossRows.find((row) => row?.id === crossBSoundId) ?? null;
      markAndPush(
        summary,
        "playlist.sound.list(cross rows carry playlistId/playlistName)",
        Boolean(
          rowA &&
          rowB &&
          rowA.playlistId === crossAId &&
          rowA.playlistName === crossNameA &&
          rowB.playlistId === crossBId &&
          rowB.playlistName === crossNameB
        ),
        {
          rowA: rowA ? { playlistId: rowA.playlistId, playlistName: rowA.playlistName } : null,
          rowB: rowB ? { playlistId: rowB.playlistId, playlistName: rowB.playlistName } : null
        }
      );

      const crossNarrow = expectOk(
        summary,
        "playlist.sound.list(--path narrows to one)",
        runFoundryctl(["playlist", "sound", "list", "--path", `${stamp}-alpha`])
      );
      const narrowRows = Array.isArray(crossNarrow?.sounds) ? crossNarrow.sounds : [];
      markAndPush(
        summary,
        "playlist.sound.list(--path narrowing excludes the other track)",
        narrowRows.some((row) => row?.id === crossASoundId) &&
          !narrowRows.some((row) => row?.id === crossBSoundId),
        { matched: narrowRows.length }
      );
    }

    const bogusDotted = runFoundryctl(["playlist.sound.get"]);
    markAndPush(summary, "cli.unknown-command(dotted → exit 2)", bogusDotted.exitCode === 2, {
      exitCode: bogusDotted.exitCode,
      command: bogusDotted.command
    });

    const chatPlain = expectOk(
      summary,
      "chat.create(plain)",
      runFoundryctl(["chat", "create", "--content", `Smoke public ${stamp}`, "--style", "2"])
    );
    const plainMessageId = chatPlain?.message?.id ?? null;
    if (plainMessageId) {
      created.messages.push(plainMessageId);
      markAndPush(summary, "chat.create(style round-trip)", chatPlain?.message?.style === 2, {
        expected: 2,
        actual: chatPlain?.message?.style
      });
    }

    let whisperMessageId = null;
    if (gmUserId) {
      const chatWhisper = expectOk(
        summary,
        "chat.create(whisper)",
        runFoundryctl(["chat", "create", "--content", `Smoke whisper ${stamp}`, "--whisper", gmUserId])
      );
      whisperMessageId = chatWhisper?.message?.id ?? null;
      if (whisperMessageId) {
        created.messages.push(whisperMessageId);
        markAndPush(
          summary,
          "chat.create(whisper targets gm)",
          Array.isArray(chatWhisper?.message?.whisper) && chatWhisper.message.whisper.includes(gmUserId),
          { observed: chatWhisper?.message?.whisper }
        );
      }
    }

    const chatRoll = expectOk(
      summary,
      "chat.create(roll)",
      runFoundryctl(["chat", "create", "--content", `Smoke roll ${stamp}`, "--roll", "2d6+3"])
    );
    const rollMessageId = chatRoll?.message?.id ?? null;
    if (rollMessageId) {
      created.messages.push(rollMessageId);

      const rollTotal = chatRoll?.message?.rolls?.[0]?.total ?? null;
      markAndPush(
        summary,
        "chat.create(roll total present)",
        typeof rollTotal === "number" && rollTotal >= 5 && rollTotal <= 15,
        {
          observed: rollTotal,
          note: "record the working evaluate() signature + rolls[] form (instance vs toJSON) here"
        }
      );
    }

    const chatList = expectOk(summary, "chat.list", runFoundryctl(["chat", "list"]));
    const listedIds = Array.isArray(chatList?.messages) ? chatList.messages.map((m) => m.id) : [];
    const allPresent = created.messages.every((id) => listedIds.includes(id));
    markAndPush(summary, "chat.list(created ids on offset-0 page)", allPresent, {
      created: created.messages,
      listedHead: listedIds.slice(0, 5)
    });
    if (plainMessageId && rollMessageId) {
      const plainIdx = listedIds.indexOf(plainMessageId);
      const rollIdx = listedIds.indexOf(rollMessageId);
      markAndPush(
        summary,
        "chat.list(newest-first order)",
        rollIdx !== -1 && plainIdx !== -1 && rollIdx < plainIdx,
        { rollIdx, plainIdx }
      );
    }

    if (plainMessageId) {
      const chatGet = expectOk(
        summary,
        "chat.get",
        runFoundryctl(["chat", "get", "--message-id", plainMessageId])
      );
      markAndPush(
        summary,
        "chat.get(content round-trip)",
        typeof chatGet?.message?.content === "string" &&
          chatGet.message.content.includes(`Smoke public ${stamp}`),
        { observed: chatGet?.message?.content }
      );
    }

    expectErr(
      summary,
      "chat.get(missing)",
      runFoundryctl(["chat", "get", "--message-id", createMissingId("chat", stamp)]),
      ERROR_CODES.CHAT_MESSAGE_NOT_FOUND
    );

    if (targetSceneId) {
      expectErr(
        summary,
        "scene.token.get(missing)",
        runFoundryctl([
          "scene",
          "token",
          "get",
          "--scene-id",
          targetSceneId,
          "--token-id",
          createMissingId("token", stamp)
        ]),
        ERROR_CODES.TOKEN_NOT_FOUND
      );
      expectErr(
        summary,
        "scene.tile.get(missing)",
        runFoundryctl([
          "scene",
          "tile",
          "get",
          "--scene-id",
          targetSceneId,
          "--tile-id",
          createMissingId("tile", stamp)
        ]),
        ERROR_CODES.TILE_NOT_FOUND
      );
      expectErr(
        summary,
        "scene.sound.get(missing)",
        runFoundryctl([
          "scene",
          "sound",
          "get",
          "--scene-id",
          targetSceneId,
          "--sound-id",
          createMissingId("sound", stamp)
        ]),
        ERROR_CODES.SOUND_NOT_FOUND
      );
      expectErr(
        summary,
        "scene.wall.get(missing)",
        runFoundryctl([
          "scene",
          "wall",
          "get",
          "--scene-id",
          targetSceneId,
          "--wall-id",
          createMissingId("wall", stamp)
        ]),
        ERROR_CODES.WALL_NOT_FOUND
      );
      expectErr(
        summary,
        "scene.note.get(missing)",
        runFoundryctl([
          "scene",
          "note",
          "get",
          "--scene-id",
          targetSceneId,
          "--note-id",
          createMissingId("note", stamp)
        ]),
        ERROR_CODES.NOTE_NOT_FOUND
      );
      expectErr(
        summary,
        "scene.drawing.get(missing)",
        runFoundryctl([
          "scene",
          "drawing",
          "get",
          "--scene-id",
          targetSceneId,
          "--drawing-id",
          createMissingId("drawing", stamp)
        ]),
        ERROR_CODES.DRAWING_NOT_FOUND
      );
      expectErr(
        summary,
        "scene.light.get(missing)",
        runFoundryctl([
          "scene",
          "light",
          "get",
          "--scene-id",
          targetSceneId,
          "--light-id",
          createMissingId("light", stamp)
        ]),
        ERROR_CODES.LIGHT_NOT_FOUND
      );

      expectErr(
        summary,
        "scene.template.get(missing)",
        runFoundryctl([
          "scene",
          "template",
          "get",
          "--scene-id",
          targetSceneId,
          "--template-id",
          createMissingId("template", stamp)
        ]),
        isV14 ? ERROR_CODES.UNSUPPORTED_OPERATION : ERROR_CODES.TEMPLATE_NOT_FOUND
      );
      expectErr(
        summary,
        "scene.region.get(missing)",
        runFoundryctl([
          "scene",
          "region",
          "get",
          "--scene-id",
          targetSceneId,
          "--region-id",
          createMissingId("region", stamp)
        ]),
        ERROR_CODES.REGION_NOT_FOUND
      );

      if (targetSceneActive) {
        expectErr(
          summary,
          "scene.delete(active,no-force)",
          runFoundryctl(["scene", "delete", "--scene-id", targetSceneId]),
          ERROR_CODES.DELETE_FORBIDDEN
        );
      }
    }

    const tableCreate = expectOk(
      summary,
      "table.create",
      runFoundryctl([
        "table",
        "create",
        "--name",
        `Smoke Table ${stamp}`,
        "--formula",
        "1d6",
        "--replacement",
        "false",
        "--display-roll",
        "true",
        "--img",
        "icons/svg/d20-grey.svg",
        "--results-json",
        JSON.stringify([
          { name: "Sword", range: [1, 3], weight: 2 },
          { name: "Coin", range: [4, 6], drawn: true }
        ])
      ])
    );

    const tableCreateDry = expectOk(
      summary,
      "table.create(dry-run)",
      runFoundryctl([
        "--dry-run",
        "table",
        "create",
        "--name",
        `Smoke Table Preview ${stamp}`,
        "--formula",
        "1d2",
        "--results-json",
        JSON.stringify([{ name: "Preview row", range: [1, 2] }])
      ])
    );
    markAndPush(
      summary,
      "table.create(dry-run nulls table AND inline result ids)",
      tableCreateDry?.dryRun === true &&
        tableCreateDry?.table?.id === null &&
        tableCreateDry?.table?._id === null &&
        (tableCreateDry?.table?.results ?? []).length === 1 &&
        (tableCreateDry?.table?.results ?? []).every((result) => result.id === null && result._id === null),
      {
        dryRun: tableCreateDry?.dryRun,
        tableId: tableCreateDry?.table?.id,
        resultIds: (tableCreateDry?.table?.results ?? []).map((result) => result.id)
      }
    );

    const createdTableId = tableCreate?.table?.id ?? null;
    if (createdTableId) {
      created.tables.push(createdTableId);
      markAndPush(
        summary,
        "table.create(field round-trip)",
        tableCreate?.table?.formula === "1d6" &&
          tableCreate?.table?.replacement === false &&
          tableCreate?.table?.displayRoll === true,
        {
          formula: tableCreate?.table?.formula,
          replacement: tableCreate?.table?.replacement,
          displayRoll: tableCreate?.table?.displayRoll
        }
      );
      markAndPush(
        summary,
        "table.create(inline-results count)",
        (tableCreate?.table?.results?.length ?? 0) === 2,
        {
          count: tableCreate?.table?.results?.length ?? 0
        }
      );

      const firstResult = tableCreate?.table?.results?.[0] ?? null;
      markAndPush(
        summary,
        "table.create(result range/weight round-trip)",
        Array.isArray(firstResult?.range) &&
          firstResult.range[0] === 1 &&
          firstResult.range[1] === 3 &&
          firstResult.weight === 2,
        { range: firstResult?.range, weight: firstResult?.weight }
      );

      expectOk(summary, "table.list", runFoundryctl(["table", "list", "--name", `Smoke Table ${stamp}`]));
      const tableGet = expectOk(
        summary,
        "table.get",
        runFoundryctl(["table", "get", "--table-id", createdTableId])
      );

      markAndPush(
        summary,
        "table.get(ownership present, results carry none)",
        Boolean(tableGet?.table?.ownership) &&
          (tableGet?.table?.results ?? []).every((result) => result.ownership === undefined),
        { hasOwnership: Boolean(tableGet?.table?.ownership) }
      );

      const tableListRun = expectOk(
        summary,
        "table.list(counts)",
        runFoundryctl(["table", "list", "--name", `Smoke Table ${stamp}`])
      );
      const listedTable = (tableListRun?.tables ?? []).find((row) => row.id === createdTableId) ?? null;
      markAndPush(
        summary,
        "table.list(resultCount/drawnCount, no result bodies)",
        listedTable?.resultCount === 2 && listedTable?.drawnCount === 1 && listedTable?.results === undefined,
        { resultCount: listedTable?.resultCount, drawnCount: listedTable?.drawnCount }
      );

      const tableBatch = expectOk(
        summary,
        "table.get-many",
        runFoundryctl(["table", "get-many", "--ids", createdTableId])
      );
      markAndPush(
        summary,
        "table.get-many(order + ownership)",
        tableBatch?.tables?.[0]?.id === createdTableId && Boolean(tableBatch?.tables?.[0]?.ownership),
        { firstId: tableBatch?.tables?.[0]?.id, hasOwnership: Boolean(tableBatch?.tables?.[0]?.ownership) }
      );

      const tableUpdate = expectOk(
        summary,
        "table.update",
        runFoundryctl([
          "table",
          "update",
          "--table-id",
          createdTableId,
          "--name",
          `Smoke Table ${stamp} v2`,
          "--formula",
          "1d8"
        ])
      );
      markAndPush(summary, "table.update(formula round-trip)", tableUpdate?.table?.formula === "1d8", {
        formula: tableUpdate?.table?.formula
      });

      expectErr(
        summary,
        "table.update(results rejected on patch)",
        runFoundryctl([
          "table",
          "update",
          "--table-id",
          createdTableId,
          "--patch-json",
          JSON.stringify({ results: [] })
        ]),
        ERROR_CODES.INVALID_PARAMS
      );

      const tableOwnership = expectOk(
        summary,
        "table.ownership.set",
        runFoundryctl(["table", "ownership", "set", "--table-id", createdTableId, "--default", "2"])
      );
      markAndPush(
        summary,
        "table.ownership.set(default merged)",
        tableOwnership?.table?.ownership?.default === 2,
        {
          ownership: tableOwnership?.table?.ownership
        }
      );

      const tableClone = expectOk(
        summary,
        "table.clone",
        runFoundryctl(["table", "clone", "--table-id", createdTableId, "--name", `Smoke Table Copy ${stamp}`])
      );
      if (tableClone?.table?.id) {
        created.tables.push(tableClone.table.id);
        markAndPush(summary, "table.clone(results copied)", (tableClone?.table?.results?.length ?? 0) === 2, {
          count: tableClone?.table?.results?.length ?? 0
        });
      }

      const resultCreate = expectOk(
        summary,
        "table.result.create",
        runFoundryctl([
          "table",
          "result",
          "create",
          "--table-id",
          createdTableId,
          "--range",
          "7,8",
          "--name",
          `Smoke Row ${stamp}`,
          "--weight",
          "3",
          "--img",
          "icons/svg/d20-grey.svg"
        ])
      );
      const createdResultId = resultCreate?.result?.id ?? null;
      markAndPush(
        summary,
        "table.result.create(field round-trip, no ownership key)",
        resultCreate?.tableId === createdTableId &&
          Boolean(createdResultId) &&
          resultCreate?.result?.weight === 3 &&
          resultCreate?.result?.range?.[0] === 7 &&
          resultCreate?.result?.range?.[1] === 8 &&
          resultCreate?.result?.type === "text" &&
          resultCreate?.result?.ownership === undefined,
        { id: createdResultId, range: resultCreate?.result?.range, weight: resultCreate?.result?.weight }
      );

      const resultCreateDry = expectOk(
        summary,
        "table.result.create(dry-run)",
        runFoundryctl([
          "--dry-run",
          "table",
          "result",
          "create",
          "--table-id",
          createdTableId,
          "--range",
          "9,9",
          "--name",
          `Smoke Row Preview ${stamp}`
        ])
      );
      markAndPush(
        summary,
        "table.result.create(dry-run nulls the row id, persists nothing)",
        resultCreateDry?.dryRun === true &&
          resultCreateDry?.result?.id === null &&
          resultCreateDry?.result?._id === null,
        { dryRun: resultCreateDry?.dryRun, id: resultCreateDry?.result?.id }
      );

      if (createdResultId) {
        const resultGet = expectOk(
          summary,
          "table.result.get",
          runFoundryctl([
            "table",
            "result",
            "get",
            "--table-id",
            createdTableId,
            "--result-id",
            createdResultId
          ])
        );
        markAndPush(
          summary,
          "table.result.get(full projection)",
          resultGet?.result?.id === createdResultId && resultGet?.result?.flags !== undefined,
          { id: resultGet?.result?.id }
        );

        const resultList = expectOk(
          summary,
          "table.result.list",
          runFoundryctl(["table", "result", "list", "--table-id", createdTableId])
        );
        const listedRow = (resultList?.results ?? []).find((row) => row.id === createdResultId) ?? null;
        markAndPush(
          summary,
          "table.result.list(per-table: row present, lean projection)",
          resultList?.tableId === createdTableId &&
            Boolean(listedRow) &&
            listedRow?.tableId === createdTableId &&
            listedRow?.flags === undefined &&
            listedRow?.description === undefined,
          { total: resultList?.total, row: listedRow }
        );

        const resultListAll = expectOk(
          summary,
          "table.result.list(cross-table)",
          runFoundryctl(["table", "result", "list", "--name", `Smoke Row ${stamp}`])
        );
        markAndPush(
          summary,
          "table.result.list(cross-table: no tableId echo, owning table per row)",
          resultListAll?.tableId === undefined &&
            (resultListAll?.results ?? []).some(
              (row) => row.id === createdResultId && row.tableId === createdTableId && Boolean(row.tableName)
            ),
          { tableId: resultListAll?.tableId, count: (resultListAll?.results ?? []).length }
        );

        const resultUpdate = expectOk(
          summary,
          "table.result.update",
          runFoundryctl([
            "table",
            "result",
            "update",
            "--table-id",
            createdTableId,
            "--result-id",
            createdResultId,
            "--name",
            `Smoke Row ${stamp} v2`,
            "--weight",
            "5",
            "--drawn",
            "true"
          ])
        );
        markAndPush(
          summary,
          "table.result.update(field round-trip)",
          resultUpdate?.result?.weight === 5 && resultUpdate?.result?.drawn === true,
          { weight: resultUpdate?.result?.weight, drawn: resultUpdate?.result?.drawn }
        );

        expectErr(
          summary,
          "table.result.update(empty patch rejected client-side)",
          runFoundryctl([
            "table",
            "result",
            "update",
            "--table-id",
            createdTableId,
            "--result-id",
            createdResultId,
            "--patch-json",
            "{}"
          ]),
          "INVALID_ARGUMENT"
        );

        const documentRow = expectOk(
          summary,
          "table.result.create(document row)",
          runFoundryctl([
            "table",
            "result",
            "create",
            "--table-id",
            createdTableId,
            "--range",
            "10,10",
            "--type",
            "document",
            "--document-uuid",
            `Actor.${actorId}`,
            "--name",
            `Smoke Doc Row ${stamp}`
          ])
        );
        const documentRowId = documentRow?.result?.id ?? null;
        if (documentRowId) {
          expectErr(
            summary,
            "table.result.update(clearing documentUuid on a document row)",
            runFoundryctl([
              "table",
              "result",
              "update",
              "--table-id",
              createdTableId,
              "--result-id",
              documentRowId,
              "--clear-document-uuid"
            ]),
            ERROR_CODES.INVALID_PARAMS
          );

          expectOk(
            summary,
            "table.result.update(re-stating type document with an existing uuid)",
            runFoundryctl([
              "table",
              "result",
              "update",
              "--table-id",
              createdTableId,
              "--result-id",
              documentRowId,
              "--type",
              "document",
              "--weight",
              "2"
            ])
          );
          expectOk(
            summary,
            "table.result.delete(document row)",
            runFoundryctl([
              "table",
              "result",
              "delete",
              "--table-id",
              createdTableId,
              "--result-id",
              documentRowId
            ])
          );
        }

        expectErr(
          summary,
          "table.result.update(text row flipped to document without a uuid)",
          runFoundryctl([
            "table",
            "result",
            "update",
            "--table-id",
            createdTableId,
            "--result-id",
            createdResultId,
            "--type",
            "document"
          ]),
          ERROR_CODES.INVALID_PARAMS
        );

        expectErr(
          summary,
          "table.result.update(descending range)",
          runFoundryctl([
            "table",
            "result",
            "update",
            "--table-id",
            createdTableId,
            "--result-id",
            createdResultId,
            "--range",
            "9,3"
          ]),
          ERROR_CODES.INVALID_PARAMS
        );

        const resultClone = expectOk(
          summary,
          "table.result.clone",
          runFoundryctl([
            "table",
            "result",
            "clone",
            "--table-id",
            createdTableId,
            "--result-id",
            createdResultId,
            "--range",
            "11,11",
            "--name",
            `Smoke Row Copy ${stamp}`
          ])
        );
        markAndPush(
          summary,
          "table.result.clone(fresh id + patch applied)",
          Boolean(resultClone?.result?.id) &&
            resultClone?.result?.id !== createdResultId &&
            resultClone?.result?.range?.[0] === 11,
          { id: resultClone?.result?.id, range: resultClone?.result?.range }
        );
        if (resultClone?.result?.id) {
          expectOk(
            summary,
            "table.result.delete(clone)",
            runFoundryctl([
              "table",
              "result",
              "delete",
              "--table-id",
              createdTableId,
              "--result-id",
              resultClone.result.id
            ])
          );
        }

        const resultDelete = expectOk(
          summary,
          "table.result.delete",
          runFoundryctl([
            "table",
            "result",
            "delete",
            "--table-id",
            createdTableId,
            "--result-id",
            createdResultId
          ])
        );
        markAndPush(
          summary,
          "table.result.delete(shape)",
          resultDelete?.tableId === createdTableId &&
            resultDelete?.id === createdResultId &&
            resultDelete?.deleted === true,
          { result: resultDelete }
        );

        expectErr(
          summary,
          "table.result.get(deleted row)",
          runFoundryctl([
            "table",
            "result",
            "get",
            "--table-id",
            createdTableId,
            "--result-id",
            createdResultId
          ]),
          ERROR_CODES.TABLE_RESULT_NOT_FOUND
        );
      }

      expectErr(
        summary,
        "table.result.get(missing row)",
        runFoundryctl([
          "table",
          "result",
          "get",
          "--table-id",
          createdTableId,
          "--result-id",
          createMissingId("result", stamp)
        ]),
        ERROR_CODES.TABLE_RESULT_NOT_FOUND
      );
      expectErr(
        summary,
        "table.result.list(missing table)",
        runFoundryctl(["table", "result", "list", "--table-id", createMissingId("table", `${stamp}-r`)]),
        ERROR_CODES.TABLE_NOT_FOUND
      );

      const drawKey = (suffix) => `smoke-draw-${stamp}-${suffix}`;

      const resetSeeded = expectOk(
        summary,
        "table.reset(seeded drawn row)",
        runFoundryctl(["table", "reset", "--table-id", createdTableId])
      );
      markAndPush(
        summary,
        "table.reset(changedCount counts the rows that WERE drawn, not every rewritten row)",
        resetSeeded?.reset === true &&
          resetSeeded?.changedCount === 1 &&
          (resetSeeded?.table?.results ?? []).length === 2 &&
          (resetSeeded?.table?.results ?? []).every((row) => row.drawn === false),
        {
          changedCount: resetSeeded?.changedCount,
          rows: (resetSeeded?.table?.results ?? []).map((row) => ({ id: row.id, drawn: row.drawn }))
        }
      );

      expectErr(
        summary,
        "table.draw(keyless refused client-side)",
        runFoundryctl(["table", "draw", "--table-id", createdTableId]),
        "MISSING_REQUIRED_OPTION"
      );

      const drawDry = expectOk(
        summary,
        "table.draw(dry-run)",
        runFoundryctl([
          "table",
          "draw",
          "--table-id",
          createdTableId,
          "--idempotency-key",
          drawKey("dry"),
          "--dry-run"
        ])
      );

      markAndPush(
        summary,
        "table.draw(dry-run rolls nothing, same keys, availability unchanged)",
        drawDry?.dryRun === true &&
          drawDry?.mutation === "not-executed" &&
          drawDry?.complete === true &&
          (drawDry?.results ?? []).length === 0 &&
          drawDry?.roll === null &&
          drawDry?.availableBefore === 2 &&
          drawDry?.availableAfter === 2 &&
          drawDry?.chatMessages?.status === "not-requested",
        {
          mutation: drawDry?.mutation,
          available: [drawDry?.availableBefore, drawDry?.availableAfter],
          chat: drawDry?.chatMessages
        }
      );

      const drawQuiet = expectOk(
        summary,
        "table.draw(--no-chat)",
        runFoundryctl([
          "table",
          "draw",
          "--table-id",
          createdTableId,
          "--idempotency-key",
          drawKey("quiet"),
          "--no-chat"
        ])
      );
      markAndPush(
        summary,
        "table.draw(--no-chat: one row drawn, no chat requested, replacement:false consumed it)",
        drawQuiet?.complete === true &&
          drawQuiet?.mutation === "committed" &&
          (drawQuiet?.results ?? []).length === 1 &&
          drawQuiet?.results?.[0]?.drawn === true &&
          drawQuiet?.results?.[0]?.tableId === createdTableId &&
          drawQuiet?.availableBefore === 2 &&
          drawQuiet?.availableAfter === 1 &&
          drawQuiet?.chatMessages?.status === "not-requested" &&
          (drawQuiet?.chatMessages?.ids ?? []).length === 0,
        {
          results: (drawQuiet?.results ?? []).map((row) => ({
            id: row.id,
            drawn: row.drawn,
            tableId: row.tableId
          })),
          available: [drawQuiet?.availableBefore, drawQuiet?.availableAfter],
          chat: drawQuiet?.chatMessages
        }
      );

      const afterDraw = expectOk(
        summary,
        "table.get(after draw)",
        runFoundryctl(["table", "get", "--table-id", createdTableId])
      );
      markAndPush(
        summary,
        "table.draw(drawn flag persisted on the row)",
        (afterDraw?.table?.results ?? []).filter((row) => row.drawn === true).length === 1,
        { drawn: (afterDraw?.table?.results ?? []).map((row) => ({ id: row.id, drawn: row.drawn })) }
      );

      const drawChat = expectOk(
        summary,
        "table.draw(with chat)",
        runFoundryctl([
          "table",
          "draw",
          "--table-id",
          createdTableId,
          "--idempotency-key",
          drawKey("chat"),
          "--roll-mode",
          "gm"
        ])
      );

      if (drawChat?.complete === true && drawChat?.chatMessages?.status === "captured") {
        for (const id of drawChat?.chatMessages?.ids ?? []) {
          created.messages.push(id);
        }
      }
      markAndPush(
        summary,
        "table.draw(chat captured: Foundry's own message, one id, complete)",
        drawChat?.complete === true &&
          drawChat?.mutation === "committed" &&
          drawChat?.chatMessages?.status === "captured" &&
          drawChat?.chatMessages?.expectedCount === 1 &&
          (drawChat?.chatMessages?.ids ?? []).length === 1 &&
          drawChat?.availableAfter === 0,
        { chat: drawChat?.chatMessages, available: [drawChat?.availableBefore, drawChat?.availableAfter] }
      );

      const drawnMessageId = drawChat?.chatMessages?.ids?.[0] ?? null;
      if (drawnMessageId) {
        const drawnMessage = expectOk(
          summary,
          "chat.get(draw message)",
          runFoundryctl(["chat", "get", "--message-id", drawnMessageId])
        );
        markAndPush(
          summary,
          "table.draw(--roll-mode gm landed as a GM whisper)",
          (drawnMessage?.message?.whisper ?? []).length > 0 && drawnMessage?.message?.blind === false,
          { whisper: drawnMessage?.message?.whisper, blind: drawnMessage?.message?.blind }
        );
      }

      const drawEmpty = expectOk(
        summary,
        "table.draw(exhausted)",
        runFoundryctl(["table", "draw", "--table-id", createdTableId, "--idempotency-key", drawKey("empty")])
      );
      markAndPush(
        summary,
        "table.draw(exhausted: empty results, nothing expected in chat, still complete)",
        drawEmpty?.complete === true &&
          (drawEmpty?.results ?? []).length === 0 &&
          drawEmpty?.availableBefore === 0 &&
          drawEmpty?.availableAfter === 0 &&
          drawEmpty?.chatMessages?.expectedCount === 0 &&
          (drawEmpty?.chatMessages?.ids ?? []).length === 0,
        { results: (drawEmpty?.results ?? []).length, chat: drawEmpty?.chatMessages }
      );

      const resetDry = expectOk(
        summary,
        "table.reset(dry-run)",
        runFoundryctl(["table", "reset", "--table-id", createdTableId, "--dry-run"])
      );
      markAndPush(
        summary,
        "table.reset(dry-run: merged post-state, nothing written)",
        resetDry?.dryRun === true &&
          resetDry?.reset === false &&
          resetDry?.changedCount === 2 &&
          (resetDry?.table?.results ?? []).every((row) => row.drawn === false),
        {
          changedCount: resetDry?.changedCount,
          drawn: (resetDry?.table?.results ?? []).map((row) => row.drawn)
        }
      );
      const stillDrawn = expectOk(
        summary,
        "table.get(after reset dry-run)",
        runFoundryctl(["table", "get", "--table-id", createdTableId])
      );
      markAndPush(
        summary,
        "table.reset(dry-run persisted nothing)",
        (stillDrawn?.table?.results ?? []).filter((row) => row.drawn === true).length === 2,
        { drawn: (stillDrawn?.table?.results ?? []).map((row) => row.drawn) }
      );

      const resetReal = expectOk(
        summary,
        "table.reset",
        runFoundryctl(["table", "reset", "--table-id", createdTableId])
      );
      markAndPush(
        summary,
        "table.reset(clears every drawn flag, changedCount = rows that WERE drawn)",
        resetReal?.reset === true &&
          resetReal?.changedCount === 2 &&
          (resetReal?.table?.results ?? []).every((row) => row.drawn === false),
        {
          changedCount: resetReal?.changedCount,
          drawn: (resetReal?.table?.results ?? []).map((row) => row.drawn)
        }
      );

      const resetAgain = expectOk(
        summary,
        "table.reset(idempotent)",
        runFoundryctl(["table", "reset", "--table-id", createdTableId])
      );
      markAndPush(
        summary,
        "table.reset(second reset reports changedCount 0)",
        resetAgain?.changedCount === 0,
        {
          changedCount: resetAgain?.changedCount
        }
      );

      const nestedCreate = expectOk(
        summary,
        "table.create(nested-table row)",
        runFoundryctl([
          "table",
          "create",
          "--name",
          `Smoke Nested Table ${stamp}`,
          "--formula",
          "1d2",
          "--replacement",
          "false",
          "--results-json",
          JSON.stringify([
            {
              name: "Inner table",
              type: "document",
              documentUuid: `RollTable.${createdTableId}`,
              range: [1, 1]
            },
            { name: "Plain row", range: [2, 2] }
          ])
        ])
      );
      const nestedTableId = nestedCreate?.table?.id ?? null;
      if (nestedTableId) {
        created.tables.push(nestedTableId);
        expectErr(
          summary,
          "table.draw(--count 2 refused on a nested-table row)",
          runFoundryctl([
            "table",
            "draw",
            "--table-id",
            nestedTableId,
            "--idempotency-key",
            drawKey("nested"),
            "--count",
            "2",
            "--no-chat"
          ]),
          ERROR_CODES.INVALID_PARAMS
        );

        expectErr(
          summary,
          "table.draw(--count 2 refused under dry-run too)",
          runFoundryctl([
            "table",
            "draw",
            "--table-id",
            nestedTableId,
            "--idempotency-key",
            drawKey("nested-dry"),
            "--count",
            "2",
            "--dry-run"
          ]),
          ERROR_CODES.INVALID_PARAMS
        );

        const nestedSingle = expectOk(
          summary,
          "table.draw(--count 1 on the nested table)",
          runFoundryctl([
            "table",
            "draw",
            "--table-id",
            nestedTableId,
            "--idempotency-key",
            drawKey("nested-single"),
            "--no-chat"
          ])
        );
        markAndPush(
          summary,
          "table.draw(recursive draw returns rows with their OWNING table id)",
          (nestedSingle?.results ?? []).length >= 1 &&
            (nestedSingle?.results ?? []).every(
              (row) => typeof row.tableId === "string" && row.tableId.length > 0
            ),
          { results: (nestedSingle?.results ?? []).map((row) => ({ id: row.id, tableId: row.tableId })) }
        );
        expectOk(
          summary,
          "table.draw(--count 2 --no-recursive on the nested table)",
          runFoundryctl([
            "table",
            "draw",
            "--table-id",
            nestedTableId,
            "--idempotency-key",
            drawKey("nested-norec"),
            "--count",
            "2",
            "--no-recursive",
            "--no-chat"
          ])
        );

        expectOk(
          summary,
          "table.reset(nested)",
          runFoundryctl(["table", "reset", "--table-id", nestedTableId])
        );
        expectOk(
          summary,
          "table.reset(inner after recursion)",
          runFoundryctl(["table", "reset", "--table-id", createdTableId])
        );
      }

      const sharedInner = expectOk(
        summary,
        "table.create(shared nested table for the queue check)",
        runFoundryctl([
          "table",
          "create",
          "--name",
          `Smoke Shared Inner ${stamp}`,
          "--formula",
          "1d1",
          "--replacement",
          "false",
          "--results-json",
          JSON.stringify([{ name: "Shared row", range: [1, 1] }])
        ])
      );
      const sharedInnerId = sharedInner?.table?.id ?? null;
      const sharedRowId = sharedInner?.table?.results?.[0]?.id ?? null;
      if (sharedInnerId) {
        created.tables.push(sharedInnerId);
      }

      const rootIds = [];
      for (const label of ["A", "B"]) {
        const root = expectOk(
          summary,
          `table.create(queue-check root ${label})`,
          runFoundryctl([
            "table",
            "create",
            "--name",
            `Smoke Queue Root ${label} ${stamp}`,
            "--formula",
            "1d1",
            "--replacement",
            "false",
            "--results-json",
            JSON.stringify([
              {
                name: "Shared inner table",
                type: "document",
                documentUuid: `RollTable.${sharedInnerId}`,
                range: [1, 1]
              }
            ])
          ])
        );
        const rootId = root?.table?.id ?? null;
        if (rootId) {
          created.tables.push(rootId);
          rootIds.push(rootId);
        }
      }

      if (sharedInnerId && sharedRowId && rootIds.length === 2) {
        const [concurrentA, concurrentB] = runFoundryctlPair(
          ["table", "draw", "--table-id", rootIds[0], "--idempotency-key", drawKey("queue-a"), "--no-chat"],
          ["table", "draw", "--table-id", rootIds[1], "--idempotency-key", drawKey("queue-b"), "--no-chat"]
        );
        const drawA = expectOk(summary, "table.draw(concurrent A)", concurrentA);
        const drawB = expectOk(summary, "table.draw(concurrent B)", concurrentB);
        const rowsA = drawA?.results ?? [];
        const rowsB = drawB?.results ?? [];
        const winners = [rowsA, rowsB].filter((rows) => rows.length === 1);
        const losers = [rowsA, rowsB].filter((rows) => rows.length === 0);
        markAndPush(
          summary,
          "table.draw(concurrent draws sharing a nested table: the shared row goes to exactly ONE of them)",
          winners.length === 1 &&
            losers.length === 1 &&
            winners[0][0]?.id === sharedRowId &&
            winners[0][0]?.tableId === sharedInnerId &&
            drawA?.complete === true &&
            drawB?.complete === true,
          {
            a: rowsA.map((row) => ({ id: row.id, tableId: row.tableId })),
            b: rowsB.map((row) => ({ id: row.id, tableId: row.tableId })),
            sharedRowId,
            complete: [drawA?.complete, drawB?.complete]
          }
        );

        const sharedAfter = expectOk(
          summary,
          "table.get(shared nested table after the concurrent draws)",
          runFoundryctl(["table", "get", "--table-id", sharedInnerId])
        );
        markAndPush(
          summary,
          "table.draw(the shared row is drawn once, and the world agrees)",
          (sharedAfter?.table?.results ?? []).length === 1 &&
            sharedAfter?.table?.results?.[0]?.id === sharedRowId &&
            sharedAfter?.table?.results?.[0]?.drawn === true,
          { rows: (sharedAfter?.table?.results ?? []).map((row) => ({ id: row.id, drawn: row.drawn })) }
        );
        const sharedList = expectOk(
          summary,
          "table.list(shared nested table drawnCount)",
          runFoundryctl(["table", "list", "--name", `Smoke Shared Inner ${stamp}`])
        );
        const sharedListed = (sharedList?.tables ?? []).find((row) => row.id === sharedInnerId) ?? null;
        markAndPush(
          summary,
          "table.list(drawnCount agrees with table.get's rows)",
          sharedListed?.resultCount === 1 && sharedListed?.drawnCount === 1,
          { resultCount: sharedListed?.resultCount, drawnCount: sharedListed?.drawnCount }
        );
      }
    }

    expectErr(
      summary,
      "table.get(missing)",
      runFoundryctl(["table", "get", "--table-id", createMissingId("table", stamp)]),
      ERROR_CODES.TABLE_NOT_FOUND
    );
    expectErr(
      summary,
      "table.get-many(missing)",
      runFoundryctl([
        "table",
        "get-many",
        "--ids",
        `${createdTableId ?? createMissingId("table", stamp)},${createMissingId("table", `${stamp}-x`)}`
      ]),
      ERROR_CODES.TABLE_NOT_FOUND
    );

    expectErr(
      summary,
      "table.create(result without range)",
      runFoundryctl([
        "table",
        "create",
        "--name",
        `Smoke Table Bad ${stamp}`,
        "--results-json",
        JSON.stringify([{ name: "No range" }])
      ]),
      ERROR_CODES.INVALID_PARAMS
    );

    expectErr(
      summary,
      "table.create(result range longer than two)",
      runFoundryctl([
        "table",
        "create",
        "--name",
        `Smoke Table Bad3 ${stamp}`,
        "--results-json",
        JSON.stringify([{ name: "Too long", range: [1, 2, 3] }])
      ]),
      ERROR_CODES.INVALID_PARAMS
    );

    expectErr(
      summary,
      "table.create(document result without documentUuid)",
      runFoundryctl([
        "table",
        "create",
        "--name",
        `Smoke Table Bad2 ${stamp}`,
        "--results-json",
        JSON.stringify([{ type: "document", name: "Dangling", range: [1, 1] }])
      ]),
      ERROR_CODES.INVALID_PARAMS
    );

    expectErr(
      summary,
      "table.create(document result with blank documentUuid)",
      runFoundryctl([
        "table",
        "create",
        "--name",
        `Smoke Table Bad4 ${stamp}`,
        "--results-json",
        JSON.stringify([{ type: "document", name: "Blank", range: [1, 1], documentUuid: "   " }])
      ]),
      ERROR_CODES.INVALID_PARAMS
    );

    expectErr(
      summary,
      "table.create(blank --img)",
      runFoundryctl(["table", "create", "--name", `Smoke Table Bad5 ${stamp}`, "--img", ""]),
      ERROR_CODES.INVALID_PARAMS
    );

    const cardsStampName = (label) => `Smoke Cards ${label} ${stamp}`;

    const cardsDeckCreate = expectOk(
      summary,
      "cards.create(deck with inline cards[])",
      runFoundryctl([
        "cards",
        "create",
        "--name",
        cardsStampName("Deck"),
        "--type",
        "deck",
        "--description",
        "<p>scratch deck</p>",
        "--display-count",
        "true",
        "--sort",
        "4",
        "--cards-json",
        JSON.stringify([
          { name: "Ace of Spades", suit: "S", value: 1, sort: 100 },
          { name: "King of Spades", suit: "S", value: 13, sort: 200 }
        ])
      ])
    );
    const cardsDeckId = cardsDeckCreate?.cards?.id ?? null;
    if (cardsDeckId) {
      created.cards.push(cardsDeckId);
    }
    markAndPush(
      summary,
      "cards.create(inline cards[]: ids re-minted, every card stored drawn:false)",
      Array.isArray(cardsDeckCreate?.cards?.cards) &&
        cardsDeckCreate.cards.cards.length === 2 &&
        cardsDeckCreate.cards.cards.every((card) => typeof card?.id === "string" && card.id.length > 0) &&
        cardsDeckCreate.cards.cards.every((card) => card?.drawn === false) &&
        !Object.prototype.hasOwnProperty.call(cardsDeckCreate.cards, "ownership"),
      {
        cardIds: (cardsDeckCreate?.cards?.cards ?? []).map((card) => card?.id),
        drawn: (cardsDeckCreate?.cards?.cards ?? []).map((card) => card?.drawn),
        hasOwnership: Object.prototype.hasOwnProperty.call(cardsDeckCreate?.cards ?? {}, "ownership")
      }
    );

    for (const [label, entry] of [
      ["drawn", { name: "Pre-drawn Card", drawn: true }],
      ["origin", { name: "Foreign Card", origin: cardsDeckId ?? "cardsOriginAAAA1" }]
    ]) {
      expectErr(
        summary,
        `cards.create(inline cards[] with \`${label}\` → INVALID_PARAMS: movement state is not authorable)`,
        runFoundryctl([
          "cards",
          "create",
          "--name",
          cardsStampName(`Bad ${label}`),
          "--type",
          "deck",
          "--cards-json",
          JSON.stringify([entry])
        ]),
        ERROR_CODES.INVALID_PARAMS
      );
    }

    for (const [target, args] of [
      [
        "cards.create",
        ["cards", "create", "--name", cardsStampName("Rot360"), "--type", "deck", "--rotation", "360"]
      ],
      [
        "cards.create(inline cards[])",
        [
          "cards",
          "create",
          "--name",
          cardsStampName("Rot360Inline"),
          "--type",
          "deck",
          "--cards-json",
          JSON.stringify([{ name: "Full Turn", rotation: 360 }])
        ]
      ]
    ]) {
      expectErr(
        summary,
        `${target}(--rotation 360 → INVALID_PARAMS: Foundry would store 0)`,
        runFoundryctl(args),
        ERROR_CODES.INVALID_PARAMS
      );
    }
    const cardsRotationFloat = expectOk(
      summary,
      "cards.create(--rotation 359.5 is still legal — the bound is exclusive, not 359)",
      runFoundryctl([
        "--dry-run",
        "cards",
        "create",
        "--name",
        cardsStampName("Rot3595"),
        "--type",
        "deck",
        "--rotation",
        "359.5"
      ])
    );
    markAndPush(
      summary,
      "cards.create(rotation 359.5 round-trips unchanged)",
      cardsRotationFloat?.cards?.rotation === 359.5,
      { rotation: cardsRotationFloat?.cards?.rotation }
    );

    const cardsCreateDry = expectOk(
      summary,
      "cards.create(dry-run)",
      runFoundryctl([
        "--dry-run",
        "cards",
        "create",
        "--name",
        cardsStampName("DryDeck"),
        "--type",
        "deck",
        "--cards-json",
        JSON.stringify([{ name: "Preview Card" }])
      ])
    );
    markAndPush(
      summary,
      "cards.create(dry-run nulls the stack AND card ids, persists nothing)",
      cardsCreateDry?.dryRun === true &&
        cardsCreateDry?.cards?.id === null &&
        Array.isArray(cardsCreateDry?.cards?.cards) &&
        cardsCreateDry.cards.cards.every((card) => card?.id === null && card?._id === null),
      {
        stackId: cardsCreateDry?.cards?.id,
        cardIds: (cardsCreateDry?.cards?.cards ?? []).map((card) => card?.id)
      }
    );

    const cardsHandCreate = expectOk(
      summary,
      "cards.create(hand)",
      runFoundryctl([
        "cards",
        "create",
        "--name",
        cardsStampName("Hand"),
        "--type",
        "hand",
        "--cards-json",
        JSON.stringify([{ name: "Hand Own Card", suit: "H", value: 7 }])
      ])
    );
    const cardsHandId = cardsHandCreate?.cards?.id ?? null;
    if (cardsHandId) {
      created.cards.push(cardsHandId);
    }

    if (cardsDeckId) {
      const cardsList = expectOk(
        summary,
        "cards.list",
        runFoundryctl(["cards", "list", "--name", `Smoke Cards Deck ${stamp}`])
      );
      const deckRow = findById(cardsList?.cards, cardsDeckId);
      markAndPush(
        summary,
        "cards.list row carries cardCount/drawnCount/availableCount and NO card bodies",
        Boolean(deckRow) &&
          deckRow.type === "deck" &&
          deckRow.cardCount === 2 &&
          deckRow.drawnCount === 0 &&
          deckRow.availableCount === 2 &&
          !Object.prototype.hasOwnProperty.call(deckRow, "cards"),
        { row: deckRow }
      );

      const cardsGet = expectOk(
        summary,
        "cards.get",
        runFoundryctl(["cards", "get", "--cards-id", cardsDeckId])
      );
      const firstCard = cardsGet?.cards?.cards?.[0] ?? null;
      markAndPush(
        summary,
        "cards.get carries ownership; card bodies carry neither img nor ownership",
        Boolean(cardsGet?.cards?.ownership) &&
          typeof cardsGet.cards.ownership === "object" &&
          Boolean(firstCard) &&
          !Object.prototype.hasOwnProperty.call(firstCard, "img") &&
          !Object.prototype.hasOwnProperty.call(firstCard, "ownership") &&
          typeof firstCard.name === "string" &&
          firstCard.name.length > 0,
        { ownership: cardsGet?.cards?.ownership, card: firstCard }
      );

      if (cardsHandId) {
        const cardsBatch = expectOk(
          summary,
          "cards.get-many",
          runFoundryctl(["cards", "get-many", "--ids", `${cardsHandId},${cardsDeckId}`])
        );
        markAndPush(
          summary,
          "cards.get-many preserves order and carries ownership per stack",
          Array.isArray(cardsBatch?.cards) &&
            cardsBatch.cards.length === 2 &&
            cardsBatch.cards[0]?.id === cardsHandId &&
            cardsBatch.cards[1]?.id === cardsDeckId &&
            cardsBatch.cards.every((stack) => Boolean(stack?.ownership)),
          { ids: (cardsBatch?.cards ?? []).map((stack) => stack?.id) }
        );
        expectErr(
          summary,
          "cards.get-many(atomic: one missing id fails the batch)",
          runFoundryctl(["cards", "get-many", "--ids", `${cardsDeckId},${createMissingId("cards", stamp)}`]),
          ERROR_CODES.CARDS_NOT_FOUND
        );
      }

      const cardsUpdate = expectOk(
        summary,
        "cards.update",
        runFoundryctl([
          "cards",
          "update",
          "--cards-id",
          cardsDeckId,
          "--name",
          cardsStampName("Deck Renamed"),
          "--rotation",
          "90"
        ])
      );
      markAndPush(
        summary,
        "cards.update round-trips the fields it wrote",
        cardsUpdate?.cards?.name === cardsStampName("Deck Renamed") && cardsUpdate?.cards?.rotation === 90,
        { name: cardsUpdate?.cards?.name, rotation: cardsUpdate?.cards?.rotation }
      );
      expectErr(
        summary,
        "cards.update(cards in patch → INVALID_PARAMS: fields-only)",
        runFoundryctl([
          "cards",
          "update",
          "--cards-id",
          cardsDeckId,
          "--patch-json",
          JSON.stringify({ cards: [] })
        ]),
        ERROR_CODES.INVALID_PARAMS
      );
      expectErr(
        summary,
        "cards.update(type in patch → INVALID_PARAMS: create-only)",
        runFoundryctl([
          "cards",
          "update",
          "--cards-id",
          cardsDeckId,
          "--patch-json",
          JSON.stringify({ type: "hand" })
        ]),
        ERROR_CODES.INVALID_PARAMS
      );

      expectErr(
        summary,
        "cards.update(blank --img → INVALID_PARAMS)",
        runFoundryctl(["cards", "update", "--cards-id", cardsDeckId, "--img", ""]),
        ERROR_CODES.INVALID_PARAMS
      );

      const cardsOwnership = expectOk(
        summary,
        "cards.ownership.set",
        runFoundryctl(["cards", "ownership", "set", "--cards-id", cardsDeckId, "--default", "2"])
      );
      markAndPush(
        summary,
        "cards.ownership.set returns the merged map",
        cardsOwnership?.cards?.ownership?.default === 2,
        { ownership: cardsOwnership?.cards?.ownership }
      );
      expectErr(
        summary,
        "cards.ownership.set(-1 INHERIT → INVALID_PARAMS: a stack has no parent)",
        runFoundryctl(["cards", "ownership", "set", "--cards-id", cardsDeckId, "--default", "-1"]),
        ERROR_CODES.INVALID_PARAMS
      );

      const cardsClone = expectOk(
        summary,
        "cards.clone",
        runFoundryctl(["cards", "clone", "--cards-id", cardsDeckId, "--name", cardsStampName("Deck Clone")])
      );
      if (cardsClone?.cards?.id) {
        created.cards.push(cardsClone.cards.id);
      }
      const sourceCardIds = new Set((cardsGet?.cards?.cards ?? []).map((card) => card?.id));
      markAndPush(
        summary,
        "cards.clone re-mints every card id, clears drawn, and reports cardsCopy",
        Array.isArray(cardsClone?.cards?.cards) &&
          cardsClone.cards.cards.length === 2 &&
          cardsClone.cards.cards.every((card) => !sourceCardIds.has(card?.id)) &&
          cardsClone.cards.cards.every((card) => card?.drawn === false) &&
          cardsClone?.cardsCopy?.count === 2 &&
          cardsClone.cardsCopy.idsReminted === true &&
          cardsClone.cardsCopy.unreturnableCards === 0,
        { cardsCopy: cardsClone?.cardsCopy, cloneCardIds: (cardsClone?.cards?.cards ?? []).map((c) => c?.id) }
      );

      const cardsDeleteDry = expectOk(
        summary,
        "cards.delete(dry-run enumerates the recall consequences)",
        runFoundryctl(["--dry-run", "cards", "delete", "--cards-id", cardsDeckId])
      );
      markAndPush(
        summary,
        "cards.delete(dry-run: deleted:false, recall not-executed, no chat requested)",
        cardsDeleteDry?.dryRun === true &&
          cardsDeleteDry?.deleted === false &&
          cardsDeleteDry?.recall?.status === "not-executed" &&
          cardsDeleteDry?.recall?.type === "deck" &&
          Array.isArray(cardsDeleteDry?.recall?.ownDrawnResetCardIds) &&
          cardsDeleteDry.recall.ownDrawnResetCardIds.length === 2 &&
          cardsDeleteDry.recall.ownDrawnResetCardIdsCount === 2 &&
          cardsDeleteDry.recall.ownDrawnResetCardIdsTruncated === false &&
          Array.isArray(cardsDeleteDry?.recall?.originRowsLeftDrawn) &&
          cardsDeleteDry.recall.originRowsLeftDrawn.length === 0 &&
          cardsDeleteDry.recall.originRowsLeftDrawnCount === 0 &&
          cardsDeleteDry?.chatNotification?.requested === false &&
          cardsDeleteDry.chatNotification.status === "not-requested",
        { recall: cardsDeleteDry?.recall, chatNotification: cardsDeleteDry?.chatNotification }
      );

      expectOk(
        summary,
        "cards.get(after delete dry-run: the stack survives)",
        runFoundryctl(["cards", "get", "--cards-id", cardsDeckId])
      );

      const cardCreateDry = expectOk(
        summary,
        "cards.card.create(dry-run)",
        runFoundryctl([
          "--dry-run",
          "cards",
          "card",
          "create",
          "--cards-id",
          cardsDeckId,
          "--name",
          "Smoke Preview Card",
          "--suit",
          "S",
          "--value",
          "11"
        ])
      );
      markAndPush(
        summary,
        "cards.card.create(dry-run mints NO id, persists nothing, invents no ownership)",
        cardCreateDry?.dryRun === true &&
          cardCreateDry?.cardsId === cardsDeckId &&
          cardCreateDry?.card?.id === null &&
          cardCreateDry?.card?._id === null &&
          cardCreateDry?.card?.drawn === false &&
          cardCreateDry?.card?.origin === null &&
          !Object.prototype.hasOwnProperty.call(cardCreateDry?.card ?? {}, "img") &&
          !Object.prototype.hasOwnProperty.call(cardCreateDry?.card ?? {}, "ownership"),
        { card: cardCreateDry?.card }
      );

      const cardCreate = expectOk(
        summary,
        "cards.card.create",
        runFoundryctl([
          "cards",
          "card",
          "create",
          "--cards-id",
          cardsDeckId,
          "--name",
          "Smoke Stored Ace",
          "--suit",
          "S",
          "--value",
          "1",
          "--face",
          "0",
          "--back-json",
          JSON.stringify({ name: "Smoke Back", text: "back text" }),
          "--faces-json",
          JSON.stringify([{ name: "Smoke Face One" }, { name: "Smoke Face Two" }]),
          "--sort",
          "500"
        ])
      );
      const smokeCardId = cardCreate?.card?.id ?? null;
      markAndPush(
        summary,
        "cards.card.create stores what was authored (drawn/origin are not authorable)",
        typeof smokeCardId === "string" &&
          smokeCardId.length > 0 &&
          cardCreate?.card?.name === "Smoke Stored Ace" &&
          cardCreate?.card?.value === 1 &&
          cardCreate?.card?.face === 0 &&
          Array.isArray(cardCreate?.card?.faces) &&
          cardCreate.card.faces.length === 2 &&
          cardCreate?.card?.drawn === false &&
          cardCreate?.card?.origin === null,
        { card: cardCreate?.card }
      );

      for (const [label, patch] of [
        ["drawn", { drawn: true }],
        ["origin", { origin: cardsDeckId }],
        ["img", { img: "worlds/x/card.webp" }]
      ]) {
        expectErr(
          summary,
          `cards.card.create(\`${label}\` → INVALID_PARAMS: not authorable through CRUD)`,
          runFoundryctl([
            "cards",
            "card",
            "create",
            "--cards-id",
            cardsDeckId,
            "--name",
            `Smoke Bad ${label}`,
            "--data-json",
            JSON.stringify(patch)
          ]),
          ERROR_CODES.INVALID_PARAMS
        );
      }

      if (smokeCardId) {
        const cardGet = expectOk(
          summary,
          "cards.card.get",
          runFoundryctl(["cards", "card", "get", "--cards-id", cardsDeckId, "--card-id", smokeCardId])
        );
        markAndPush(
          summary,
          "cards.card.get reads the STORED name, not Foundry's derived (face) name",
          cardGet?.cardsId === cardsDeckId &&
            cardGet?.card?.name === "Smoke Stored Ace" &&
            cardGet?.card?.back?.name === "Smoke Back" &&
            cardGet?.card?.back?.img === null &&
            !Object.prototype.hasOwnProperty.call(cardGet?.card ?? {}, "img") &&
            !Object.prototype.hasOwnProperty.call(cardGet?.card ?? {}, "ownership"),
          { card: cardGet?.card, deckImg: cardsDeckCreate?.cards?.img }
        );

        const cardList = expectOk(
          summary,
          "cards.card.list(per stack)",
          runFoundryctl(["cards", "card", "list", "--cards-id", cardsDeckId])
        );
        const listedCard = (cardList?.cards ?? []).find((row) => row?.id === smokeCardId);
        markAndPush(
          summary,
          "cards.card.list rows are lean and carry their owning cardsId",
          cardList?.cardsId === cardsDeckId &&
            !!listedCard &&
            listedCard.cardsId === cardsDeckId &&
            typeof listedCard.cardsName === "string" &&
            listedCard.name === "Smoke Stored Ace" &&
            listedCard.faceCount === 2 &&
            listedCard.drawn === false &&
            !Object.prototype.hasOwnProperty.call(listedCard, "back") &&
            !Object.prototype.hasOwnProperty.call(listedCard, "faces") &&
            !Object.prototype.hasOwnProperty.call(listedCard, "flags"),
          { row: listedCard, total: cardList?.total }
        );

        const cardListStored = expectOk(
          summary,
          "cards.card.list(--name matches the stored name)",
          runFoundryctl(["cards", "card", "list", "--cards-id", cardsDeckId, "--name", "Smoke Stored Ace"])
        );
        const cardListDerived = expectOk(
          summary,
          "cards.card.list(--name does NOT match the derived face name)",
          runFoundryctl(["cards", "card", "list", "--cards-id", cardsDeckId, "--name", "Smoke Face One"])
        );
        markAndPush(
          summary,
          "cards.card.list --name filters on the STORED name (both arms)",
          (cardListStored?.cards ?? []).some((row) => row?.id === smokeCardId) &&
            !(cardListDerived?.cards ?? []).some((row) => row?.id === smokeCardId),
          {
            stored: (cardListStored?.cards ?? []).map((row) => row?.id),
            derived: (cardListDerived?.cards ?? []).map((row) => row?.id)
          }
        );

        const cardListAll = expectOk(
          summary,
          "cards.card.list(all stacks)",
          runFoundryctl(["cards", "card", "list", "--name", "Smoke Stored Ace"])
        );
        markAndPush(
          summary,
          "cards.card.list without --cards-id omits the scope and names each row's stack",
          !Object.prototype.hasOwnProperty.call(cardListAll ?? {}, "cardsId") &&
            (cardListAll?.cards ?? []).some((row) => row?.id === smokeCardId && row?.cardsId === cardsDeckId),
          { rows: (cardListAll?.cards ?? []).map((row) => `${row?.cardsId}/${row?.id}`) }
        );

        const cardUpdateArgs = [
          "--cards-id",
          cardsDeckId,
          "--card-id",
          smokeCardId,
          "--back-json",
          JSON.stringify({ text: "merged text" }),
          "--faces-json",
          JSON.stringify([{ name: "Smoke Only Face" }]),
          "--clear-face"
        ];
        const cardUpdateDry = expectOk(
          summary,
          "cards.card.update(dry-run)",
          runFoundryctl(["--dry-run", "cards", "card", "update", ...cardUpdateArgs])
        );
        const cardBeforeUpdate = expectOk(
          summary,
          "cards.card.get(after the update dry-run)",
          runFoundryctl(["cards", "card", "get", "--cards-id", cardsDeckId, "--card-id", smokeCardId])
        );
        markAndPush(
          summary,
          "cards.card.update(dry-run previews the merged post-state and persists NOTHING)",
          cardUpdateDry?.dryRun === true &&
            cardUpdateDry?.cardsId === cardsDeckId &&
            cardUpdateDry?.card?.id === smokeCardId &&
            cardUpdateDry?.card?.back?.text === "merged text" &&
            Array.isArray(cardUpdateDry?.card?.faces) &&
            cardUpdateDry.card.faces.length === 1 &&
            cardUpdateDry?.card?.face === null &&
            cardBeforeUpdate?.card?.back?.text !== "merged text",
          { preview: cardUpdateDry?.card, stored: cardBeforeUpdate?.card }
        );
        const cardUpdate = expectOk(
          summary,
          "cards.card.update(partial back + replaced faces + flip to the back)",
          runFoundryctl(["cards", "card", "update", ...cardUpdateArgs])
        );

        markAndPush(
          summary,
          "cards.card.update(dry-run body === real body, modulo dryRun)",
          JSON.stringify(cardUpdate?.card) === JSON.stringify(cardUpdateDry?.card),
          { preview: cardUpdateDry?.card, real: cardUpdate?.card }
        );
        markAndPush(
          summary,
          "cards.card.update MERGES back (name survives) and REPLACES faces (one left), face → null",
          cardUpdate?.card?.back?.name === "Smoke Back" &&
            cardUpdate?.card?.back?.text === "merged text" &&
            Array.isArray(cardUpdate?.card?.faces) &&
            cardUpdate.card.faces.length === 1 &&
            cardUpdate.card.faces[0]?.name === "Smoke Only Face" &&
            cardUpdate?.card?.face === null,
          { back: cardUpdate?.card?.back, faces: cardUpdate?.card?.faces, face: cardUpdate?.card?.face }
        );

        expectErr(
          summary,
          "cards.card.update(dotted faces.0.name → INVALID_PARAMS)",
          runFoundryctl([
            "cards",
            "card",
            "update",
            "--cards-id",
            cardsDeckId,
            "--card-id",
            smokeCardId,
            "--patch-json",
            JSON.stringify({ "faces.0.name": "nope" })
          ]),
          ERROR_CODES.INVALID_PARAMS
        );
        expectErr(
          summary,
          "cards.card.update(face -1 → INVALID_PARAMS: Foundry would clamp it to face 0)",
          runFoundryctl([
            "cards",
            "card",
            "update",
            "--cards-id",
            cardsDeckId,
            "--card-id",
            smokeCardId,
            "--patch-json",
            JSON.stringify({ face: -1 })
          ]),
          ERROR_CODES.INVALID_PARAMS
        );

        const cardCloneArgs = [
          "--cards-id",
          cardsDeckId,
          "--card-id",
          smokeCardId,
          "--name",
          "Smoke Cloned Card"
        ];
        const cardsBeforeClone = expectOk(
          summary,
          "cards.card.list(before the clone dry-run)",
          runFoundryctl(["cards", "card", "list", "--cards-id", cardsDeckId])
        );
        const cardCloneDry = expectOk(
          summary,
          "cards.card.clone(dry-run)",
          runFoundryctl(["--dry-run", "cards", "card", "clone", ...cardCloneArgs])
        );
        const cardsAfterCloneDry = expectOk(
          summary,
          "cards.card.list(after the clone dry-run)",
          runFoundryctl(["cards", "card", "list", "--cards-id", cardsDeckId])
        );
        markAndPush(
          summary,
          "cards.card.clone(dry-run mints NO id, adds NO row, still reports recallDeletesCopy)",
          cardCloneDry?.dryRun === true &&
            cardCloneDry?.cardsId === cardsDeckId &&
            cardCloneDry?.card?.id === null &&
            cardCloneDry?.card?.name === "Smoke Cloned Card" &&
            cardCloneDry?.recallDeletesCopy === false &&
            cardsAfterCloneDry?.total === cardsBeforeClone?.total,
          { preview: cardCloneDry, before: cardsBeforeClone?.total, after: cardsAfterCloneDry?.total }
        );
        const cardClone = expectOk(
          summary,
          "cards.card.clone",
          runFoundryctl(["cards", "card", "clone", ...cardCloneArgs])
        );
        markAndPush(
          summary,
          "cards.card.clone mints a NEW id and copies drawn/origin verbatim",
          typeof cardClone?.card?.id === "string" &&
            cardClone.card.id !== smokeCardId &&
            cardClone?.card?.name === "Smoke Cloned Card" &&
            cardClone?.card?.drawn === false &&
            cardClone?.card?.origin === null,
          { clone: cardClone?.card }
        );

        const cloneVaries = new Set(["id", "_id", "sort"]);
        const cloneComparable = (card) =>
          JSON.stringify(
            Object.fromEntries(Object.entries(card ?? {}).filter(([key]) => !cloneVaries.has(key)))
          );
        markAndPush(
          summary,
          "cards.card.clone(dry-run body === real body, modulo the ids and sort a create assigns)",
          Object.keys(cardCloneDry?.card ?? {}).join(",") === Object.keys(cardClone?.card ?? {}).join(",") &&
            cloneComparable(cardCloneDry?.card) === cloneComparable(cardClone?.card) &&
            cardCloneDry?.recallDeletesCopy === cardClone?.recallDeletesCopy,
          { preview: cardCloneDry?.card, real: cardClone?.card }
        );

        const cardDeleteDry = expectOk(
          summary,
          "cards.card.delete(dry-run)",
          runFoundryctl([
            "--dry-run",
            "cards",
            "card",
            "delete",
            "--cards-id",
            cardsDeckId,
            "--card-id",
            smokeCardId
          ])
        );
        markAndPush(
          summary,
          "cards.card.delete(dry-run: deleted:false, nothing removed)",
          cardDeleteDry?.dryRun === true &&
            cardDeleteDry?.deleted === false &&
            cardDeleteDry?.cardsId === cardsDeckId &&
            cardDeleteDry?.id === smokeCardId,
          cardDeleteDry
        );
        const cardDelete = expectOk(
          summary,
          "cards.card.delete",
          runFoundryctl(["cards", "card", "delete", "--cards-id", cardsDeckId, "--card-id", smokeCardId])
        );
        markAndPush(
          summary,
          "cards.card.delete reports the removal",
          cardDelete?.deleted === true &&
            cardDelete?.id === smokeCardId &&
            cardDelete?.cardsId === cardsDeckId,
          cardDelete
        );
        expectErr(
          summary,
          "cards.card.get(deleted id → CARD_NOT_FOUND)",
          runFoundryctl(["cards", "card", "get", "--cards-id", cardsDeckId, "--card-id", smokeCardId]),
          ERROR_CODES.CARD_NOT_FOUND
        );

        expectErr(
          summary,
          "cards.card.get(bad cardsId → CARDS_NOT_FOUND, parent resolved first)",
          runFoundryctl([
            "cards",
            "card",
            "get",
            "--cards-id",
            createMissingId("cards", stamp),
            "--card-id",
            cardClone?.card?.id ?? smokeCardId
          ]),
          ERROR_CODES.CARDS_NOT_FOUND
        );
      }
    }

    const actionDeckCreate = expectOk(
      summary,
      "cards.create(action deck, 6 cards)",
      runFoundryctl([
        "cards",
        "create",
        "--name",
        cardsStampName("Action Deck"),
        "--type",
        "deck",
        "--cards-json",
        JSON.stringify(
          Array.from({ length: 6 }, (_, index) => ({
            name: `Action Card ${index + 1}`,
            suit: "S",
            value: index + 1
          }))
        )
      ])
    );
    const actionDeckId = actionDeckCreate?.cards?.id ?? null;
    if (actionDeckId) created.cards.push(actionDeckId);

    const actionHandCreate = expectOk(
      summary,
      "cards.create(action hand)",
      runFoundryctl(["cards", "create", "--name", cardsStampName("Action Hand"), "--type", "hand"])
    );
    const actionHandId = actionHandCreate?.cards?.id ?? null;
    if (actionHandId) created.cards.push(actionHandId);

    const actionPileCreate = expectOk(
      summary,
      "cards.create(action pile)",
      runFoundryctl(["cards", "create", "--name", cardsStampName("Action Pile"), "--type", "pile"])
    );
    const actionPileId = actionPileCreate?.cards?.id ?? null;
    if (actionPileId) created.cards.push(actionPileId);

    if (actionDeckId && actionHandId && actionPileId) {
      const actionKey = (label) => ["--idempotency-key", `smoke-cards-${label}-${stamp}`];
      const storedCardIds = (cardsId) => {
        const read = runFoundryctl(["cards", "get", "--cards-id", cardsId]);
        return (read?.response?.result?.cards?.cards ?? []).map((card) => card?.id).filter(Boolean);
      };
      const storedDrawnIds = (cardsId) => {
        const read = runFoundryctl(["cards", "get", "--cards-id", cardsId]);
        return (read?.response?.result?.cards?.cards ?? [])
          .filter((card) => card?.drawn === true)
          .map((card) => card?.id);
      };

      const shuffleDry = expectOk(
        summary,
        "cards.shuffle(dry-run)",
        runFoundryctl(["--dry-run", "cards", "shuffle", "--cards-id", actionDeckId])
      );
      markAndPush(
        summary,
        "cards.shuffle(dry-run: not-executed markers, nothing requested)",
        shuffleDry?.dryRun === true &&
          shuffleDry?.mutation === "not-executed" &&
          shuffleDry?.reconciliation === "not-executed" &&
          shuffleDry?.complete === true &&
          shuffleDry?.shuffle?.orderChanged === false &&
          shuffleDry?.chatNotification?.status === "not-requested",
        { shuffleDry }
      );
      const shuffled = expectOk(
        summary,
        "cards.shuffle(--no-chat)",
        runFoundryctl(["cards", "shuffle", "--cards-id", actionDeckId, "--no-chat"])
      );
      markAndPush(
        summary,
        "cards.shuffle reports a confirmed reconciliation and a 6-card stack",
        shuffled?.reconciliation === "confirmed" &&
          shuffled?.shuffle?.count === 6 &&
          shuffled?.chatNotification?.status === "not-requested" &&
          ["committed", "unknown"].includes(shuffled?.mutation),
        { shuffled }
      );

      const dealDry = expectOk(
        summary,
        "cards.deal(dry-run)",
        runFoundryctl([
          "--dry-run",
          "cards",
          "deal",
          "--cards-id",
          actionDeckId,
          "--to",
          `${actionHandId},${actionPileId}`,
          "--count",
          "2",
          ...actionKey("deal-dry")
        ])
      );
      markAndPush(
        summary,
        "cards.deal(dry-run: empty moved-lists, CURRENT counts, nothing moved)",
        dealDry?.dryRun === true &&
          dealDry?.mutation === "not-executed" &&
          dealDry?.from?.remaining === 6 &&
          Array.isArray(dealDry?.to) &&
          dealDry.to.length === 2 &&
          dealDry.to.every((entry) => entry?.expected === 2 && entry?.receivedCardIds?.length === 0) &&
          storedCardIds(actionHandId).length === 0,
        { dealDry, handCards: storedCardIds(actionHandId) }
      );

      const dealt = expectOk(
        summary,
        "cards.deal(2 cards to a hand AND a pile, --no-chat)",
        runFoundryctl([
          "cards",
          "deal",
          "--cards-id",
          actionDeckId,
          "--to",
          `${actionHandId},${actionPileId}`,
          "--count",
          "2",
          "--how",
          "top",
          "--no-chat",
          ...actionKey("deal")
        ])
      );
      const dealtToHand =
        (dealt?.to ?? []).find((entry) => entry?.cardsId === actionHandId)?.receivedCardIds ?? [];
      const dealtToPile =
        (dealt?.to ?? []).find((entry) => entry?.cardsId === actionPileId)?.receivedCardIds ?? [];
      const handStored = storedCardIds(actionHandId);
      const deckDrawn = storedDrawnIds(actionDeckId);
      markAndPush(
        summary,
        "cards.deal moved-card-id bookkeeping matches stored state, and the deck keeps the SAME ids flagged drawn",
        dealt?.mutation === "committed" &&
          dealt?.reconciliation === "confirmed" &&
          dealt?.complete === true &&
          dealtToHand.length === 2 &&
          dealtToPile.length === 2 &&
          dealt?.from?.remaining === 2 &&
          dealtToHand.every((id) => handStored.includes(id)) &&
          [...dealtToHand, ...dealtToPile].sort().join(",") ===
            [...(dealt?.from?.drawnCardIds ?? [])].sort().join(",") &&
          [...dealtToHand, ...dealtToPile].every((id) => deckDrawn.includes(id)),
        { dealtToHand, dealtToPile, handStored, deckDrawn, remaining: dealt?.from?.remaining }
      );

      const drawn = expectOk(
        summary,
        "cards.draw(--cards-id is the DESTINATION, --from the source)",
        runFoundryctl([
          "cards",
          "draw",
          "--cards-id",
          actionHandId,
          "--from",
          actionDeckId,
          "--count",
          "1",
          "--no-chat",
          ...actionKey("draw")
        ])
      );
      markAndPush(
        summary,
        "cards.draw reports the SOURCE under `from` and this stack under `to`",
        drawn?.cardsId === actionHandId &&
          drawn?.from?.cardsId === actionDeckId &&
          drawn?.from?.remaining === 1 &&
          (drawn?.to ?? []).length === 1 &&
          drawn.to[0]?.cardsId === actionHandId &&
          drawn.to[0]?.receivedCardIds?.length === 1 &&
          storedCardIds(actionHandId).length === 3,
        { drawn, handStored: storedCardIds(actionHandId) }
      );

      const passBackId = dealtToHand[0];

      const passDry = expectOk(
        summary,
        "cards.pass(dry-run: the FULL intent list, nothing written)",
        runFoundryctl([
          "cards",
          "pass",
          "--cards-id",
          actionHandId,
          "--to",
          actionDeckId,
          "--card-ids",
          passBackId,
          "--no-chat",
          "--dry-run",
          ...actionKey("pass-dry")
        ])
      );
      markAndPush(
        summary,
        "cards.pass dry run forecasts returnedCardIds / removedCardIds and persists nothing",
        passDry?.dryRun === true &&
          passDry?.mutation === "not-executed" &&
          (passDry?.to ?? [])[0]?.returnedCardIds?.join(",") === passBackId &&
          (passDry?.to ?? [])[0]?.receivedCardIds?.length === 0 &&
          passDry?.from?.removedCardIds?.join(",") === passBackId &&
          storedCardIds(actionHandId).includes(passBackId) &&
          storedDrawnIds(actionDeckId).includes(passBackId),
        { passDry, handCards: storedCardIds(actionHandId) }
      );

      const passed = expectOk(
        summary,
        "cards.pass(a dealt card back to its origin deck)",
        runFoundryctl([
          "cards",
          "pass",
          "--cards-id",
          actionHandId,
          "--to",
          actionDeckId,
          "--card-ids",
          passBackId,
          "--no-chat",
          ...actionKey("pass")
        ])
      );
      markAndPush(
        summary,
        "cards.pass return-to-origin reports returnedCardIds (no new row) and clears the deck's drawn flag",
        passed?.mutation === "committed" &&
          (passed?.to ?? [])[0]?.returnedCardIds?.join(",") === passBackId &&
          (passed?.to ?? [])[0]?.receivedCardIds?.length === 0 &&
          passed?.from?.removedCardIds?.join(",") === passBackId &&
          !storedCardIds(actionHandId).includes(passBackId) &&
          !storedDrawnIds(actionDeckId).includes(passBackId),
        { passed, deckDrawnAfter: storedDrawnIds(actionDeckId) }
      );

      const movementShape = (body) => {
        const sortIds = (entry) => {
          const sorted = { ...(entry ?? {}) };

          for (const key of [
            "receivedCardIds",
            "returnedCardIds",
            "indeterminateCardIds",
            "removedCardIds",
            "drawnCardIds"
          ]) {
            if (Array.isArray(sorted[key])) sorted[key] = [...sorted[key]].sort();
          }
          return sorted;
        };
        return JSON.stringify({
          from: sortIds(body?.from),
          to: (body?.to ?? []).map(sortIds)
        });
      };
      markAndPush(
        summary,
        "cards.pass FORECAST === OUTCOME (the dry run's from/to ids are exactly what the real call reported)",
        movementShape(passDry) === movementShape(passed),
        {
          forecast: { from: passDry?.from ?? null, to: passDry?.to ?? null },
          outcome: { from: passed?.from ?? null, to: passed?.to ?? null }
        }
      );

      const resetDry = expectOk(
        summary,
        "cards.reset(dry-run)",
        runFoundryctl(["--dry-run", "cards", "reset", "--cards-id", actionDeckId])
      );
      markAndPush(
        summary,
        "cards.reset(dry-run enumerates the reclaim, calls nothing, and carries NO delete-consequence lists)",
        resetDry?.dryRun === true &&
          resetDry?.mutation === "not-executed" &&
          resetDry?.recall?.status === "not-executed" &&
          resetDry?.recall?.type === "deck" &&
          (resetDry?.recall?.reclaimed ?? []).length > 0 &&
          !Object.prototype.hasOwnProperty.call(resetDry?.recall ?? {}, "danglingOriginsLeft") &&
          !Object.prototype.hasOwnProperty.call(resetDry?.recall ?? {}, "deleteConsequences") &&
          storedCardIds(actionHandId).length === 2,
        { resetDry, handStored: storedCardIds(actionHandId) }
      );

      const reset = expectOk(
        summary,
        "cards.reset(deck recall, --no-chat)",
        runFoundryctl(["cards", "reset", "--cards-id", actionDeckId, "--no-chat"])
      );
      markAndPush(
        summary,
        "cards.reset pulled every dealt card back and cleared the deck's drawn flags (the DELTA, not a successful re-read)",
        reset?.mutation === "committed" &&
          reset?.recall?.status === "confirmed" &&
          reset?.complete === true &&
          storedCardIds(actionHandId).length === 0 &&
          storedCardIds(actionPileId).length === 0 &&
          storedDrawnIds(actionDeckId).length === 0 &&
          storedCardIds(actionDeckId).length === 6,
        {
          reset,
          hand: storedCardIds(actionHandId),
          pile: storedCardIds(actionPileId),
          deckDrawn: storedDrawnIds(actionDeckId)
        }
      );

      const collideDeal = expectOk(
        summary,
        "cards.deal(one card to the hand, to set up the deal-back collision)",
        runFoundryctl([
          "cards",
          "deal",
          "--cards-id",
          actionDeckId,
          "--to",
          actionHandId,
          "--count",
          "1",
          "--how",
          "top",
          "--no-chat",
          ...actionKey("collide-setup")
        ])
      );
      const collideCardId = (collideDeal?.to ?? [])[0]?.receivedCardIds?.[0] ?? null;
      const collideRun = runFoundryctl([
        "cards",
        "deal",
        "--cards-id",
        actionHandId,
        "--to",
        actionDeckId,
        ...actionKey("collide")
      ]);
      expectErr(
        summary,
        "cards.deal(dealt cards back to their ORIGIN deck → INVALID_PARAMS, the unavoidable _id collision)",
        collideRun,
        ERROR_CODES.INVALID_PARAMS
      );
      const collideRefusal = collideRun.response?.error ?? null;
      markAndPush(
        summary,
        "the deal-back refusal names the colliding card and the pass/draw remedy, and nothing moved",
        (collideRefusal?.details?.collidingCardIds ?? []).includes(collideCardId) &&
          /cards pass/.test(collideRefusal?.message ?? "") &&
          storedCardIds(actionHandId).includes(collideCardId) &&
          storedDrawnIds(actionDeckId).includes(collideCardId),
        { collideCardId, collideRefusal, hand: storedCardIds(actionHandId) }
      );

      const collideReturn = !collideCardId
        ? null
        : expectOk(
            summary,
            "cards.pass(the SAME card back to its origin — the documented remedy for the refusal above)",
            runFoundryctl([
              "cards",
              "pass",
              "--cards-id",
              actionHandId,
              "--to",
              actionDeckId,
              "--card-ids",
              collideCardId,
              "--no-chat",
              ...actionKey("collide-fix")
            ])
          );
      markAndPush(
        summary,
        "the remedy returned the card with NO new row (returnedCardIds) and the deck's flag cleared",
        Boolean(collideCardId) &&
          (collideReturn?.to ?? [])[0]?.returnedCardIds?.join(",") === collideCardId &&
          !storedCardIds(actionHandId).includes(collideCardId) &&
          !storedDrawnIds(actionDeckId).includes(collideCardId),
        { collideReturn, hand: storedCardIds(actionHandId), deckDrawn: storedDrawnIds(actionDeckId) }
      );

      const copyDeckCreate = expectOk(
        summary,
        "cards.create(second deck, for the copy branch and the pass collision)",
        runFoundryctl(["cards", "create", "--name", cardsStampName("Action Deck 2"), "--type", "deck"])
      );
      const copyDeckId = copyDeckCreate?.cards?.id ?? null;
      if (copyDeckId) created.cards.push(copyDeckId);

      const copyDeckDrawn = new Set(storedDrawnIds(actionDeckId));
      const copySeedId = storedCardIds(actionDeckId).find((cardId) => !copyDeckDrawn.has(cardId)) ?? null;
      if (copyDeckId && copySeedId) {
        const copied = expectOk(
          summary,
          "cards.pass(a HOME deck card into another DECK — Foundry's copy branch, not a move)",
          runFoundryctl([
            "cards",
            "pass",
            "--cards-id",
            actionDeckId,
            "--to",
            copyDeckId,
            "--card-ids",
            copySeedId,
            "--no-chat",
            ...actionKey("copy")
          ])
        );
        markAndPush(
          summary,
          "the copy landed in the second deck while the SOURCE was not written at all (row kept, still available)",
          (copied?.to ?? [])[0]?.receivedCardIds?.join(",") === copySeedId &&
            (copied?.from?.removedCardIds ?? []).length === 0 &&
            (copied?.from?.drawnCardIds ?? []).length === 0 &&
            storedCardIds(actionDeckId).includes(copySeedId) &&
            !storedDrawnIds(actionDeckId).includes(copySeedId) &&
            storedCardIds(copyDeckId).includes(copySeedId),
          { copied, source: storedCardIds(actionDeckId), target: storedCardIds(copyDeckId) }
        );
        const passCollideRun = runFoundryctl([
          "cards",
          "pass",
          "--cards-id",
          actionDeckId,
          "--to",
          copyDeckId,
          "--card-ids",
          copySeedId,
          "--no-chat",
          ...actionKey("copy-again")
        ]);
        expectErr(
          summary,
          "cards.pass(re-seeding the same card → INVALID_PARAMS, the destination already holds that _id)",
          passCollideRun,
          ERROR_CODES.INVALID_PARAMS
        );
        const passCollideRefusal = passCollideRun.response?.error ?? null;
        markAndPush(
          summary,
          "the pass refusal names the colliding id, says the copy-branch failure would be CLEAN, and nothing moved",
          (passCollideRefusal?.details?.collidingCardIds ?? []).includes(copySeedId) &&
            /copy-into-a-deck branch/.test(passCollideRefusal?.message ?? "") &&
            /would be clean/.test(passCollideRefusal?.message ?? "") &&
            storedCardIds(copyDeckId).length === 1 &&
            !storedDrawnIds(actionDeckId).includes(copySeedId),
          { passCollideRefusal, target: storedCardIds(copyDeckId), sourceDrawn: storedDrawnIds(actionDeckId) }
        );

        expectErr(
          summary,
          "cards.pass(the same collision under --dry-run → still INVALID_PARAMS)",
          runFoundryctl([
            "--dry-run",
            "cards",
            "pass",
            "--cards-id",
            actionDeckId,
            "--to",
            copyDeckId,
            "--card-ids",
            copySeedId,
            "--no-chat",
            ...actionKey("copy-again-dry")
          ]),
          ERROR_CODES.INVALID_PARAMS
        );
      }

      expectErr(
        summary,
        "cards.deal(more than the deck has available → INSUFFICIENT_CARDS)",
        runFoundryctl([
          "cards",
          "deal",
          "--cards-id",
          actionDeckId,
          "--to",
          actionHandId,
          "--count",
          "99",
          ...actionKey("short")
        ]),
        ERROR_CODES.INSUFFICIENT_CARDS
      );
      expectErr(
        summary,
        "cards.deal(self-target → INVALID_PARAMS)",
        runFoundryctl([
          "cards",
          "deal",
          "--cards-id",
          actionDeckId,
          "--to",
          actionDeckId,
          ...actionKey("self")
        ]),
        ERROR_CODES.INVALID_PARAMS
      );
      expectErr(
        summary,
        "cards.deal(duplicate destination → INVALID_PARAMS)",
        runFoundryctl([
          "cards",
          "deal",
          "--cards-id",
          actionDeckId,
          "--to",
          `${actionHandId},${actionHandId}`,
          ...actionKey("dupe")
        ]),
        ERROR_CODES.INVALID_PARAMS
      );
      expectErr(
        summary,
        "cards.draw(missing source → CARDS_NOT_FOUND)",
        runFoundryctl([
          "cards",
          "draw",
          "--cards-id",
          actionHandId,
          "--from",
          createMissingId("cards", stamp),
          ...actionKey("badsrc")
        ]),
        ERROR_CODES.CARDS_NOT_FOUND
      );
      expectErr(
        summary,
        "cards.pass(unknown card id → CARD_NOT_FOUND)",
        runFoundryctl([
          "cards",
          "pass",
          "--cards-id",
          actionDeckId,
          "--to",
          actionHandId,
          "--card-ids",
          createMissingId("card", stamp),
          ...actionKey("badcard")
        ]),
        ERROR_CODES.CARD_NOT_FOUND
      );

      const zeroCount = runFoundryctl([
        "cards",
        "draw",
        "--cards-id",
        actionHandId,
        "--from",
        actionDeckId,
        "--count",
        "0",
        ...actionKey("zero")
      ]);
      markAndPush(
        summary,
        "cards.draw --count 0 is REFUSED (slice(-0) would move the whole available stack)",
        !zeroCount.response?.ok || zeroCount.status !== 0,
        { status: zeroCount.status, error: zeroCount.response?.error ?? null }
      );

      const chatIdsBeforeAction = new Set(
        (runFoundryctl(["chat", "list", "--limit", "50"])?.response?.result?.messages ?? [])
          .map((row) => row?.id)
          .filter(Boolean)
      );
      const chatShuffle = expectOk(
        summary,
        "cards.shuffle(chat ON — the one non-deterministic step)",
        runFoundryctl(["cards", "shuffle", "--cards-id", actionDeckId])
      );
      markAndPush(
        summary,
        "cards.shuffle(chat ON) reports dispatched",
        chatShuffle?.chatNotification?.requested === true &&
          chatShuffle?.chatNotification?.status === "dispatched",
        { chatNotification: chatShuffle?.chatNotification ?? null }
      );
      const actionNotificationIds = [];

      for (let attempt = 0; attempt < 8 && actionNotificationIds.length === 0; attempt += 1) {
        sleepMs(500);
        const rows = runFoundryctl(["chat", "list", "--limit", "50"])?.response?.result?.messages ?? [];
        for (const row of rows) {
          if (!row?.id || chatIdsBeforeAction.has(row.id) || actionNotificationIds.includes(row.id)) continue;
          if (typeof row?.contentPreview !== "string" || !row.contentPreview.includes("cards-notification"))
            continue;
          const full = runFoundryctl(["chat", "get", "--message-id", row.id]);
          const content = full?.response?.result?.message?.content;
          if (typeof content === "string" && content.includes(stamp)) {
            actionNotificationIds.push(row.id);
            created.messages.push(row.id);
          }
        }
      }
      markAndPush(
        summary,
        "cards action verb chat notification located by the run marker and queued for cleanup",
        actionNotificationIds.length > 0,
        { actionNotificationIds }
      );
      summary.notes.push(
        `cards action verbs: the chat-on step posted ${actionNotificationIds.length} notification(s), located by this run's marker and queued for deletion. Foundry's notification carries NO id and NO flag the bridge can correlate on (#postChatNotification is private, takes no options and sets no flags), and its AUDIENCE follows the GM client's own chat-sidebar setting on both cores — the bridge can neither set nor report it, which is why there is no --roll-mode on cards.* and why every other action step in this run uses --no-chat.`
      );
      summary.notes.push(
        `cards.shuffle reported mutation="${shuffled?.mutation ?? "?"}" on the --no-chat run. "unknown" is legitimate and not a failure: Foundry's embedded update runs with diff:true, so a shuffle whose random permutation reproduces the existing order writes nothing and is indistinguishable from a refused batch by ANY observation.`
      );
    }

    const missingCardsId = createMissingId("cards", stamp);
    expectErr(
      summary,
      "cards.get(missing → CARDS_NOT_FOUND)",
      runFoundryctl(["cards", "get", "--cards-id", missingCardsId]),
      ERROR_CODES.CARDS_NOT_FOUND
    );
    expectErr(
      summary,
      "cards.update(missing → CARDS_NOT_FOUND)",
      runFoundryctl(["cards", "update", "--cards-id", missingCardsId, "--name", "X"]),
      ERROR_CODES.CARDS_NOT_FOUND
    );
    expectErr(
      summary,
      "cards.delete(missing → CARDS_NOT_FOUND)",
      runFoundryctl(["cards", "delete", "--cards-id", missingCardsId]),
      ERROR_CODES.CARDS_NOT_FOUND
    );

    const combatCreate = expectOk(
      summary,
      "combat.create",
      runFoundryctl(
        createdSceneId
          ? ["combat", "create", "--scene", createdSceneId, "--sort", "3"]
          : ["combat", "create", "--sort", "3"]
      )
    );
    const createdCombatId = combatCreate?.combat?.id ?? null;

    const bareCombatCreate = expectOk(
      summary,
      "combat.create(no fields)",
      runFoundryctl(["combat", "create"])
    );
    if (bareCombatCreate?.combat?.id) {
      created.combats.push(bareCombatCreate.combat.id);
    }

    const combatCreateDry = expectOk(
      summary,
      "combat.create(dry-run)",
      runFoundryctl(["--dry-run", "combat", "create", "--sort", "7"])
    );
    markAndPush(
      summary,
      "combat.create(dry-run nulls the id, persists nothing)",
      combatCreateDry?.dryRun === true &&
        combatCreateDry?.combat?.id === null &&
        combatCreateDry?.combat?._id === null &&
        combatCreateDry?.combat?.sort === 7,
      {
        dryRun: combatCreateDry?.dryRun,
        id: combatCreateDry?.combat?.id,
        sort: combatCreateDry?.combat?.sort
      }
    );
    if (createdCombatId) {
      created.combats.push(createdCombatId);
      markAndPush(
        summary,
        "combat.create(unstarted, empty, scene linked, no ownership/folder key)",
        combatCreate?.combat?.scene === (createdSceneId ?? null) &&
          combatCreate?.combat?.active === false &&
          combatCreate?.combat?.round === 0 &&
          combatCreate?.combat?.turn === null &&
          combatCreate?.combat?.started === false &&
          combatCreate?.combat?.combatantCount === 0 &&
          combatCreate?.combat?.groupCount === 0 &&
          Array.isArray(combatCreate?.combat?.turns) &&
          combatCreate.combat.turns.length === 0 &&
          combatCreate?.combat?.ownership === undefined &&
          combatCreate?.combat?.folder === undefined,
        {
          scene: combatCreate?.combat?.scene,
          active: combatCreate?.combat?.active,
          round: combatCreate?.combat?.round,
          turn: combatCreate?.combat?.turn,
          combatantCount: combatCreate?.combat?.combatantCount,
          hasOwnership: combatCreate?.combat?.ownership !== undefined,
          hasFolder: combatCreate?.combat?.folder !== undefined
        }
      );
      expectOk(summary, "combat.list", runFoundryctl(["combat", "list"]));
      const combatGet = expectOk(
        summary,
        "combat.get",
        runFoundryctl(["combat", "get", "--combat-id", createdCombatId])
      );
      markAndPush(
        summary,
        "combat.get(full projection: turn order + counts + derived reads)",
        combatGet?.combat?.id === createdCombatId &&
          typeof combatGet?.combat?.started === "boolean" &&
          combatGet?.combat?.currentCombatantId === null &&
          combatGet?.combat?.combatantCount === 0 &&
          combatGet?.combat?.groupCount === 0 &&
          combatGet?.combat?.scene === (createdSceneId ?? null),
        {
          started: combatGet?.combat?.started,
          currentCombatantId: combatGet?.combat?.currentCombatantId,
          scene: combatGet?.combat?.scene,
          sceneType: typeof combatGet?.combat?.scene
        }
      );
      const combatUpdate = expectOk(
        summary,
        "combat.update",
        runFoundryctl([
          "combat",
          "update",
          "--combat-id",
          createdCombatId,
          "--sort",
          "9",
          "--patch-json",
          JSON.stringify({ flags: { "fvtt-world-cli": { smoke: stamp } } })
        ])
      );
      markAndPush(
        summary,
        "combat.update(field round-trip)",
        combatUpdate?.combat?.sort === 9 && combatUpdate?.combat?.flags?.["fvtt-world-cli"]?.smoke === stamp,
        { sort: combatUpdate?.combat?.sort, flags: combatUpdate?.combat?.flags }
      );

      if (createdSceneId) {
        const combatUnlink = expectOk(
          summary,
          "combat.update(--clear-scene unlinks)",
          runFoundryctl(["combat", "update", "--combat-id", createdCombatId, "--clear-scene"])
        );
        markAndPush(summary, "combat.update(scene null after unlink)", combatUnlink?.combat?.scene === null, {
          scene: combatUnlink?.combat?.scene
        });

        const paddedScene = expectOk(
          summary,
          "combat.update(re-link scene with a padded id — cleaned, not rejected)",
          runFoundryctl([
            "combat",
            "update",
            "--combat-id",
            createdCombatId,
            "--scene",
            `  ${createdSceneId}  `
          ])
        );
        markAndPush(
          summary,
          "combat.update(padded scene id re-links and is stored TRIMMED)",
          paddedScene?.combat?.scene === createdSceneId,
          { scene: paddedScene?.combat?.scene, sent: `  ${createdSceneId}  ` }
        );
      }

      const combatUpdateDry = expectOk(
        summary,
        "combat.update(dry-run)",
        runFoundryctl(["--dry-run", "combat", "update", "--combat-id", createdCombatId, "--sort", "99"])
      );
      const combatAfterDry = expectOk(
        summary,
        "combat.get(after update dry-run)",
        runFoundryctl(["combat", "get", "--combat-id", createdCombatId])
      );
      markAndPush(
        summary,
        "combat.update(dry-run previews without persisting, same key set as the real call)",
        combatUpdateDry?.dryRun === true &&
          combatUpdateDry?.combat?.sort === 99 &&
          combatAfterDry?.combat?.sort === 9 &&
          JSON.stringify(Object.keys(combatUpdateDry?.combat ?? {}).sort()) ===
            JSON.stringify(Object.keys(combatAfterDry?.combat ?? {}).sort()),
        { previewSort: combatUpdateDry?.combat?.sort, storedSort: combatAfterDry?.combat?.sort }
      );

      if (isV14) {
        const namedCombat = expectOk(
          summary,
          "combat.update(v14: --name accepted)",
          runFoundryctl([
            "combat",
            "update",
            "--combat-id",
            createdCombatId,
            "--name",
            `Smoke Encounter ${stamp}`
          ])
        );
        markAndPush(
          summary,
          "combat.update(v14: name round-trip)",
          namedCombat?.combat?.name === `Smoke Encounter ${stamp}`,
          {
            name: namedCombat?.combat?.name
          }
        );
      } else {
        expectErr(
          summary,
          "combat.update(v13: --name rejected, never silently dropped)",
          runFoundryctl([
            "combat",
            "update",
            "--combat-id",
            createdCombatId,
            "--name",
            `Smoke Encounter ${stamp}`
          ]),
          ERROR_CODES.INVALID_PARAMS
        );
        expectErr(
          summary,
          "combat.create(v13: --name rejected)",
          runFoundryctl(["combat", "create", "--name", `Smoke Encounter Bad ${stamp}`]),
          ERROR_CODES.INVALID_PARAMS
        );

        const v13Read = expectOk(
          summary,
          "combat.get(v13 name is null)",
          runFoundryctl(["combat", "get", "--combat-id", createdCombatId])
        );
        markAndPush(summary, "combat.get(v13: name null, not empty string)", v13Read?.combat?.name === null, {
          name: v13Read?.combat?.name
        });
      }

      for (const [label, argv] of [
        [
          "active",
          [
            "combat",
            "update",
            "--combat-id",
            createdCombatId,
            "--patch-json",
            JSON.stringify({ active: true })
          ]
        ],
        [
          "round",
          ["combat", "update", "--combat-id", createdCombatId, "--patch-json", JSON.stringify({ round: 5 })]
        ],
        [
          "turn",
          ["combat", "update", "--combat-id", createdCombatId, "--patch-json", JSON.stringify({ turn: 0 })]
        ],
        ["combatants", ["combat", "create", "--data-json", JSON.stringify({ combatants: [] })]],
        [
          "type on patch",
          [
            "combat",
            "update",
            "--combat-id",
            createdCombatId,
            "--patch-json",
            JSON.stringify({ type: "base" })
          ]
        ],
        ["ownership", ["combat", "create", "--data-json", JSON.stringify({ ownership: { default: 2 } })]],
        ["folder", ["combat", "create", "--data-json", JSON.stringify({ folder: null })]],

        ["a blank scene on update", ["combat", "update", "--combat-id", createdCombatId, "--scene", "   "]],
        ["a blank scene on create", ["combat", "create", "--scene", "\t"]]
      ]) {
        expectErr(summary, `combat write rejects ${label}`, runFoundryctl(argv), ERROR_CODES.INVALID_PARAMS);
      }
      expectErr(
        summary,
        "combat.get(unknown id)",
        runFoundryctl(["combat", "get", "--combat-id", `missing-${stamp}`]),
        ERROR_CODES.COMBAT_NOT_FOUND
      );

      const combatantCreate = expectOk(
        summary,
        "combat.combatant.create",
        runFoundryctl([
          "combat",
          "combatant",
          "create",
          "--combat-id",
          createdCombatId,
          "--name",
          `Smoke Combatant ${stamp}`,
          "--initiative",
          "7"
        ])
      );
      const createdCombatantId = combatantCreate?.combatant?.id ?? null;
      markAndPush(
        summary,
        "combat.combatant.create(row + re-read PARENT summary + unlink flag)",
        Boolean(createdCombatantId) &&
          combatantCreate?.combatant?.name === `Smoke Combatant ${stamp}` &&
          combatantCreate?.combatant?.initiative === 7 &&
          combatantCreate?.combatant?.combatId === createdCombatId &&
          combatantCreate?.combat?.id === createdCombatId &&
          combatantCreate?.combat?.combatantCount === 1 &&
          combatantCreate?.combatSceneUnlinked === false,
        {
          combatantId: createdCombatantId,
          initiative: combatantCreate?.combatant?.initiative,
          parentCount: combatantCreate?.combat?.combatantCount,
          unlinked: combatantCreate?.combatSceneUnlinked
        }
      );
      if (createdCombatantId) {
        const combatantList = expectOk(
          summary,
          "combat.combatant.list",
          runFoundryctl(["combat", "combatant", "list", "--combat-id", createdCombatId])
        );
        const combatWithRows = expectOk(
          summary,
          "combat.get(after combatant create)",
          runFoundryctl(["combat", "get", "--combat-id", createdCombatId])
        );
        markAndPush(
          summary,
          "combat.combatant.list(same rows, same order, as combat.get turns[])",
          JSON.stringify(combatantList?.combatants ?? null) ===
            JSON.stringify(combatWithRows?.combat?.turns ?? []),
          { listRows: combatantList?.combatants?.length, turnRows: combatWithRows?.combat?.turns?.length }
        );
        const combatantGet = expectOk(
          summary,
          "combat.combatant.get",
          runFoundryctl([
            "combat",
            "combatant",
            "get",
            "--combat-id",
            createdCombatId,
            "--combatant-id",
            createdCombatantId
          ])
        );
        markAndPush(
          summary,
          "combat.combatant.get(full projection: no ownership key, version-gated roundJoined)",
          combatantGet?.combatant?.id === createdCombatantId &&
            combatantGet?.combatant?.ownership === undefined &&
            (isV14
              ? combatantGet?.combatant?.roundJoined === 1
              : combatantGet?.combatant?.roundJoined === null),
          {
            hasOwnership: combatantGet?.combatant?.ownership !== undefined,
            roundJoined: combatantGet?.combatant?.roundJoined,
            generation: isV14 ? 14 : 13
          }
        );

        const groupCreate = expectOk(
          summary,
          "combat.group.create",
          runFoundryctl([
            "combat",
            "group",
            "create",
            "--combat-id",
            createdCombatId,
            "--name",
            `Smoke Group ${stamp}`,
            "--initiative",
            "15"
          ])
        );
        const createdGroupId = groupCreate?.group?.id ?? null;
        markAndPush(
          summary,
          "combat.group.create(no members yet, no ownership on a WRITE result)",
          Boolean(createdGroupId) &&
            Array.isArray(groupCreate?.group?.memberCombatantIds) &&
            groupCreate.group.memberCombatantIds.length === 0 &&
            groupCreate?.group?.ownership === undefined,
          {
            groupId: createdGroupId,
            members: groupCreate?.group?.memberCombatantIds,
            hasOwnership: groupCreate?.group?.ownership !== undefined
          }
        );

        const groupCreateDry = expectOk(
          summary,
          "combat.group.create(dry-run)",
          runFoundryctl([
            "--dry-run",
            "combat",
            "group",
            "create",
            "--combat-id",
            createdCombatId,
            "--name",
            `Smoke Group Preview ${stamp}`
          ])
        );
        markAndPush(
          summary,
          "combat.group.create(dry-run previews the SEEDED derived pair, mints no id, persists nothing)",
          groupCreateDry?.dryRun === true &&
            groupCreateDry?.group?.id === null &&
            groupCreateDry?.group?.hidden === true &&
            groupCreateDry?.group?.defeated === true &&
            Array.isArray(groupCreateDry?.group?.memberCombatantIds) &&
            groupCreateDry.group.memberCombatantIds.length === 0,
          {
            id: groupCreateDry?.group?.id,
            hidden: groupCreateDry?.group?.hidden,
            defeated: groupCreateDry?.group?.defeated,
            members: groupCreateDry?.group?.memberCombatantIds
          }
        );
        if (createdGroupId) {
          expectOk(
            summary,
            "combat.group.list",
            runFoundryctl(["combat", "group", "list", "--combat-id", createdCombatId])
          );
          const groupGet = expectOk(
            summary,
            "combat.group.get",
            runFoundryctl([
              "combat",
              "group",
              "get",
              "--combat-id",
              createdCombatId,
              "--group-id",
              createdGroupId
            ])
          );
          markAndPush(
            summary,
            "combat.group.get(READ-ONLY ownership present; initiative STORED; hidden/defeated derived)",
            groupGet?.group?.ownership !== undefined &&
              typeof groupGet?.group?.ownership === "object" &&
              groupGet?.group?.initiative === 15 &&
              groupGet?.group?.hidden === true &&
              groupGet?.group?.defeated === true,
            {
              ownership: groupGet?.group?.ownership,
              initiative: groupGet?.group?.initiative,
              hidden: groupGet?.group?.hidden,
              defeated: groupGet?.group?.defeated
            }
          );

          const joined = expectOk(
            summary,
            "combat.combatant.update(--group joins)",
            runFoundryctl([
              "combat",
              "combatant",
              "update",
              "--combat-id",
              createdCombatId,
              "--combatant-id",
              createdCombatantId,
              "--group",
              createdGroupId
            ])
          );
          const groupAfterJoin = expectOk(
            summary,
            "combat.group.get(after join)",
            runFoundryctl([
              "combat",
              "group",
              "get",
              "--combat-id",
              createdCombatId,
              "--group-id",
              createdGroupId
            ])
          );
          markAndPush(
            summary,
            "group membership round-trips (stored `group` id, memberCombatantIds from STORED membership)",
            joined?.combatant?.group === createdGroupId &&
              Array.isArray(groupAfterJoin?.group?.memberCombatantIds) &&
              groupAfterJoin.group.memberCombatantIds.includes(createdCombatantId),
            { group: joined?.combatant?.group, members: groupAfterJoin?.group?.memberCombatantIds }
          );

          const joinInitiativeChanges = joined?.groupInitiativeChanges ?? null;
          const reportedGroupChange = Array.isArray(joinInitiativeChanges)
            ? (joinInitiativeChanges.find((change) => change?.groupId === createdGroupId) ?? null)
            : null;
          markAndPush(
            summary,
            "combat.combatant.update reports the group initiative a SYSTEM changed (report reconciles with a fresh group get)",
            Array.isArray(joinInitiativeChanges) &&
              (reportedGroupChange
                ? reportedGroupChange.initiativeBefore === 15 &&
                  reportedGroupChange.initiativeAfter === (groupAfterJoin?.group?.initiative ?? null)
                : groupAfterJoin?.group?.initiative === 15),
            {
              reported: joinInitiativeChanges,
              initiativeAfterJoin: groupAfterJoin?.group?.initiative,
              generation: isV14 ? 14 : 13
            }
          );

          const groupUpdateDry = expectOk(
            summary,
            "combat.group.update(dry-run)",
            runFoundryctl([
              "--dry-run",
              "combat",
              "group",
              "update",
              "--combat-id",
              createdCombatId,
              "--group-id",
              createdGroupId,
              "--name",
              `Smoke Group Renamed ${stamp}`
            ])
          );
          markAndPush(
            summary,
            "combat.group.update(dry-run reports the LIVE derived pair, not a reseeded true/true)",
            groupUpdateDry?.dryRun === true &&
              groupUpdateDry?.group?.hidden === groupAfterJoin?.group?.hidden &&
              groupUpdateDry?.group?.defeated === groupAfterJoin?.group?.defeated,
            {
              previewHidden: groupUpdateDry?.group?.hidden,
              livehidden: groupAfterJoin?.group?.hidden,
              previewDefeated: groupUpdateDry?.group?.defeated,
              liveDefeated: groupAfterJoin?.group?.defeated
            }
          );

          const groupUpdated = expectOk(
            summary,
            "combat.group.update(initiative writable)",
            runFoundryctl([
              "combat",
              "group",
              "update",
              "--combat-id",
              createdCombatId,
              "--group-id",
              createdGroupId,
              "--initiative",
              "21"
            ])
          );
          const memberAfterGroupWrite = expectOk(
            summary,
            "combat.combatant.get(after a group initiative write)",
            runFoundryctl([
              "combat",
              "combatant",
              "get",
              "--combat-id",
              createdCombatId,
              "--combatant-id",
              createdCombatantId
            ])
          );
          markAndPush(
            summary,
            "combat.combatant.get reports the combatant's OWN stored initiative, not its group's",
            groupUpdated?.group?.initiative === 21 && memberAfterGroupWrite?.combatant?.initiative === 7,
            {
              groupInitiative: groupUpdated?.group?.initiative,
              memberInitiative: memberAfterGroupWrite?.combatant?.initiative
            }
          );

          const groupDeleteDry = expectOk(
            summary,
            "combat.group.delete(dry-run)",
            runFoundryctl([
              "--dry-run",
              "combat",
              "group",
              "delete",
              "--combat-id",
              createdCombatId,
              "--group-id",
              createdGroupId
            ])
          );
          markAndPush(
            summary,
            "combat.group.delete(dry-run deletes nothing and predicts the dangling members)",
            groupDeleteDry?.dryRun === true &&
              groupDeleteDry?.deleted === false &&
              Array.isArray(groupDeleteDry?.danglingCombatantIds) &&
              groupDeleteDry.danglingCombatantIds.includes(createdCombatantId),
            { deleted: groupDeleteDry?.deleted, dangling: groupDeleteDry?.danglingCombatantIds }
          );
          const groupDeleted = expectOk(
            summary,
            "combat.group.delete",
            runFoundryctl([
              "combat",
              "group",
              "delete",
              "--combat-id",
              createdCombatId,
              "--group-id",
              createdGroupId
            ])
          );
          const memberAfterGroupDelete = expectOk(
            summary,
            "combat.combatant.get(after its group was deleted)",
            runFoundryctl([
              "combat",
              "combatant",
              "get",
              "--combat-id",
              createdCombatId,
              "--combatant-id",
              createdCombatantId
            ])
          );
          markAndPush(
            summary,
            "combat.group.delete reports the DANGLING members Foundry leaves behind",
            groupDeleted?.deleted === true &&
              Array.isArray(groupDeleted?.danglingCombatantIds) &&
              groupDeleted.danglingCombatantIds.includes(createdCombatantId) &&
              memberAfterGroupDelete?.combatant?.group === createdGroupId,
            {
              dangling: groupDeleted?.danglingCombatantIds,
              storedGroup: memberAfterGroupDelete?.combatant?.group
            }
          );
          const repaired = expectOk(
            summary,
            "combat.combatant.update(--clear-group repairs a dangling reference)",
            runFoundryctl([
              "combat",
              "combatant",
              "update",
              "--combat-id",
              createdCombatId,
              "--combatant-id",
              createdCombatantId,
              "--clear-group"
            ])
          );
          markAndPush(
            summary,
            "combat.combatant.update(group null after --clear-group)",
            repaired?.combatant?.group === null,
            {
              group: repaired?.combatant?.group
            }
          );
          expectErr(
            summary,
            "combat.group.get(deleted group)",
            runFoundryctl([
              "combat",
              "group",
              "get",
              "--combat-id",
              createdCombatId,
              "--group-id",
              createdGroupId
            ]),
            ERROR_CODES.COMBATANT_GROUP_NOT_FOUND
          );
        }

        expectErr(
          summary,
          "combat.combatant.update(unknown group id)",
          runFoundryctl([
            "combat",
            "combatant",
            "update",
            "--combat-id",
            createdCombatId,
            "--combatant-id",
            createdCombatantId,
            "--group",
            "smokeGroupZZ9999"
          ]),
          ERROR_CODES.COMBATANT_GROUP_NOT_FOUND
        );

        for (const [label, argv, code] of [
          [
            "initiative in the combatant PATCH",
            [
              "combat",
              "combatant",
              "update",
              "--combat-id",
              createdCombatId,
              "--combatant-id",
              createdCombatantId,
              "--patch-json",
              JSON.stringify({ initiative: 3 })
            ],
            ERROR_CODES.INVALID_PARAMS
          ],
          [
            "blank combatant img",
            [
              "combat",
              "combatant",
              "update",
              "--combat-id",
              createdCombatId,
              "--combatant-id",
              createdCombatantId,
              "--img",
              ""
            ],
            ERROR_CODES.INVALID_PARAMS
          ],
          [
            "whitespace-only combatant img",
            [
              "combat",
              "combatant",
              "update",
              "--combat-id",
              createdCombatId,
              "--combatant-id",
              createdCombatantId,
              "--img",
              "   "
            ],
            ERROR_CODES.INVALID_PARAMS
          ],
          [
            "whitespace-only combatant sceneId",
            [
              "combat",
              "combatant",
              "update",
              "--combat-id",
              createdCombatId,
              "--combatant-id",
              createdCombatantId,
              "--scene-id",
              "   "
            ],
            ERROR_CODES.INVALID_PARAMS
          ],
          [
            "whitespace-only combatant group",
            [
              "combat",
              "combatant",
              "update",
              "--combat-id",
              createdCombatId,
              "--combatant-id",
              createdCombatantId,
              "--group",
              "   "
            ],
            ERROR_CODES.INVALID_PARAMS
          ],
          [
            "combatant meta (_id)",
            [
              "combat",
              "combatant",
              "create",
              "--combat-id",
              createdCombatId,
              "--data-json",
              JSON.stringify({ _id: "smokeSpoofAA1111" })
            ],
            ERROR_CODES.INVALID_PARAMS
          ],
          [
            "group ownership write",
            [
              "combat",
              "group",
              "create",
              "--combat-id",
              createdCombatId,
              "--data-json",
              JSON.stringify({ ownership: { default: 2 } })
            ],
            ERROR_CODES.INVALID_PARAMS
          ]
        ]) {
          expectErr(summary, `combat embedded write rejects ${label}`, runFoundryctl(argv), code);
        }
        expectErr(
          summary,
          "combat.combatant.get(unknown combatant id)",
          runFoundryctl([
            "combat",
            "combatant",
            "get",
            "--combat-id",
            createdCombatId,
            "--combatant-id",
            `missing-${stamp}`
          ]),
          ERROR_CODES.COMBATANT_NOT_FOUND
        );

        if (isV14) {
          const late = expectOk(
            summary,
            "combat.combatant.update(v14: --round-joined accepted)",
            runFoundryctl([
              "combat",
              "combatant",
              "update",
              "--combat-id",
              createdCombatId,
              "--combatant-id",
              createdCombatantId,
              "--round-joined",
              "2"
            ])
          );
          markAndPush(
            summary,
            "combat.combatant.update(v14: roundJoined round-trip)",
            late?.combatant?.roundJoined === 2,
            {
              roundJoined: late?.combatant?.roundJoined
            }
          );
        } else {
          expectErr(
            summary,
            "combat.combatant.create(v13: --round-joined rejected, never silently dropped)",
            runFoundryctl([
              "combat",
              "combatant",
              "create",
              "--combat-id",
              createdCombatId,
              "--round-joined",
              "2"
            ]),
            ERROR_CODES.INVALID_PARAMS
          );
        }

        const combatantCreateDry = expectOk(
          summary,
          "combat.combatant.create(dry-run)",
          runFoundryctl([
            "--dry-run",
            "combat",
            "combatant",
            "create",
            "--combat-id",
            createdCombatId,
            "--name",
            "Preview only"
          ])
        );
        const afterCombatantDry = expectOk(
          summary,
          "combat.get(after combatant create dry-run)",
          runFoundryctl(["combat", "get", "--combat-id", createdCombatId])
        );
        markAndPush(
          summary,
          "combat.combatant.create(dry-run nulls the id and persists nothing)",
          combatantCreateDry?.dryRun === true &&
            combatantCreateDry?.combatant?.id === null &&
            combatantCreateDry?.combatant?._id === null &&
            afterCombatantDry?.combat?.combatantCount === 1,
          {
            dryRun: combatantCreateDry?.dryRun,
            id: combatantCreateDry?.combatant?.id,
            count: afterCombatantDry?.combat?.combatantCount
          }
        );

        if (createdSceneId && targetSceneId && createdSceneId !== targetSceneId) {
          const crossScene = expectOk(
            summary,
            "combat.combatant.create(cross-scene)",
            runFoundryctl([
              "combat",
              "combatant",
              "create",
              "--combat-id",
              createdCombatId,
              "--scene-id",
              targetSceneId,
              "--name",
              `Off-scene ${stamp}`
            ])
          );
          const crossSceneCombatantId = crossScene?.combatant?.id ?? null;
          markAndPush(
            summary,
            "combat.combatant.create REPORTS the scene unlink Foundry's server performs",
            crossScene?.combatSceneUnlinked === true && crossScene?.combat?.scene === null,
            { unlinked: crossScene?.combatSceneUnlinked, parentScene: crossScene?.combat?.scene }
          );
          expectErr(
            summary,
            "combat.update(--scene refused while a combatant sits elsewhere)",
            runFoundryctl(["combat", "update", "--combat-id", createdCombatId, "--scene", createdSceneId]),
            ERROR_CODES.COMBAT_SCENE_MISMATCH
          );
          if (crossSceneCombatantId) {
            const crossSceneDeleted = expectOk(
              summary,
              "combat.combatant.delete(cross-scene row)",
              runFoundryctl([
                "combat",
                "combatant",
                "delete",
                "--combat-id",
                createdCombatId,
                "--combatant-id",
                crossSceneCombatantId
              ])
            );
            markAndPush(
              summary,
              "combat.combatant.delete(deleted + parent summary, and NO unlink flag — a delete cannot unlink)",
              crossSceneDeleted?.deleted === true &&
                crossSceneDeleted?.combat?.id === createdCombatId &&
                crossSceneDeleted?.combat?.combatantCount === 1 &&
                crossSceneDeleted?.combatSceneUnlinked === undefined,
              {
                deleted: crossSceneDeleted?.deleted,
                count: crossSceneDeleted?.combat?.combatantCount,
                hasUnlinkFlag: crossSceneDeleted?.combatSceneUnlinked !== undefined
              }
            );

            const relinked = expectOk(
              summary,
              "combat.update(--scene allowed once the off-scene combatant is gone)",
              runFoundryctl(["combat", "update", "--combat-id", createdCombatId, "--scene", createdSceneId])
            );
            markAndPush(
              summary,
              "combat.update(scene re-linked after mismatch cleared)",
              relinked?.combat?.scene === createdSceneId,
              {
                scene: relinked?.combat?.scene
              }
            );
          }
        }

        const combatantDeleted = expectOk(
          summary,
          "combat.combatant.delete(section fixture, leaving the encounter empty for the action block)",
          runFoundryctl([
            "combat",
            "combatant",
            "delete",
            "--combat-id",
            createdCombatId,
            "--combatant-id",
            createdCombatantId
          ])
        );
        markAndPush(
          summary,
          "combat.combatant.delete(row gone, parent count back to 0)",
          combatantDeleted?.deleted === true && combatantDeleted?.combat?.combatantCount === 0,
          { deleted: combatantDeleted?.deleted, count: combatantDeleted?.combat?.combatantCount }
        );
        expectErr(
          summary,
          "combat.combatant.get(deleted combatant)",
          runFoundryctl([
            "combat",
            "combatant",
            "get",
            "--combat-id",
            createdCombatId,
            "--combatant-id",
            createdCombatantId
          ]),
          ERROR_CODES.COMBATANT_NOT_FOUND
        );
      }

      const actionCombatantIds = [];
      for (const label of ["Alpha", "Bravo"]) {
        const row = expectOk(
          summary,
          `combat.combatant.create(action fixture ${label})`,
          runFoundryctl([
            "combat",
            "combatant",
            "create",
            "--combat-id",
            createdCombatId,
            ...(createdSceneId ? ["--scene-id", createdSceneId] : []),
            "--name",
            `${label} ${stamp}`
          ])
        );
        if (row?.combatant?.id) actionCombatantIds.push(row.combatant.id);
      }
      if (actionCombatantIds.length === 2) {
        const advanceKey = (suffix) => ["--idempotency-key", `smoke-combat-${stamp}-${suffix}`];

        const assertInitiativeReadyForStart = (label) => {
          const readBack = expectOk(
            summary,
            `combat.get(initiative precondition: ${label})`,
            runFoundryctl(["combat", "get", "--combat-id", createdCombatId])
          );
          const turns = readBack?.combat?.turns ?? [];
          markAndPush(
            summary,
            `combat.start precondition(${label}): every combatant holds an initiative, so no dialog-opening wrapper can stall the call`,
            turns.length > 0 && turns.every((turn) => typeof turn?.initiative === "number"),
            {
              initiatives: turns.map((turn) => ({
                id: turn?.id ?? null,
                initiative: turn?.initiative ?? null
              }))
            }
          );
        };

        for (const verb of ["next-turn", "previous-turn", "previous-round"]) {
          expectErr(
            summary,
            `combat.${verb}(refused on an unstarted combat)`,
            runFoundryctl([
              "combat",
              verb,
              "--combat-id",
              createdCombatId,
              ...advanceKey(`unstarted-${verb}`)
            ]),
            ERROR_CODES.COMBAT_NOT_STARTED
          );
        }

        const setInit = expectOk(
          summary,
          "combat.set-initiative",
          runFoundryctl([
            "combat",
            "set-initiative",
            "--combat-id",
            createdCombatId,
            "--combatant-id",
            actionCombatantIds[0],
            "--initiative",
            "17"
          ])
        );
        markAndPush(
          summary,
          "combat.set-initiative(stored value + changed flag)",
          setInit?.initiative === 17 && setInit?.changed === true && setInit?.initiativeBefore === null,
          { initiative: setInit?.initiative, changed: setInit?.changed, before: setInit?.initiativeBefore }
        );
        const setInitAgain = expectOk(
          summary,
          "combat.set-initiative(same value)",
          runFoundryctl([
            "combat",
            "set-initiative",
            "--combat-id",
            createdCombatId,
            "--combatant-id",
            actionCombatantIds[0],
            "--initiative",
            "17"
          ])
        );
        markAndPush(
          summary,
          "combat.set-initiative(same value is a convergent no-op, not a failure)",
          setInitAgain?.changed === false && setInitAgain?.initiative === 17,
          { changed: setInitAgain?.changed, initiative: setInitAgain?.initiative }
        );
        expectErr(
          summary,
          "combat.set-initiative(unknown combatant → COMBATANT_NOT_FOUND, never Foundry's collection prose)",
          runFoundryctl([
            "combat",
            "set-initiative",
            "--combat-id",
            createdCombatId,
            "--combatant-id",
            `missing-${stamp}`,
            "--initiative",
            "1"
          ]),
          ERROR_CODES.COMBATANT_NOT_FOUND
        );

        expectErr(
          summary,
          "combat.roll-initiative(no selector)",
          runFoundryctl([
            "combat",
            "roll-initiative",
            "--combat-id",
            createdCombatId,
            ...advanceKey("roll-none")
          ]),
          ERROR_CODES.INVALID_PARAMS
        );
        expectErr(
          summary,
          "combat.roll-initiative(unknown combatant id is REFUSED, not skipped)",
          runFoundryctl([
            "combat",
            "roll-initiative",
            "--combat-id",
            createdCombatId,
            "--combatant-ids",
            `missing-${stamp}`,
            ...advanceKey("roll-missing")
          ]),
          ERROR_CODES.COMBATANT_NOT_FOUND
        );

        expectErr(
          summary,
          "combat.roll-initiative(REPEATED combatant id is REFUSED, nothing rolled)",
          runFoundryctl([
            "combat",
            "roll-initiative",
            "--combat-id",
            createdCombatId,
            "--combatant-ids",
            `${actionCombatantIds[1]},${actionCombatantIds[1]}`,
            ...advanceKey("roll-dup")
          ]),
          ERROR_CODES.INVALID_PARAMS
        );
        const rollDry = expectOk(
          summary,
          "combat.roll-initiative(dry-run)",
          runFoundryctl([
            "--dry-run",
            "combat",
            "roll-initiative",
            "--combat-id",
            createdCombatId,
            "--combatant-ids",
            actionCombatantIds[1],
            ...advanceKey("roll-dry")
          ])
        );
        markAndPush(
          summary,
          "combat.roll-initiative(dry-run rolls nothing but reports the computed target set)",
          rollDry?.dryRun === true &&
            rollDry?.mutation === "not-executed" &&
            Array.isArray(rollDry?.rolled) &&
            rollDry.rolled.length === 0 &&
            rollDry?.chatMessages?.status === "not-requested" &&
            (rollDry?.targetedCombatantIds ?? []).includes(actionCombatantIds[1]),
          {
            mutation: rollDry?.mutation,
            rolled: rollDry?.rolled?.length,
            chat: rollDry?.chatMessages?.status,
            targeted: rollDry?.targetedCombatantIds
          }
        );

        const rolled = expectOk(
          summary,
          "combat.roll-initiative(--combatant-ids, --roll-mode gm)",
          runFoundryctl([
            "combat",
            "roll-initiative",
            "--combat-id",
            createdCombatId,
            "--combatant-ids",
            actionCombatantIds[1],
            "--roll-mode",
            "gm",
            ...advanceKey("roll-1")
          ])
        );
        for (const messageId of rolled?.chatMessages?.ids ?? []) created.messages.push(messageId);
        markAndPush(
          summary,
          "combat.roll-initiative(one row rolled, STORED value reported, chat captured by the correlation flag)",
          rolled?.complete === true &&
            rolled?.mutation === "committed" &&
            rolled?.select === "ids" &&
            (rolled?.rolled ?? []).length === 1 &&
            rolled.rolled[0]?.combatantId === actionCombatantIds[1] &&
            typeof rolled.rolled[0]?.initiative === "number" &&
            (rolled?.unconfirmedCombatantIds ?? []).length === 0 &&
            (rolled?.unconfirmableCombatantIds ?? []).length === 0 &&
            rolled?.chatMessages?.status === "captured" &&
            rolled?.chatMessages?.expectedCount === 1 &&
            (rolled?.chatMessages?.ids ?? []).length === 1,
          {
            complete: rolled?.complete,
            mutation: rolled?.mutation,
            rolled: rolled?.rolled,
            chat: rolled?.chatMessages
          }
        );

        const rolledMessageId = (rolled?.chatMessages?.ids ?? [])[0] ?? null;
        if (rolledMessageId) {
          const rolledMessage = expectOk(
            summary,
            "chat.get(initiative roll message)",
            runFoundryctl(["chat", "get", "--message-id", rolledMessageId])
          );
          markAndPush(
            summary,
            "combat.roll-initiative(--roll-mode gm landed a GM whisper — the per-version translation is correct)",
            Array.isArray(rolledMessage?.message?.whisper) && rolledMessage.message.whisper.length > 0,
            { whisper: rolledMessage?.message?.whisper }
          );
        }

        assertInitiativeReadyForStart("first start");
        const startDry = expectOk(
          summary,
          "combat.start(dry-run)",
          runFoundryctl(["--dry-run", "combat", "start", "--combat-id", createdCombatId])
        );
        markAndPush(
          summary,
          "combat.start(dry-run calls nothing and reports current state)",
          startDry?.dryRun === true && startDry?.transition === "none" && startDry?.combat?.round === 0,
          { dryRun: startDry?.dryRun, transition: startDry?.transition, round: startDry?.combat?.round }
        );
        const started = expectOk(
          summary,
          "combat.start",
          runFoundryctl(["combat", "start", "--combat-id", createdCombatId])
        );
        markAndPush(
          summary,
          "combat.start(round 0 -> 1 turn 0, started, and does NOT activate)",
          started?.transition === "round" &&
            started?.alreadyStarted === false &&
            started?.combat?.round === 1 &&
            started?.combat?.turn === 0 &&
            started?.combat?.started === true &&
            started?.combat?.active === false,
          {
            transition: started?.transition,
            round: started?.combat?.round,
            turn: started?.combat?.turn,
            active: started?.combat?.active
          }
        );

        const restarted = expectOk(
          summary,
          "combat.start(already started)",
          runFoundryctl(["combat", "start", "--combat-id", createdCombatId])
        );
        markAndPush(
          summary,
          "combat.start(already-started calls NOTHING — the rewind guard)",
          restarted?.alreadyStarted === true &&
            restarted?.transition === "none" &&
            restarted?.combat?.round === 1,
          {
            alreadyStarted: restarted?.alreadyStarted,
            transition: restarted?.transition,
            round: restarted?.combat?.round
          }
        );

        const roundJoinedPreview = expectOk(
          summary,
          "combat.combatant.create(dry-run on a STARTED encounter)",
          runFoundryctl([
            "--dry-run",
            "combat",
            "combatant",
            "create",
            "--combat-id",
            createdCombatId,
            "--name",
            "Round-joined preview",
            ...(isV14 ? ["--round-joined", "9"] : [])
          ])
        );
        markAndPush(
          summary,
          "combat.combatant.create(dry-run previews v14's roundJoined overwrite; null on v13)",
          roundJoinedPreview?.dryRun === true &&
            roundJoinedPreview?.combatant?.id === null &&
            (isV14
              ? roundJoinedPreview?.combatant?.roundJoined === restarted?.combat?.round
              : roundJoinedPreview?.combatant?.roundJoined === null),
          {
            roundJoined: roundJoinedPreview?.combatant?.roundJoined,
            round: restarted?.combat?.round,
            isV14
          }
        );

        const unstarted = expectOk(
          summary,
          "combat.previous-turn(from round 1 turn 0)",
          runFoundryctl([
            "combat",
            "previous-turn",
            "--combat-id",
            createdCombatId,
            ...advanceKey("prev-turn-unstart")
          ])
        );
        markAndPush(
          summary,
          "combat.previous-turn at round 1 turn 0 UN-STARTS the encounter and reports a ROUND transition",
          unstarted?.transition === "round" &&
            unstarted?.combat?.round === 0 &&
            unstarted?.combat?.turn === null &&
            unstarted?.combat?.started === false,
          {
            transition: unstarted?.transition,
            round: unstarted?.combat?.round,
            turn: unstarted?.combat?.turn,
            started: unstarted?.combat?.started
          }
        );

        assertInitiativeReadyForStart("restart after the un-start");
        const restartedAfterUnstart = expectOk(
          summary,
          "combat.start(after the un-start, restoring round 1 turn 0 for the chain below)",
          runFoundryctl(["combat", "start", "--combat-id", createdCombatId])
        );
        markAndPush(
          summary,
          "combat.start(re-starts an UN-STARTED encounter — the rewind guard does not block it)",
          restartedAfterUnstart?.alreadyStarted === false &&
            restartedAfterUnstart?.combat?.round === 1 &&
            restartedAfterUnstart?.combat?.turn === 0,
          {
            alreadyStarted: restartedAfterUnstart?.alreadyStarted,
            round: restartedAfterUnstart?.combat?.round,
            turn: restartedAfterUnstart?.combat?.turn
          }
        );

        expectErr(
          summary,
          "combat.next-turn(--expected-round mismatch)",
          runFoundryctl([
            "combat",
            "next-turn",
            "--combat-id",
            createdCombatId,
            "--expected-round",
            "99",
            ...advanceKey("precondition")
          ]),
          ERROR_CODES.PRECONDITION_FAILED
        );

        const turnAdvanced = expectOk(
          summary,
          "combat.next-turn",
          runFoundryctl([
            "combat",
            "next-turn",
            "--combat-id",
            createdCombatId,
            "--expected-round",
            "1",
            "--expected-turn",
            "0",
            ...advanceKey("turn-1")
          ])
        );
        markAndPush(
          summary,
          "combat.next-turn(turn advance inside the round)",
          turnAdvanced?.transition === "turn" &&
            turnAdvanced?.combat?.round === 1 &&
            turnAdvanced?.combat?.turn === 1,
          {
            transition: turnAdvanced?.transition,
            round: turnAdvanced?.combat?.round,
            turn: turnAdvanced?.combat?.turn
          }
        );
        const delegated = expectOk(
          summary,
          "combat.next-turn(last combatant)",
          runFoundryctl(["combat", "next-turn", "--combat-id", createdCombatId, ...advanceKey("turn-2")])
        );
        markAndPush(
          summary,
          "combat.next-turn on the LAST combatant reports a ROUND transition (Foundry delegates)",
          delegated?.transition === "round" && delegated?.combat?.round === 2,
          { transition: delegated?.transition, round: delegated?.combat?.round }
        );
        const roundAdvanced = expectOk(
          summary,
          "combat.next-round",
          runFoundryctl(["combat", "next-round", "--combat-id", createdCombatId, ...advanceKey("round-1")])
        );
        markAndPush(summary, "combat.next-round", roundAdvanced?.combat?.round === 3, {
          round: roundAdvanced?.combat?.round
        });
        const roundRewound = expectOk(
          summary,
          "combat.previous-round",
          runFoundryctl([
            "combat",
            "previous-round",
            "--combat-id",
            createdCombatId,
            ...advanceKey("round-back")
          ])
        );
        markAndPush(summary, "combat.previous-round", roundRewound?.combat?.round === 2, {
          round: roundRewound?.combat?.round
        });
        summary.notes.push(
          `combat action verbs advanced encounter ${createdCombatId} through several turns/rounds: world TIME moved (a round delta is 6s under dnd5e), Foundry's combatRound/combatTurn hooks fired, ActiveEffect durations were processed and any RegionBehavior containing a combatant's token auto-fired (executeScript/executeMacro included, AFTER the command answered). None of that is undoable — the encounter itself is deleted at cleanup`
        );

        const rollAllRow = expectOk(
          summary,
          "combat.combatant.create(third row, so --all has something to roll)",
          runFoundryctl([
            "combat",
            "combatant",
            "create",
            "--combat-id",
            createdCombatId,
            ...(createdSceneId ? ["--scene-id", createdSceneId] : []),
            "--name",
            `Charlie ${stamp}`
          ])
        );
        const rollAllTargetId = rollAllRow?.combatant?.id ?? null;
        const rolledAll = expectOk(
          summary,
          "combat.roll-initiative(--all)",
          runFoundryctl([
            "combat",
            "roll-initiative",
            "--combat-id",
            createdCombatId,
            "--all",
            "--roll-mode",
            "gm",
            ...advanceKey("roll-all")
          ])
        );
        for (const messageId of rolledAll?.chatMessages?.ids ?? []) created.messages.push(messageId);
        markAndPush(
          summary,
          "combat.roll-initiative(--all rolls the initiative-less row, skips the rows that already have one)",
          rolledAll?.select === "all" &&
            Boolean(rollAllTargetId) &&
            (rolledAll?.targetedCombatantIds ?? []).includes(rollAllTargetId) &&
            !(rolledAll?.targetedCombatantIds ?? []).includes(actionCombatantIds[0]) &&
            (rolledAll?.rolled ?? []).some(
              (row) => row?.combatantId === rollAllTargetId && typeof row?.initiative === "number"
            ) &&
            (rolledAll?.rolled ?? []).every((row) => typeof row?.initiative === "number") &&
            (rolledAll?.chatMessages?.ids ?? []).length >= 1 &&
            (rolledAll?.unconfirmedCombatantIds ?? []).length === 0 &&
            (rolledAll?.unconfirmableCombatantIds ?? []).length === 0 &&
            rolledAll?.mutation === "committed" &&
            rolledAll?.complete === true &&
            rolledAll?.failure === undefined,
          {
            select: rolledAll?.select,
            targeted: rolledAll?.targetedCombatantIds,
            rolled: rolledAll?.rolled,
            chatIds: rolledAll?.chatMessages?.ids,
            mutation: rolledAll?.mutation,
            complete: rolledAll?.complete,
            failure: rolledAll?.failure ?? null
          }
        );

        const npcRow = expectOk(
          summary,
          "combat.combatant.create(fourth row, so --npc has something to roll)",
          runFoundryctl([
            "combat",
            "combatant",
            "create",
            "--combat-id",
            createdCombatId,
            ...(createdSceneId ? ["--scene-id", createdSceneId] : []),
            "--name",
            `Delta ${stamp}`
          ])
        );
        const npcRowId = npcRow?.combatant?.id ?? null;
        const rolledNpc = expectOk(
          summary,
          "combat.roll-initiative(--npc)",
          runFoundryctl([
            "combat",
            "roll-initiative",
            "--combat-id",
            createdCombatId,
            "--npc",
            "--roll-mode",
            "gm",
            ...advanceKey("roll-npc")
          ])
        );
        for (const messageId of rolledNpc?.chatMessages?.ids ?? []) created.messages.push(messageId);
        markAndPush(
          summary,
          "combat.roll-initiative(--npc rolls the initiative-less NPC row through Combat#rollNPC)",
          rolledNpc?.select === "npc" &&
            Boolean(npcRowId) &&
            (rolledNpc?.targetedCombatantIds ?? []).includes(npcRowId) &&
            (rolledNpc?.rolled ?? []).some(
              (row) => row?.combatantId === npcRowId && typeof row?.initiative === "number"
            ) &&
            (rolledNpc?.chatMessages?.ids ?? []).length >= 1 &&
            rolledNpc?.mutation === "committed" &&
            rolledNpc?.failure === undefined,
          {
            select: rolledNpc?.select,
            targeted: rolledNpc?.targetedCombatantIds,
            rolled: rolledNpc?.rolled,
            mutation: rolledNpc?.mutation,
            failure: rolledNpc?.failure ?? null
          }
        );

        if (createdActorId) {
          const formulaRow = expectOk(
            summary,
            "combat.combatant.create(ACTOR-backed row, so --formula is tested where the system drops it)",
            runFoundryctl([
              "combat",
              "combatant",
              "create",
              "--combat-id",
              createdCombatId,
              "--actor-id",
              createdActorId,
              "--name",
              `Formula ${stamp}`
            ])
          );
          const formulaRowId = formulaRow?.combatant?.id ?? null;
          if (formulaRowId) {
            const formulaRoll = expectOk(
              summary,
              "combat.roll-initiative(--formula on an actor-backed combatant)",
              runFoundryctl([
                "combat",
                "roll-initiative",
                "--combat-id",
                createdCombatId,
                "--combatant-ids",
                formulaRowId,
                "--formula",
                "1d20+500",
                "--roll-mode",
                "gm",
                ...advanceKey("roll-formula")
              ])
            );
            for (const messageId of formulaRoll?.chatMessages?.ids ?? []) created.messages.push(messageId);
            const formulaStored = (formulaRoll?.rolled ?? []).find(
              (row) => row?.combatantId === formulaRowId
            );
            markAndPush(
              summary,
              "combat.roll-initiative(--formula is IGNORED by dnd5e for an actor-backed combatant — the documented disclosure)",
              formulaRow?.combatant?.actorId === createdActorId &&
                typeof formulaStored?.initiative === "number" &&
                formulaStored.initiative < 500,
              {
                actorId: formulaRow?.combatant?.actorId,
                requestedFormula: "1d20+500",
                storedInitiative: formulaStored?.initiative ?? null
              }
            );
            summary.notes.push(
              "combat.roll-initiative --formula was verified to be IGNORED by dnd5e for an ACTOR-backed combatant (the system's Combatant#getInitiativeRoll override drops the argument and rolls the actor's own initiative). Foundry core honours it; this is a per-system behaviour, so the bridge discloses it rather than gating the option"
            );
            summary.notes.push(
              `the actor-backed combatant above was created on a STARTED encounter, which on v14 makes Foundry refresh ActiveEffect durations for actor ${createdActorId} and possibly WRITE to its effects (expire or delete them). That actor is a smoke fixture deleted at cleanup, so nothing of the owner's is touched — but the write is not undoable and is reported rather than assumed away`
            );
          }
        } else {
          summary.notes.push(
            "combat.roll-initiative --formula was NOT exercised against an actor-backed combatant: no smoke actor was created, so the dnd5e formula-drop disclosure is untested in this run"
          );
        }

        const beforeReset = expectOk(
          summary,
          "combat.get(before reset-initiative)",
          runFoundryctl(["combat", "get", "--combat-id", createdCombatId])
        );
        const initiativeRowsBeforeReset = (beforeReset?.combat?.turns ?? []).filter(
          (turn) => typeof turn?.initiative === "number"
        ).length;
        const resetDry = expectOk(
          summary,
          "combat.reset-initiative(dry-run)",
          runFoundryctl(["--dry-run", "combat", "reset-initiative", "--combat-id", createdCombatId])
        );
        markAndPush(
          summary,
          "combat.reset-initiative(dry-run projects every initiative as null and writes nothing)",
          resetDry?.dryRun === true &&
            resetDry?.reset === false &&
            initiativeRowsBeforeReset > 0 &&
            resetDry?.changedCount === initiativeRowsBeforeReset &&
            (resetDry?.combat?.turns ?? []).every((turn) => turn?.initiative === null),
          {
            reset: resetDry?.reset,
            changedCount: resetDry?.changedCount,
            expected: initiativeRowsBeforeReset
          }
        );
        const reset = expectOk(
          summary,
          "combat.reset-initiative",
          runFoundryctl(["combat", "reset-initiative", "--combat-id", createdCombatId])
        );
        markAndPush(
          summary,
          "combat.reset-initiative(changedCount counts the rows that HELD an initiative)",
          reset?.reset === true &&
            initiativeRowsBeforeReset > 0 &&
            reset?.changedCount === initiativeRowsBeforeReset &&
            (reset?.combat?.turns ?? []).every((turn) => turn?.initiative === null),
          { reset: reset?.reset, changedCount: reset?.changedCount, expected: initiativeRowsBeforeReset }
        );
        const resetAgain = expectOk(
          summary,
          "combat.reset-initiative(second call)",
          runFoundryctl(["combat", "reset-initiative", "--combat-id", createdCombatId])
        );
        markAndPush(
          summary,
          "combat.reset-initiative(convergent: changedCount 0 on a second call)",
          resetAgain?.changedCount === 0,
          {
            changedCount: resetAgain?.changedCount
          }
        );

        const activateDry = expectOk(
          summary,
          "combat.activate(dry-run)",
          runFoundryctl(["--dry-run", "combat", "activate", "--combat-id", createdCombatId])
        );
        const activateDryBefore = activateDry?.otherActiveCombatIdsBefore ?? [];
        markAndPush(
          summary,
          "combat.activate(dry-run activates nothing and PREDICTS the world-wide deactivation)",
          activateDry?.dryRun === true &&
            activateDry?.active === false &&
            activateDry?.alreadyActive === false &&
            Array.isArray(activateDry?.deactivatedCombatIds) &&
            JSON.stringify(activateDry.deactivatedCombatIds) === JSON.stringify(activateDryBefore) &&
            (activateDry?.otherActiveCombatIdsAfter ?? []).length === 0,
          {
            active: activateDry?.active,
            before: activateDryBefore,
            deactivated: activateDry?.deactivatedCombatIds,
            after: activateDry?.otherActiveCombatIdsAfter
          }
        );
        const activated = expectOk(
          summary,
          "combat.activate",
          runFoundryctl(["combat", "activate", "--combat-id", createdCombatId])
        );
        markAndPush(
          summary,
          "combat.activate(active + the world-wide deactivation report, no lower-bound marker)",
          activated?.active === true &&
            activated?.combat?.active === true &&
            Array.isArray(activated?.deactivatedCombatIds) &&
            activated?.activationObservation === undefined,
          {
            active: activated?.active,
            deactivated: activated?.deactivatedCombatIds,
            hasObservationMarker: activated?.activationObservation !== undefined
          }
        );
        const deactivatedByActivate = activated?.deactivatedCombatIds ?? [];
        if (deactivatedByActivate.length === 1) {
          created.combatsToReactivate.push(deactivatedByActivate[0]);
          summary.notes.push(
            `combat.activate DEACTIVATED ${deactivatedByActivate[0]} — Foundry allows one active encounter WORLD-wide and deactivates the rest in the same operation; the smoke RE-ACTIVATES it during cleanup (see the combat.activate(restore) step)`
          );
        } else if (deactivatedByActivate.length > 1) {
          summary.notes.push(
            `combat.activate DEACTIVATED ${deactivatedByActivate.join(", ")} — Foundry allows one active encounter WORLD-wide and deactivates the rest in the same operation. The smoke does NOT restore them: only ONE can be active, so picking a winner would be a guess. Re-activate the one you want with \`fvtt-world-cli combat activate --combat-id <id>\``
          );
        }
        const reactivated = expectOk(
          summary,
          "combat.activate(already active)",
          runFoundryctl(["combat", "activate", "--combat-id", createdCombatId])
        );
        markAndPush(
          summary,
          "combat.activate(already-active is a SUCCESS — an empty diff is not a veto)",
          reactivated?.active === true && reactivated?.alreadyActive === true,
          { active: reactivated?.active, alreadyActive: reactivated?.alreadyActive }
        );
      }

      const combatDeleteDry = expectOk(
        summary,
        "combat.delete(dry-run)",
        runFoundryctl(["--dry-run", "combat", "delete", "--combat-id", createdCombatId])
      );
      markAndPush(
        summary,
        "combat.delete(dry-run deletes nothing, predicts no activation, marks the report unsettled)",
        combatDeleteDry?.dryRun === true &&
          combatDeleteDry?.deleted === false &&
          Array.isArray(combatDeleteDry?.activatedCombatIds) &&
          combatDeleteDry.activatedCombatIds.length === 0 &&
          combatDeleteDry?.activationObservation === "not-observable-at-return-time",
        {
          deleted: combatDeleteDry?.deleted,
          activated: combatDeleteDry?.activatedCombatIds,
          activationObservation: combatDeleteDry?.activationObservation
        }
      );
      expectOk(
        summary,
        "combat.get(after delete dry-run)",
        runFoundryctl(["combat", "get", "--combat-id", createdCombatId])
      );
    }

    const folderRootRun = expectOk(
      summary,
      "folder.create(root, extended fields)",
      runFoundryctl([
        "folder",
        "create",
        "--name",
        `Smoke Folder Root ${stamp}`,
        "--type",
        "Actor",
        "--description",
        "smoke",
        "--color",
        "#3366cc",
        "--sorting",
        "m"
      ])
    );
    const rootFolderId = folderRootRun?.folder?.id ?? null;
    if (rootFolderId) {
      created.folders.push(rootFolderId);

      markAndPush(
        summary,
        "folder.create(color/sorting persisted)",
        folderRootRun?.folder?.color === "#3366cc" && folderRootRun?.folder?.sorting === "m",
        { color: folderRootRun?.folder?.color, sorting: folderRootRun?.folder?.sorting }
      );

      const mkChild = (name, parentId) =>
        expectOk(
          summary,
          "folder.create(child)",
          runFoundryctl(["folder", "create", "--name", name, "--type", "Actor", "--folder", parentId])
        )?.folder?.id ?? null;

      const c1 = mkChild(`Smoke C1 ${stamp}`, rootFolderId);
      const c2 = c1 ? mkChild(`Smoke C2 ${stamp}`, c1) : null;
      const c3 = c2 ? mkChild(`Smoke C3 ${stamp}`, c2) : null;
      for (const id of [c1, c2, c3]) {
        if (id) created.folders.push(id);
      }
      const moverRun = expectOk(
        summary,
        "folder.create(mover)",
        runFoundryctl(["folder", "create", "--name", `Smoke Mover ${stamp}`, "--type", "Actor"])
      );
      const moverId = moverRun?.folder?.id ?? null;
      if (moverId) created.folders.push(moverId);

      const rootGet = expectOk(
        summary,
        "folder.get",
        runFoundryctl(["folder", "get", "--folder-id", rootFolderId])
      );
      markAndPush(
        summary,
        "folder.get(childFolderCount>=1)",
        typeof rootGet?.folder?.childFolderCount === "number" && rootGet.folder.childFolderCount >= 1,
        { childFolderCount: rootGet?.folder?.childFolderCount }
      );

      const upd = expectOk(
        summary,
        "folder.update(fields + clear color)",
        runFoundryctl([
          "folder",
          "update",
          "--folder-id",
          rootFolderId,
          "--name",
          `Smoke Folder Root ${stamp} (edited)`,
          "--clear-color"
        ])
      );
      markAndPush(summary, "folder.update(color cleared)", upd?.folder?.color === null, {
        color: upd?.folder?.color
      });

      if (moverId && c2) {
        expectOk(
          summary,
          "folder.update(reparent mover under c2)",
          runFoundryctl(["folder", "update", "--folder-id", moverId, "--folder", c2])
        );
        expectOk(
          summary,
          "folder.update(reparent mover to root)",
          runFoundryctl(["folder", "update", "--folder-id", moverId, "--clear-folder"])
        );
      }

      if (c1) {
        expectErr(
          summary,
          "folder.update(cycle reject)",
          runFoundryctl(["folder", "update", "--folder-id", rootFolderId, "--folder", c1]),
          ERROR_CODES.INVALID_PARAMS
        );
      }

      if (moverId && c3) {
        expectErr(
          summary,
          "folder.update(depth reject)",
          runFoundryctl(["folder", "update", "--folder-id", moverId, "--folder", c3]),
          ERROR_CODES.INVALID_PARAMS
        );
      }

      expectErr(
        summary,
        "folder.create(dangling parent → FOLDER_NOT_FOUND)",
        runFoundryctl([
          "folder",
          "create",
          "--name",
          `Smoke Orphan ${stamp}`,
          "--type",
          "Actor",
          "--folder",
          "smokeghostfolder1"
        ]),
        ERROR_CODES.FOLDER_NOT_FOUND
      );
      expectErr(
        summary,
        "folder.create(cross-type parent → INVALID_PARAMS)",
        runFoundryctl([
          "folder",
          "create",
          "--name",
          `Smoke Crosstype ${stamp}`,
          "--type",
          "Item",
          "--folder",
          rootFolderId
        ]),
        ERROR_CODES.INVALID_PARAMS
      );

      expectErr(
        summary,
        "folder.create(dry-run rejects an invalid type)",
        runFoundryctl([
          "--dry-run",
          "folder",
          "create",
          "--name",
          `Smoke BadType ${stamp}`,
          "--type",
          "NotAFolderType"
        ]),
        ERROR_CODES.INVALID_PARAMS
      );

      if (c1) {
        const delDry = expectOk(
          summary,
          "folder.delete(default dry-run)",
          runFoundryctl(["folder", "delete", "--folder-id", c1, "--dry-run"])
        );
        markAndPush(
          summary,
          "folder.delete(dry-run reparents subfolders, deletes nothing)",
          delDry?.deleted === false &&
            delDry?.dryRun === true &&
            (delDry?.folders?.deleted?.count ?? -1) === 0 &&
            (delDry?.folders?.reparented?.count ?? -1) >= 1,
          { folders: delDry?.folders, counts: delDry?.counts }
        );
      }

      const folderActorRun = expectOk(
        summary,
        "actor.create(in smoke folder)",
        runFoundryctl([
          "actor",
          "create",
          "--name",
          `Smoke Foldered Actor ${stamp}`,
          "--type",
          "npc",
          "--folder",
          rootFolderId
        ])
      );
      const folderActorId = folderActorRun?.actor?.id ?? null;
      if (folderActorId) {
        created.actors.push(folderActorId);

        const tokRun = expectOk(
          summary,
          "scene.token.create(from foldered actor)",
          runFoundryctl([
            "scene",
            "token",
            "create",
            "--scene-id",
            targetSceneId,
            "--actor-id",
            folderActorId
          ])
        );
        const tokId = tokRun?.token?.id ?? null;
        if (tokId) created.tokens.push({ sceneId: targetSceneId, tokenId: tokId });

        const gateRun = runFoundryctl([
          "folder",
          "delete",
          "--folder-id",
          rootFolderId,
          "--delete-subfolders",
          "--delete-contents"
        ]);
        expectErr(
          summary,
          "folder.delete(--delete-contents without --force → DELETE_FORBIDDEN)",
          gateRun,
          ERROR_CODES.DELETE_FORBIDDEN
        );
        const gatedViolations = gateRun?.response?.error?.details?.guardViolations ?? {};
        const gatedActors = gatedViolations?.actors ?? [];
        const gatedEntry = Array.isArray(gatedActors)
          ? gatedActors.find((a) => a?.actorId === folderActorId)
          : null;
        markAndPush(summary, "folder.delete(guard enumerates token-used actor)", Boolean(gatedEntry), {
          guardActors: Array.isArray(gatedActors) ? gatedActors.map((a) => a?.actorId) : gatedActors
        });

        markAndPush(
          summary,
          "folder.delete(guard lists carry exact counts + untruncated flags)",
          typeof gatedViolations?.actorsCount === "number" &&
            gatedViolations.actorsCount >= 1 &&
            gatedViolations.actorsCount >= gatedActors.length &&
            gatedViolations.actorsTruncated === false &&
            gatedViolations.scenesTruncated === false &&
            gatedEntry?.tokenReferencesCount >= 1 &&
            gatedEntry?.tokenReferencesTruncated === false,
          {
            actorsCount: gatedViolations?.actorsCount,
            actorsTruncated: gatedViolations?.actorsTruncated,
            scenesCount: gatedViolations?.scenesCount,
            scenesTruncated: gatedViolations?.scenesTruncated,
            tokenReferencesCount: gatedEntry?.tokenReferencesCount,
            tokenReferencesTruncated: gatedEntry?.tokenReferencesTruncated
          }
        );

        const guardVictim = expectOk(
          summary,
          "actor.create(bulk delete-guard innocent element)",
          runFoundryctl(["actor", "create", "--name", `Smoke Bulk Victim ${stamp}`, "--type", "npc"])
        );
        const guardVictimId = guardVictim?.actor?.id ?? null;
        if (guardVictimId) {
          created.actors.push(guardVictimId);
          const guardRun = runFoundryctl([
            "actor",
            "delete-many",
            "--ids",
            [guardVictimId, folderActorId].join(",")
          ]);
          expectErr(
            summary,
            "actor.delete-many(token-referenced element without --force → DELETE_FORBIDDEN)",
            guardRun,
            ERROR_CODES.DELETE_FORBIDDEN
          );
          markAndPush(
            summary,
            "actor.delete-many(the refusal NAMES the offending element index + its tokenReferences)",
            guardRun.response?.error?.details?.index === 1 &&
              guardRun.response?.error?.details?.actorId === folderActorId &&
              Array.isArray(guardRun.response?.error?.details?.tokenReferences) &&
              guardRun.response.error.details.tokenReferences.length >= 1,
            { details: guardRun.response?.error?.details ?? null }
          );

          expectErr(
            summary,
            "actor.delete-many(--dry-run refuses identically — a preview is not a guard bypass)",
            runFoundryctl([
              "actor",
              "delete-many",
              "--ids",
              [guardVictimId, folderActorId].join(","),
              "--dry-run"
            ]),
            ERROR_CODES.DELETE_FORBIDDEN
          );

          expectOk(
            summary,
            "actor.get(the refused batch wrote NOTHING — the innocent element survives)",
            runFoundryctl(["actor", "get", "--actor-id", guardVictimId])
          );

          const forcedDelete = expectOk(
            summary,
            "actor.delete-many(--force, one live id + one already gone)",
            runFoundryctl([
              "actor",
              "delete-many",
              "--ids",
              [guardVictimId, "nosuchid00000001"].join(","),
              "--force"
            ])
          );
          markAndPush(
            summary,
            "actor.delete-many(deleted beside alreadyDeleted, complete)",
            forcedDelete?.complete === true &&
              forcedDelete?.outcomes?.map((outcome) => outcome.status).join(",") === "deleted,alreadyDeleted",
            { observed: forcedDelete?.outcomes }
          );
          for (let index = created.actors.length - 1; index >= 0; index -= 1) {
            if (created.actors[index] === guardVictimId) created.actors.splice(index, 1);
          }
        }
      }
    }

    {
      const IMPORT_FAMILIES = [
        {
          family: "actor",
          documentName: "Actor",
          resultKey: "actor",
          cleanup: created.actors,
          foundryFilePathField: "img"
        },
        {
          family: "item",
          documentName: "Item",
          resultKey: "item",
          cleanup: created.items,
          foundryFilePathField: "img"
        },
        { family: "journal", documentName: "JournalEntry", resultKey: "journal", cleanup: created.journals },
        {
          family: "scene",
          documentName: "Scene",
          resultKey: "scene",
          cleanup: created.scenes,
          foundryFilePathField: "thumb"
        },
        {
          family: "macro",
          documentName: "Macro",
          resultKey: "macro",
          cleanup: created.macros,
          foundryFilePathField: "img"
        },
        { family: "playlist", documentName: "Playlist", resultKey: "playlist", cleanup: created.playlists },
        {
          family: "table",
          documentName: "RollTable",
          resultKey: "table",
          cleanup: created.tables,
          foundryFilePathField: "img"
        },
        {
          family: "cards",
          documentName: "Cards",
          resultKey: "cards",
          cleanup: created.cards,
          foundryFilePathField: "img"
        }
      ];

      const packList = expectOk(
        summary,
        "compendium.list(import preflight)",
        runFoundryctl(["compendium", "list", "--limit", "500"])
      );
      const packs = Array.isArray(packList?.packs) ? packList.packs : [];
      const liveFamilies = [];
      const unitOnlyFamilies = [];

      const FIXTURE_REMEDY =
        "install the repo fixture packs (node scripts/fixtures/foundry-test-packs/install.mjs --data-dir <Data>, then enable the module in the world) and re-run";

      for (const spec of IMPORT_FAMILIES) {
        const candidates = packs.filter((row) => row?.type === spec.documentName && row?.id);
        let pack = null;
        let entryId = null;
        const emptyPackIds = [];
        for (const candidate of candidates) {
          const index = runFoundryctl(["compendium", "index", "--pack", candidate.id, "--limit", "1"]);
          const id = index?.response?.result?.entries?.[0]?.id ?? null;
          if (isCommandSuccess(index) && id) {
            pack = candidate;
            entryId = id;
            break;
          }
          emptyPackIds.push(candidate.id);
        }
        if (!pack || !entryId) {
          unitOnlyFamilies.push(spec.family);
          summary.notes.push(
            candidates.length === 0
              ? `${spec.family}.import-from-compendium: this world has NO ${spec.documentName} compendium pack — family covered by unit/router tests only for this run; to live-test it, ${FIXTURE_REMEDY}`
              : `${spec.family}.import-from-compendium: every ${spec.documentName} pack in this world indexed empty (${emptyPackIds.join(", ")}) — family covered by unit/router tests only for this run; to live-test it, ${FIXTURE_REMEDY}`
          );
          continue;
        }
        liveFamilies.push(spec.family);
        const expectedSource = `Compendium.${pack.id}.${spec.documentName}.${entryId}`;
        const importedName = `Smoke Import ${spec.family} ${stamp}`;

        const previewArgs = [
          spec.family,
          "import-from-compendium",
          "--pack",
          pack.id,
          "--entry-id",
          entryId,
          "--name",
          importedName,
          "--dry-run"
        ];
        const preview = expectOk(
          summary,
          `${spec.family}.import-from-compendium(--dry-run)`,
          runFoundryctl(previewArgs)
        );
        const previewDoc = preview?.[spec.resultKey] ?? null;
        markAndPush(
          summary,
          `${spec.family}.import-from-compendium(dry-run previews the merge, mints no id)`,
          preview?.dryRun === true &&
            previewDoc?.id === null &&
            previewDoc?._id === null &&
            previewDoc?.name === importedName &&
            previewDoc?.compendiumSource === expectedSource,
          {
            dryRun: preview?.dryRun,
            id: previewDoc?.id,
            name: previewDoc?.name,
            compendiumSource: previewDoc?.compendiumSource
          }
        );

        if (spec.family === "cards") {
          const rows = Array.isArray(previewDoc?.cards) ? previewDoc.cards : [];
          markAndPush(
            summary,
            "cards.import-from-compendium(dry-run nulls every card id and clears drawn)",
            rows.length > 0 &&
              rows.every((row) => row?.id === null && row?._id === null && row?.drawn === false),
            {
              cardCount: rows.length,
              sample: rows.slice(0, 3).map((row) => ({ id: row?.id, drawn: row?.drawn }))
            }
          );
        }

        const folderRun = runFoundryctl([
          "folder",
          "create",
          "--name",
          `Smoke Import ${spec.family} ${stamp}`,
          "--type",
          spec.documentName
        ]);
        const folderId = isCommandSuccess(folderRun)
          ? (folderRun?.response?.result?.folder?.id ?? null)
          : null;
        if (folderId) created.folders.push(folderId);

        const importArgs = [
          spec.family,
          "import-from-compendium",
          "--pack",
          pack.id,
          "--entry-id",
          entryId,
          "--name",
          importedName
        ];
        if (folderId) importArgs.push("--folder", folderId);
        const imported = expectOk(
          summary,
          `${spec.family}.import-from-compendium`,
          runFoundryctl(importArgs)
        );
        const doc = imported?.[spec.resultKey] ?? null;
        const importedId = doc?.id ?? null;
        if (importedId) spec.cleanup.push(importedId);

        markAndPush(
          summary,
          `${spec.family}.import-from-compendium(compendiumSource in the response)`,
          doc?.compendiumSource === expectedSource &&
            typeof importedId === "string" &&
            importedId.length > 0 &&
            doc?._id === importedId,
          { compendiumSource: doc?.compendiumSource, expected: expectedSource, id: importedId }
        );

        if (importedId) {
          const idFlag = `--${spec.family === "cards" ? "cards" : spec.family}-id`;
          const reread = expectOk(
            summary,
            `${spec.family}.get(after import)`,
            runFoundryctl([spec.family, "get", idFlag, importedId])
          );
          const rereadDoc = reread?.[spec.resultKey] ?? null;
          markAndPush(
            summary,
            `${spec.family}.get(compendiumSource persisted)`,
            rereadDoc?.compendiumSource === expectedSource,
            { compendiumSource: rereadDoc?.compendiumSource, expected: expectedSource }
          );

          if (spec.family === "scene") {
            markAndPush(
              summary,
              "scene.import-from-compendium(imported scene is INACTIVE and claims no nav slot)",
              rereadDoc?.active === false && rereadDoc?.navigation === false,
              { active: rereadDoc?.active, navigation: rereadDoc?.navigation, navOrder: rereadDoc?.navOrder }
            );
          }

          if (spec.family !== "scene") {
            markAndPush(
              summary,
              `${spec.family}.import-from-compendium(folder is the requested one, never the pack's)`,
              folderId ? rereadDoc?.folder === folderId : rereadDoc?.folder === null,
              { folder: rereadDoc?.folder, requested: folderId }
            );
          }
        }

        if (spec.family !== "scene" && folderId) {
          const conflict = runFoundryctl([
            spec.family,
            "import-from-compendium",
            "--pack",
            pack.id,
            "--entry-id",
            entryId,
            "--folder",
            folderId,
            "--patch-json",
            JSON.stringify({ folder: folderId })
          ]);
          expectErr(
            summary,
            `${spec.family}.import-from-compendium(folder via BOTH channels → INVALID_PARAMS)`,
            conflict,
            ERROR_CODES.INVALID_PARAMS
          );
        }

        if (spec.foundryFilePathField) {
          const field = spec.foundryFilePathField;
          for (const modeFlags of [["--dry-run"], []]) {
            const refused = runFoundryctl([
              spec.family,
              "import-from-compendium",
              "--pack",
              pack.id,
              "--entry-id",
              entryId,
              "--patch-json",
              JSON.stringify({ [field]: "smoke-not-an-image.txt" }),
              ...modeFlags
            ]);
            const mode = modeFlags.length ? "--dry-run" : "real call";
            expectErr(
              summary,
              `${spec.family}.import-from-compendium(Foundry-invalid ${field}, ${mode} → INVALID_PARAMS, never INTERNAL_ERROR)`,
              refused,
              ERROR_CODES.INVALID_PARAMS,

              {
                reason: refused?.response?.error?.details?.reason ?? null,
                foundryValidation: refused?.response?.error?.details?.reason === "foundry_validation"
              }
            );
          }
        }
      }

      const itemPack = packs.find((row) => row?.type === "Item");
      if (itemPack?.id) {
        expectErr(
          summary,
          "item.import-from-compendium(bad pack → COMPENDIUM_NOT_FOUND)",
          runFoundryctl([
            "item",
            "import-from-compendium",
            "--pack",
            `world.no-such-pack-${stamp}`,
            "--entry-id",
            "whatever"
          ]),
          ERROR_CODES.COMPENDIUM_NOT_FOUND
        );
        expectErr(
          summary,
          "item.import-from-compendium(bad entry → COMPENDIUM_ENTRY_NOT_FOUND)",
          runFoundryctl([
            "item",
            "import-from-compendium",
            "--pack",
            itemPack.id,
            "--entry-id",
            createMissingId("entry", stamp)
          ]),
          ERROR_CODES.COMPENDIUM_ENTRY_NOT_FOUND
        );

        expectErr(
          summary,
          "item.import-from-compendium(patch._stats → INVALID_PARAMS, closed import patch)",
          runFoundryctl([
            "item",
            "import-from-compendium",
            "--pack",
            itemPack.id,
            "--entry-id",
            "anything",
            "--patch-json",
            JSON.stringify({ _stats: { compendiumSource: "Compendium.fake.Item.spoof" } })
          ]),
          ERROR_CODES.INVALID_PARAMS
        );
      }

      summary.notes.push(
        `*.import-from-compendium coverage split for THIS world: LIVE-imported ${
          liveFamilies.length ? liveFamilies.join("/") : "(none)"
        }; covered by unit/router tests against synthetic packs only ${
          unitOnlyFamilies.length ? unitOnlyFamilies.join("/") : "(none)"
        } — a family in the second list has no POPULATED pack of its type in this world (see its own note above for which), which is a property of the world, not of the bridge. To make it live: node scripts/fixtures/foundry-test-packs/install.mjs --data-dir <Foundry Data dir>, enable "fvtt-world-cli Test Packs (fixture)" in the world once, re-run, then --remove. That fixture ships Playlist + Cards + Scene packs as reviewable JSON compiled into Foundry's real pack layout — never edit the world by hand.`
      );
    }
  } finally {
    for (const { sceneId, tokenId } of created.tokens) {
      expectOk(
        summary,
        "scene.token.delete(cleanup)",
        runFoundryctl(["scene", "token", "delete", "--scene-id", sceneId, "--token-id", tokenId])
      );
    }
    for (const { sceneId, tileId } of created.tiles) {
      expectOk(
        summary,
        "scene.tile.delete(cleanup)",
        runFoundryctl(["scene", "tile", "delete", "--scene-id", sceneId, "--tile-id", tileId])
      );
    }
    for (const { sceneId, soundId } of created.sounds) {
      expectOk(
        summary,
        "scene.sound.delete(cleanup)",
        runFoundryctl(["scene", "sound", "delete", "--scene-id", sceneId, "--sound-id", soundId])
      );
    }
    for (const { sceneId, wallId } of created.walls) {
      expectOk(
        summary,
        "scene.wall.delete(cleanup)",
        runFoundryctl(["scene", "wall", "delete", "--scene-id", sceneId, "--wall-id", wallId])
      );
    }
    for (const { sceneId, noteId } of created.notes) {
      expectOk(
        summary,
        "scene.note.delete(cleanup)",
        runFoundryctl(["scene", "note", "delete", "--scene-id", sceneId, "--note-id", noteId])
      );
    }
    for (const { sceneId, drawingId } of created.drawings) {
      expectOk(
        summary,
        "scene.drawing.delete(cleanup)",
        runFoundryctl(["scene", "drawing", "delete", "--scene-id", sceneId, "--drawing-id", drawingId])
      );
    }
    for (const { sceneId, lightId } of created.lights) {
      expectOk(
        summary,
        "scene.light.delete(cleanup)",
        runFoundryctl(["scene", "light", "delete", "--scene-id", sceneId, "--light-id", lightId])
      );
    }
    for (const { sceneId, templateId } of created.templates) {
      expectOk(
        summary,
        "scene.template.delete(cleanup)",
        runFoundryctl(["scene", "template", "delete", "--scene-id", sceneId, "--template-id", templateId])
      );
    }
    for (const { sceneId, regionId } of created.regions) {
      expectOk(
        summary,
        "scene.region.delete(cleanup)",
        runFoundryctl(["scene", "region", "delete", "--scene-id", sceneId, "--region-id", regionId])
      );
    }

    for (const id of created.playlists) {
      runFoundryctl(["playlist", "stop", "--playlist-id", id]);
      expectOk(
        summary,
        "playlist.delete(cleanup)",
        runFoundryctl(["playlist", "delete", "--playlist-id", id])
      );
    }

    const chatIdsBeforeCardsCleanup = new Set(
      (runFoundryctl(["chat", "list", "--limit", "50"])?.response?.result?.messages ?? [])
        .map((row) => row?.id)
        .filter(Boolean)
    );
    for (const id of created.cards) {
      const cardsCleanup = expectOk(
        summary,
        "cards.delete(cleanup)",
        runFoundryctl(["cards", "delete", "--cards-id", id])
      );
      const recall = cardsCleanup?.recall ?? null;

      if (recall && recall.status !== "confirmed") {
        summary.notes.push(
          `cards.delete(cleanup) reported recall.status "${recall.status}" for ${id} — the stack was deleted but the recall was not confirmed against stored state; re-read the affected stacks with \`fvtt-world-cli cards get\``
        );
      }
      const touchedOthers = [
        ...(recall?.reclaimed ?? []).map((entry) => `${entry.cardsId} (cards deleted there)`),
        ...(recall?.returned ?? []).map((entry) => `${entry.cardsId} (rows returned drawn:false)`)
      ];
      if (touchedOthers.length > 0) {
        summary.notes.push(
          `cards.delete(cleanup) for ${id} also mutated OTHER stacks via Foundry's recall: ${touchedOthers.join(", ")} — this is Foundry's own _preDelete behaviour, not a bridge choice`
        );
      }

      const destroyedCount = recall?.destroyedCardIdsCount ?? (recall?.destroyedCardIds ?? []).length;
      if (destroyedCount > 0) {
        summary.notes.push(
          `cards.delete(cleanup) for ${id} DESTROYED ${destroyedCount} card(s) with nothing returned anywhere (their origin no longer held them) — not undoable`
        );
      }

      for (const entry of recall?.originRowsLeftDrawn ?? []) {
        const strandedCount = entry.cardIdsCount ?? (entry.cardIds ?? []).length;
        summary.notes.push(
          `cards.delete(cleanup) for ${id} LEFT ${strandedCount} row(s) in ${entry.cardsId} stored drawn:true (a deck recall never returns its own cards) — repair by recalling that origin if it is a DECK, otherwise from Foundry's Cards sidebar`
        );
      }
      // The TARGET's own unconfirmed rows are reachable only on a VETOED delete (an error envelope), so a
      // successful cleanup delete can never carry them — but if a module ever refuses one, the note above
      // already fires on `recall.status`, and `error.details.recall.unconfirmed.notRemovedCardIds` is where
      // the duplicate rows would be named.
    }

    if (created.cards.length > 0) {
      const deletedNotificationIds = [];
      const foreignNotificationIds = [];
      let quietRounds = 0;

      for (let attempt = 0; attempt < 12 && quietRounds < 2; attempt += 1) {
        const chatPoll = runFoundryctl(["chat", "list", "--limit", "50"]);
        const rows = chatPoll?.response?.result?.messages;
        const candidates = Array.isArray(rows)
          ? rows.filter(
              (row) =>
                row?.id &&
                !chatIdsBeforeCardsCleanup.has(row.id) &&
                !deletedNotificationIds.includes(row.id) &&
                !foreignNotificationIds.includes(row.id) &&
                typeof row?.contentPreview === "string" &&
                row.contentPreview.includes("cards-notification")
            )
          : [];
        if (candidates.length === 0) {
          quietRounds += 1;
        } else {
          quietRounds = 0;
          for (const row of candidates) {
            const full = runFoundryctl(["chat", "get", "--message-id", row.id]);
            const content = full?.response?.result?.message?.content;
            if (typeof content === "string" && content.includes(stamp)) {
              const deleted = runFoundryctl(["chat", "delete", "--message-id", row.id]);
              if (deleted.response?.ok) deletedNotificationIds.push(row.id);
            } else {
              foreignNotificationIds.push(row.id);
            }
          }
        }
        sleepMs(500);
      }
      markAndPush(
        summary,
        "cards.delete recall notifications collected and deleted (marker poll + quiet window)",
        quietRounds >= 2,
        { deletedNotificationIds, foreignNotificationIds, quietRounds }
      );
      summary.notes.push(
        `cards.delete fired ${deletedNotificationIds.length} unsuppressible recall notification(s) into chat (one per deleted stack, even an empty one — Foundry's own _preDelete calls recall() with no arguments, so the bridge cannot pass its chatNotification:false). All bearing this run's marker were deleted; the poll ended after ${quietRounds} quiet round(s).`
      );
      if (foreignNotificationIds.length > 0) {
        summary.notes.push(
          `chat cleanup left ${foreignNotificationIds.length} card-notification message(s) in place (${foreignNotificationIds.join(", ")}): same CSS class and same window, but NOT this run's marker — a concurrent recall from the Foundry UI or another module. Deleting them would have destroyed someone else's message.`
        );
      }
    }
    for (const id of created.messages) {
      expectOk(summary, "chat.delete(cleanup)", runFoundryctl(["chat", "delete", "--message-id", id]));
    }

    const activeBeforeCleanup = new Set();
    for (const id of created.combats) {
      const combatCleanup = expectOk(
        summary,
        "combat.delete(cleanup)",
        runFoundryctl(["combat", "delete", "--combat-id", id])
      );
      for (const activeId of combatCleanup?.otherActiveCombatIdsBefore ?? [])
        activeBeforeCleanup.add(activeId);
      const activated = combatCleanup?.activatedCombatIds ?? [];
      if (activated.length > 0) {
        summary.notes.push(
          `combat.delete(cleanup) OBSERVED activation of ${activated.join(", ")} as a Foundry side effect (the Combat Tracker's viewed encounter); the bridge cannot suppress it`
        );
      }
    }

    for (const restoreId of created.combatsToReactivate) {
      activeBeforeCleanup.add(restoreId);
      const restore = runFoundryctl(["combat", "activate", "--combat-id", restoreId]);
      if (restore.response?.result?.active === true) {
        summary.notes.push(
          `combat.activate(restore): RE-ACTIVATED ${restoreId}, the encounter this run deactivated when it activated its own scratch combat — the world's active encounter is back as found`
        );
      } else {
        summary.notes.push(
          `combat.activate(restore) FAILED for ${restoreId} (${restore.response?.error?.code ?? "no response"}) — that encounter was active before this run and the smoke deactivated it. Re-activate it manually: \`fvtt-world-cli combat activate --combat-id ${restoreId}\``
        );
      }
    }

    if (created.combats.length > 0) {
      const activeAfterCleanup = runFoundryctl(["combat", "list"]);
      const rows = activeAfterCleanup?.response?.result?.combats;
      if (!Array.isArray(rows)) {
        summary.notes.push(
          "combat.delete(cleanup): could not re-read combat.list to check which encounter Foundry activated — check the Combat Tracker manually"
        );
      } else {
        const newlyActive = rows.filter((row) => row?.active && !activeBeforeCleanup.has(row?.id));
        if (newlyActive.length > 0) {
          summary.notes.push(
            `after combat cleanup these combats are ACTIVE and were NOT active before it (first page of combat.list): ${newlyActive
              .map((row) => `${row.id}${row.name ? ` (${row.name})` : ""}`)
              .join(
                ", "
              )} — deleting a combat makes Foundry activate the Combat Tracker's viewed encounter, un-awaited, which is why the per-delete activatedCombatIds were empty; this is a side effect the run could not undo`
          );
        }
      }
    }

    for (const id of created.tables) {
      expectOk(summary, "table.delete(cleanup)", runFoundryctl(["table", "delete", "--table-id", id]));
    }
    for (const id of created.macros) {
      expectOk(summary, "macro.delete(cleanup)", runFoundryctl(["macro", "delete", "--macro-id", id]));
    }
    for (const id of created.items) {
      expectOk(summary, "item.delete(cleanup)", runFoundryctl(["item", "delete", "--item-id", id]));
    }
    for (const id of created.journals) {
      expectOk(summary, "journal.delete(cleanup)", runFoundryctl(["journal", "delete", "--journal-id", id]));
    }
    for (const id of created.actors) {
      expectOk(
        summary,
        "actor.delete(cleanup)",
        runFoundryctl(["actor", "delete", "--actor-id", id, "--force"])
      );
    }
    for (const id of created.scenes) {
      expectOk(
        summary,
        "scene.delete(cleanup)",
        runFoundryctl(["scene", "delete", "--scene-id", id, "--force"])
      );
    }

    for (const id of [...created.folders].reverse()) {
      expectOk(summary, "folder.delete(cleanup)", runFoundryctl(["folder", "delete", "--folder-id", id]));
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = {
    ok: true,
    environment: {
      actorId: options.actorId,
      baseUrl: options.baseUrl,
      cliConfigHome: localCliConfigHome,
      foundryDataDir: options.foundryDataDir,
      worldId: null
    },
    artifacts: {
      actorItemId: null,
      diskPath: null,
      httpUrl: null,
      itemId: null,
      journalId: null,
      remotePath: null,
      sceneId: null
    },

    notes: [],
    steps: []
  };

  const policyCoverage = createPolicyCoverage();
  let tempDir = null;
  let policyHarness = null;

  try {
    const systemInfoRun = runFoundryctl(["system", "info"]);
    const systemInfoOk = isCommandSuccess(systemInfoRun);
    const actualCommands = systemInfoRun.response?.result?.commands || [];

    markAndPush(summary, "system.info", systemInfoOk, {
      ...summarizeCommand(systemInfoRun),
      world: systemInfoRun.response?.result?.world || null,
      user: systemInfoRun.response?.result?.user || null,
      bridge: systemInfoRun.response?.result?.bridge || null,
      commands: actualCommands
    });

    if (!systemInfoOk) {
      return { options, summary };
    }

    const worldId = systemInfoRun.response.result.world.id;
    summary.environment.worldId = worldId;

    const foundryGeneration = systemInfoRun.response?.result?.foundry?.generation ?? null;
    const isV14 = typeof foundryGeneration === "number" && foundryGeneration >= 14;
    summary.environment.foundryGeneration = foundryGeneration;

    const inventory = compareCommandInventory(actualCommands);
    markAndPush(summary, "system.info(commands)", inventory.passed, {
      expectedCount: inventory.expected.length,
      actualCount: inventory.actual.length,
      missing: inventory.missing,
      unexpected: inventory.unexpected
    });

    policyHarness = await preparePolicyHarness(summary, options, policyCoverage);
    if (!policyHarness.ready) {
      return { options, summary };
    }

    const actorFixtureOk = typeof options.actorId === "string" && options.actorId.length > 0;
    markAndPush(summary, "actor.fixture", actorFixtureOk, {
      actorId: options.actorId,
      reason: actorFixtureOk
        ? null
        : "Provide --actor-id or FVTT_WORLD_CLI_TEST_ACTOR_ID to cover actor.item.* commands"
    });

    if (!actorFixtureOk) {
      return { options, summary };
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sceneUpdatedNameSuffix = ` [smoke ${stamp}]`;
    const createdItemName = `CLI Smoke Item ${stamp}`;
    const updatedItemName = `CLI Smoke Item Updated ${stamp}`;
    const createdJournalName = `CLI Smoke Journal ${stamp}`;
    const updatedJournalName = `CLI Smoke Journal Updated ${stamp}`;
    const createdActorItemName = `CLI Smoke Actor Item ${stamp}`;
    const updatedActorItemName = `CLI Smoke Actor Item Updated ${stamp}`;

    const systemPingRun = runFoundryctl(["system", "ping"]);
    const systemPingOk = Boolean(systemPingRun.response?.ok && systemPingRun.response?.result?.pong === true);
    markAndPush(summary, "system.ping", systemPingOk, {
      ...summarizeCommand(systemPingRun),
      result: systemPingRun.response?.result || null
    });

    const sceneListRun = runFoundryctl(["scene", "list"]);
    const scenes = sceneListRun.response?.result?.scenes || [];
    const sceneListOk = Boolean(sceneListRun.response?.ok && scenes.length > 0);
    markAndPush(summary, "scene.list", sceneListOk, {
      ...summarizeCommand(sceneListRun),
      count: scenes.length
    });

    const targetScene = scenes.find((scene) => scene.active) || scenes[0] || null;
    if (!targetScene) {
      markAndPush(summary, "scene.get", false, { reason: "No scenes available" });
      markAndPush(summary, "scene.update", false, { skipped: true, reason: "No scenes available" });
      markAndPush(summary, "scene.get(updated)", false, { skipped: true, reason: "No scenes available" });
      markAndPush(summary, "scene.restore", false, { skipped: true, reason: "No scenes available" });
    } else {
      summary.artifacts.sceneId = targetScene.id;
      const sceneGetRun = runFoundryctl(["scene", "get", "--scene-id", targetScene.id]);
      const originalScene = sceneGetRun.response?.result?.scene || null;
      const originalSceneName = originalScene?.name || targetScene.name || null;

      const originalTokenVision = originalScene?.tokenVision;
      const originalPadding = originalScene?.padding;
      const originalEnvironment = originalScene?.environment ?? null;

      const originalForeground = originalScene?.foreground ?? null;
      const originalForegroundElevation = originalScene?.foregroundElevation ?? null;
      const sceneGetOk = Boolean(sceneGetRun.response?.ok && originalScene?.id === targetScene.id);
      markAndPush(summary, "scene.get", sceneGetOk, {
        ...summarizeCommand(sceneGetRun),
        sceneId: targetScene.id,
        sceneName: originalSceneName
      });

      const updatedSceneName = `${originalSceneName || "Scene"}${sceneUpdatedNameSuffix}`;

      const updatedTokenVision = !(originalTokenVision ?? false);
      const updatedPadding = 0.3;
      const updatedForeground = "worlds/w/foreground-smoke.webp";
      const updatedForegroundElevation = 20;

      const sceneUpdateArgs = [
        "scene",
        "update",
        "--scene-id",
        targetScene.id,
        "--name",
        updatedSceneName,
        "--token-vision",
        String(updatedTokenVision),
        "--padding",
        String(updatedPadding),
        "--environment-json",
        JSON.stringify({ darknessLevel: 0.75 })
      ];
      if (!isV14) {
        sceneUpdateArgs.push(
          "--foreground",
          updatedForeground,
          "--foreground-elevation",
          String(updatedForegroundElevation)
        );
      }
      const sceneUpdateRun = runFoundryctl(sceneUpdateArgs);
      const updatedSceneResult = sceneUpdateRun.response?.result?.scene || null;
      const sceneUpdateOk = Boolean(
        sceneUpdateRun.response?.ok &&
        updatedSceneResult?.name === updatedSceneName &&
        updatedSceneResult?.tokenVision === updatedTokenVision &&
        (isV14 ||
          (updatedSceneResult?.foreground === updatedForeground &&
            updatedSceneResult?.foregroundElevation === updatedForegroundElevation)) &&
        updatedSceneResult?.environment?.darknessLevel === 0.75
      );
      markAndPush(summary, "scene.update", sceneUpdateOk, {
        ...summarizeCommand(sceneUpdateRun),
        sceneId: targetScene.id,
        expectedName: updatedSceneName,
        sceneName: updatedSceneResult?.name || null,
        tokenVision: updatedSceneResult?.tokenVision ?? null,
        padding: updatedSceneResult?.padding ?? null,
        foreground: updatedSceneResult?.foreground ?? null,
        foregroundElevation: updatedSceneResult?.foregroundElevation ?? null,
        foregroundAsserted: isV14 ? "skipped (v14: gated, asserted separately)" : "round-trip",
        environmentDarknessLevel: updatedSceneResult?.environment?.darknessLevel ?? null
      });

      if (isV14) {
        expectErr(
          summary,
          "scene.update(foreground v14 gate)",
          runFoundryctl(["scene", "update", "--scene-id", targetScene.id, "--foreground", updatedForeground]),
          ERROR_CODES.UNSUPPORTED_OPERATION
        );
        expectErr(
          summary,
          "scene.update(background v14 gate)",
          runFoundryctl([
            "scene",
            "update",
            "--scene-id",
            targetScene.id,
            "--patch-json",
            JSON.stringify({ background: { src: "worlds/w/bg-smoke.webp" } })
          ]),
          ERROR_CODES.UNSUPPORTED_OPERATION
        );
        expectErr(
          summary,
          "scene.update(backgroundColor v14 gate)",
          runFoundryctl([
            "scene",
            "update",
            "--scene-id",
            targetScene.id,
            "--patch-json",
            JSON.stringify({ backgroundColor: "#112233" })
          ]),
          ERROR_CODES.UNSUPPORTED_OPERATION
        );
        expectErr(
          summary,
          "scene.update(fog.overlay v14 gate)",
          runFoundryctl([
            "scene",
            "update",
            "--scene-id",
            targetScene.id,
            "--patch-json",
            JSON.stringify({ fog: { overlay: "worlds/w/fog-smoke.webp" } })
          ]),
          ERROR_CODES.UNSUPPORTED_OPERATION
        );
      }

      markAndPush(summary, "scene.update(playlist-link)", true, {
        skipped: true,
        reason: "Playlist command family lands in C2; no known playlist id to link in C1"
      });

      const sceneGetUpdatedRun = runFoundryctl(["scene", "get", "--scene-id", targetScene.id]);
      const sceneGetUpdatedOk = Boolean(
        sceneGetUpdatedRun.response?.ok &&
        sceneGetUpdatedRun.response?.result?.scene?.name === updatedSceneName
      );
      markAndPush(summary, "scene.get(updated)", sceneGetUpdatedOk, {
        ...summarizeCommand(sceneGetUpdatedRun),
        sceneId: targetScene.id,
        sceneName: sceneGetUpdatedRun.response?.result?.scene?.name || null
      });

      const shouldRestoreScene = Boolean(sceneUpdateRun.response?.ok || sceneGetUpdatedOk);
      if (shouldRestoreScene && originalSceneName) {
        const restoreArgs = ["scene", "update", "--scene-id", targetScene.id, "--name", originalSceneName];
        if (typeof originalTokenVision === "boolean") {
          restoreArgs.push("--token-vision", String(originalTokenVision));
        }
        if (typeof originalPadding === "number") {
          restoreArgs.push("--padding", String(originalPadding));
        }
        if (originalEnvironment && typeof originalEnvironment === "object") {
          restoreArgs.push("--environment-json", JSON.stringify(originalEnvironment));
        }

        if (!isV14) {
          const foregroundRestorePatch = {};
          if (typeof originalForeground === "string" && originalForeground) {
            restoreArgs.push("--foreground", originalForeground);
          } else {
            foregroundRestorePatch.foreground = null;
          }
          if (typeof originalForegroundElevation === "number") {
            restoreArgs.push("--foreground-elevation", String(originalForegroundElevation));
          } else {
            foregroundRestorePatch.foregroundElevation = null;
          }
          if (Object.keys(foregroundRestorePatch).length) {
            restoreArgs.push("--patch-json", JSON.stringify(foregroundRestorePatch));
          }
        }
        const sceneRestoreRun = runFoundryctl(restoreArgs);
        const sceneRestoreOk = Boolean(
          sceneRestoreRun.response?.ok && sceneRestoreRun.response?.result?.scene?.name === originalSceneName
        );
        markAndPush(summary, "scene.restore", sceneRestoreOk, {
          ...summarizeCommand(sceneRestoreRun),
          sceneId: targetScene.id,
          restoredName: sceneRestoreRun.response?.result?.scene?.name || null,
          expectedName: originalSceneName
        });
      } else {
        markAndPush(summary, "scene.restore", false, {
          skipped: true,
          reason: "Scene was not updated or original name was unavailable"
        });
      }
    }

    const itemListRun = runFoundryctl(["item", "list"]);
    const listedItems = itemListRun.response?.result?.items || [];
    const itemListOk = isCommandSuccess(itemListRun);
    markAndPush(summary, "item.list", itemListOk, {
      ...summarizeCommand(itemListRun),
      count: listedItems.length
    });

    const itemCreateRun = runFoundryctl([
      "item",
      "create",
      "--name",
      createdItemName,
      "--type",
      "loot",
      "--img",
      "icons/svg/torch.svg",
      "--system-json",
      JSON.stringify({ quantity: 1, source: { custom: "cli-smoke-create" } })
    ]);
    const createdItem = itemCreateRun.response?.result?.item || null;
    const createdItemId = createdItem?.id || null;
    summary.artifacts.itemId = createdItemId;
    const itemCreateOk = Boolean(
      itemCreateRun.response?.ok &&
      createdItemId &&
      createdItem?.name === createdItemName &&
      createdItem?.system?.quantity === 1 &&
      createdItem?.system?.source?.custom === "cli-smoke-create"
    );
    markAndPush(summary, "item.create", itemCreateOk, {
      ...summarizeCommand(itemCreateRun),
      itemId: createdItemId,
      itemName: createdItem?.name || null,
      quantity: createdItem?.system?.quantity ?? null
    });

    if (!createdItemId) {
      markAndPush(summary, "item.update", false, { skipped: true, reason: "item.create failed" });
      markAndPush(summary, "item.get", false, { skipped: true, reason: "item.create failed" });
    } else {
      const itemUpdateRun = runFoundryctl([
        "item",
        "update",
        "--item-id",
        createdItemId,
        "--name",
        updatedItemName,
        "--system-json",
        JSON.stringify({ quantity: 2, source: { custom: "cli-smoke-update" } })
      ]);
      const itemUpdate = itemUpdateRun.response?.result?.item || null;
      const itemUpdateOk = Boolean(
        itemUpdateRun.response?.ok &&
        itemUpdate?.name === updatedItemName &&
        itemUpdate?.system?.quantity === 2 &&
        itemUpdate?.system?.source?.custom === "cli-smoke-update"
      );
      markAndPush(summary, "item.update", itemUpdateOk, {
        ...summarizeCommand(itemUpdateRun),
        itemId: createdItemId,
        itemName: itemUpdate?.name || null,
        quantity: itemUpdate?.system?.quantity ?? null
      });

      const itemGetRun = runFoundryctl(["item", "get", "--item-id", createdItemId]);
      const fetchedItem = itemGetRun.response?.result?.item || null;
      const itemGetOk = Boolean(
        itemGetRun.response?.ok &&
        fetchedItem?.id === createdItemId &&
        fetchedItem?.name === updatedItemName &&
        fetchedItem?.system?.quantity === 2 &&
        fetchedItem?.system?.source?.custom === "cli-smoke-update"
      );
      markAndPush(summary, "item.get", itemGetOk, {
        ...summarizeCommand(itemGetRun),
        itemId: createdItemId,
        itemName: fetchedItem?.name || null,
        quantity: fetchedItem?.system?.quantity ?? null
      });
    }

    const journalCreateRun = runFoundryctl([
      "journal",
      "create",
      "--name",
      createdJournalName,
      "--pages-json",
      JSON.stringify([
        {
          name: "Entry 1",
          type: "text",
          text: {
            content: `Smoke journal create ${stamp}`
          }
        }
      ])
    ]);
    const createdJournal = journalCreateRun.response?.result?.journal || null;
    const createdJournalId = createdJournal?.id || null;
    summary.artifacts.journalId = createdJournalId;
    const createdJournalPage = createdJournal?.pages?.[0] || null;
    const journalCreateOk = Boolean(
      journalCreateRun.response?.ok &&
      createdJournalId &&
      createdJournal?.name === createdJournalName &&
      createdJournal?.pages?.length === 1 &&
      createdJournalPage?.text?.content === `Smoke journal create ${stamp}`
    );
    markAndPush(summary, "journal.create", journalCreateOk, {
      ...summarizeCommand(journalCreateRun),
      journalId: createdJournalId,
      journalName: createdJournal?.name || null,
      pageCount: createdJournal?.pages?.length || 0
    });

    const journalListRun = runFoundryctl(["journal", "list"]);
    const journals = journalListRun.response?.result?.journals || [];
    const listedJournal = findById(journals, createdJournalId);
    const journalListOk = Boolean(journalListRun.response?.ok && listedJournal?.id === createdJournalId);
    markAndPush(summary, "journal.list", journalListOk, {
      ...summarizeCommand(journalListRun),
      count: journals.length,
      createdJournalPresent: Boolean(listedJournal)
    });

    if (!createdJournalId) {
      markAndPush(summary, "journal.get", false, { skipped: true, reason: "journal.create failed" });
      markAndPush(summary, "journal.update", false, { skipped: true, reason: "journal.create failed" });
      markAndPush(summary, "journal.get(updated)", false, { skipped: true, reason: "journal.create failed" });
    } else {
      const journalGetRun = runFoundryctl(["journal", "get", "--journal-id", createdJournalId]);
      const fetchedJournal = journalGetRun.response?.result?.journal || null;
      const journalGetOk = Boolean(
        journalGetRun.response?.ok &&
        fetchedJournal?.id === createdJournalId &&
        fetchedJournal?.pages?.[0]?.text?.content === `Smoke journal create ${stamp}`
      );
      markAndPush(summary, "journal.get", journalGetOk, {
        ...summarizeCommand(journalGetRun),
        journalId: createdJournalId,
        journalName: fetchedJournal?.name || null,
        pageCount: fetchedJournal?.pages?.length || 0
      });

      const existingPageId = fetchedJournal?.pages?.[0]?.id || createdJournalPage?.id || null;
      if (!existingPageId) {
        markAndPush(summary, "journal.update", false, {
          skipped: true,
          reason: "journal.get did not return a page id for the created journal"
        });
        markAndPush(summary, "journal.get(updated)", false, {
          skipped: true,
          reason: "journal.get did not return a page id for the created journal"
        });
      } else {
        const journalUpdateRun = runFoundryctl([
          "journal",
          "update",
          "--journal-id",
          createdJournalId,
          "--name",
          updatedJournalName,
          "--pages-json",
          JSON.stringify([
            {
              id: existingPageId,
              text: {
                content: `Smoke journal update ${stamp}`
              }
            },
            {
              name: "Entry 2",
              type: "text",
              text: {
                content: `Smoke journal second page ${stamp}`
              }
            }
          ])
        ]);
        const updatedJournal = journalUpdateRun.response?.result?.journal || null;
        const updatedExistingPage = updatedJournal?.pages?.find((page) => page.id === existingPageId) || null;
        const createdSecondPage = updatedJournal?.pages?.find((page) => page.name === "Entry 2") || null;
        const journalUpdateOk = Boolean(
          journalUpdateRun.response?.ok &&
          updatedJournal?.name === updatedJournalName &&
          updatedExistingPage?.text?.content === `Smoke journal update ${stamp}` &&
          createdSecondPage?.text?.content === `Smoke journal second page ${stamp}` &&
          updatedJournal?.pages?.length === 2
        );
        markAndPush(summary, "journal.update", journalUpdateOk, {
          ...summarizeCommand(journalUpdateRun),
          journalId: createdJournalId,
          journalName: updatedJournal?.name || null,
          pageCount: updatedJournal?.pages?.length || 0
        });

        const journalGetUpdatedRun = runFoundryctl(["journal", "get", "--journal-id", createdJournalId]);
        const fetchedUpdatedJournal = journalGetUpdatedRun.response?.result?.journal || null;
        const updatedFetchedExistingPage =
          fetchedUpdatedJournal?.pages?.find((page) => page.id === existingPageId) || null;
        const updatedFetchedSecondPage =
          fetchedUpdatedJournal?.pages?.find((page) => page.name === "Entry 2") || null;
        const journalGetUpdatedOk = Boolean(
          journalGetUpdatedRun.response?.ok &&
          fetchedUpdatedJournal?.name === updatedJournalName &&
          updatedFetchedExistingPage?.text?.content === `Smoke journal update ${stamp}` &&
          updatedFetchedSecondPage?.text?.content === `Smoke journal second page ${stamp}`
        );
        markAndPush(summary, "journal.get(updated)", journalGetUpdatedOk, {
          ...summarizeCommand(journalGetUpdatedRun),
          journalId: createdJournalId,
          journalName: fetchedUpdatedJournal?.name || null,
          pageCount: fetchedUpdatedJournal?.pages?.length || 0
        });
      }
    }

    const actorItemListRun = runFoundryctl(["actor", "item", "list", "--actor-id", options.actorId]);
    const actorItems = actorItemListRun.response?.result?.items || [];
    const actorItemListOk = Boolean(
      actorItemListRun.response?.ok && actorItemListRun.response?.result?.actorId === options.actorId
    );
    markAndPush(summary, "actor.item.list", actorItemListOk, {
      ...summarizeCommand(actorItemListRun),
      actorId: actorItemListRun.response?.result?.actorId || options.actorId,
      count: actorItems.length
    });

    const actorItemCreateRun = runFoundryctl([
      "actor",
      "item",
      "create",
      "--actor-id",
      options.actorId,
      "--name",
      createdActorItemName,
      "--type",
      "loot",
      "--system-json",
      JSON.stringify({ quantity: 1, source: { custom: "cli-smoke-actor-create" } })
    ]);
    const createdActorItem = actorItemCreateRun.response?.result?.item || null;
    const createdActorItemId = createdActorItem?.id || null;
    summary.artifacts.actorItemId = createdActorItemId;
    const actorItemCreateOk = Boolean(
      actorItemCreateRun.response?.ok &&
      actorItemCreateRun.response?.result?.actorId === options.actorId &&
      createdActorItemId &&
      createdActorItem?.name === createdActorItemName &&
      createdActorItem?.system?.quantity === 1
    );
    markAndPush(summary, "actor.item.create", actorItemCreateOk, {
      ...summarizeCommand(actorItemCreateRun),
      actorId: actorItemCreateRun.response?.result?.actorId || options.actorId,
      itemId: createdActorItemId,
      itemName: createdActorItem?.name || null
    });

    if (!createdActorItemId) {
      markAndPush(summary, "actor.item.update", false, {
        skipped: true,
        reason: "actor.item.create failed"
      });
      markAndPush(summary, "actor.item.list(updated)", false, {
        skipped: true,
        reason: "actor.item.create failed"
      });
      markAndPush(summary, "actor.item.get(updated)", false, {
        skipped: true,
        reason: "actor.item.create failed"
      });
    } else {
      const actorItemUpdateRun = runFoundryctl([
        "actor",
        "item",
        "update",
        "--actor-id",
        options.actorId,
        "--item-id",
        createdActorItemId,
        "--name",
        updatedActorItemName,
        "--system-json",
        JSON.stringify({ quantity: 2, source: { custom: "cli-smoke-actor-update" } })
      ]);
      const updatedActorItem = actorItemUpdateRun.response?.result?.item || null;
      const actorItemUpdateOk = Boolean(
        actorItemUpdateRun.response?.ok &&
        actorItemUpdateRun.response?.result?.actorId === options.actorId &&
        updatedActorItem?.id === createdActorItemId &&
        updatedActorItem?.name === updatedActorItemName &&
        updatedActorItem?.system?.quantity === 2 &&
        updatedActorItem?.system?.source?.custom === "cli-smoke-actor-update"
      );
      markAndPush(summary, "actor.item.update", actorItemUpdateOk, {
        ...summarizeCommand(actorItemUpdateRun),
        actorId: actorItemUpdateRun.response?.result?.actorId || options.actorId,
        itemId: createdActorItemId,
        itemName: updatedActorItem?.name || null
      });

      const actorItemListUpdatedRun = runFoundryctl(["actor", "item", "list", "--actor-id", options.actorId]);
      const updatedActorItems = actorItemListUpdatedRun.response?.result?.items || [];
      const listedActorItem = findById(updatedActorItems, createdActorItemId);
      const actorItemListUpdatedOk = Boolean(
        actorItemListUpdatedRun.response?.ok &&
        actorItemListUpdatedRun.response?.result?.actorId === options.actorId &&
        listedActorItem?.name === updatedActorItemName
      );
      markAndPush(summary, "actor.item.list(updated)", actorItemListUpdatedOk, {
        ...summarizeCommand(actorItemListUpdatedRun),
        actorId: actorItemListUpdatedRun.response?.result?.actorId || options.actorId,
        count: updatedActorItems.length,
        createdItemPresent: Boolean(listedActorItem)
      });

      const actorItemGetUpdatedRun = runFoundryctl([
        "actor",
        "item",
        "get",
        "--actor-id",
        options.actorId,
        "--item-id",
        createdActorItemId
      ]);
      const gotUpdatedActorItem = actorItemGetUpdatedRun.response?.result?.item || null;
      const actorItemGetUpdatedOk = Boolean(
        actorItemGetUpdatedRun.response?.ok &&
        actorItemGetUpdatedRun.response?.result?.actorId === options.actorId &&
        gotUpdatedActorItem?.id === createdActorItemId &&
        gotUpdatedActorItem?.name === updatedActorItemName &&
        gotUpdatedActorItem?.system?.quantity === 2 &&
        gotUpdatedActorItem?.system?.source?.custom === "cli-smoke-actor-update"
      );
      markAndPush(summary, "actor.item.get(updated)", actorItemGetUpdatedOk, {
        ...summarizeCommand(actorItemGetUpdatedRun),
        actorId: actorItemGetUpdatedRun.response?.result?.actorId || options.actorId,
        itemId: createdActorItemId,
        itemName: gotUpdatedActorItem?.name || null
      });
    }

    const fileListRootRun = runFoundryctl(["file", "list"]);
    const fileListRootOk = Boolean(
      fileListRootRun.response?.ok && Array.isArray(fileListRootRun.response?.result?.entries)
    );
    markAndPush(summary, "file.list(root)", fileListRootOk, {
      ...summarizeCommand(fileListRootRun),
      count: fileListRootRun.response?.result?.entries?.length || 0,
      directory: fileListRootRun.response?.result?.directory || null
    });

    const rootDir = `worlds/${worldId}/fvtt-world-cli`;
    const baseDir = `${rootDir}/smoke`;
    const testDir = `${baseDir}/${stamp}`;
    const remotePath = `${testDir}/roundtrip.txt`;
    summary.artifacts.remotePath = remotePath;

    const mkdirRootRun = runFoundryctl(["file", "mkdir", "--path", rootDir]);
    const mkdirRootOk = Boolean(
      mkdirRootRun.response?.ok && mkdirRootRun.response?.result?.directory?.path === rootDir
    );
    markAndPush(summary, "file.mkdir(root)", mkdirRootOk, {
      ...summarizeCommand(mkdirRootRun),
      path: rootDir
    });

    const mkdirBaseRun = runFoundryctl(["file", "mkdir", "--path", baseDir]);
    const mkdirBaseOk = Boolean(
      mkdirBaseRun.response?.ok && mkdirBaseRun.response?.result?.directory?.path === baseDir
    );
    markAndPush(summary, "file.mkdir(base)", mkdirBaseOk, {
      ...summarizeCommand(mkdirBaseRun),
      path: baseDir
    });

    const mkdirRun = runFoundryctl(["file", "mkdir", "--path", testDir]);
    const mkdirOk = Boolean(mkdirRun.response?.ok && mkdirRun.response?.result?.directory?.path === testDir);
    markAndPush(summary, "file.mkdir(test)", mkdirOk, {
      ...summarizeCommand(mkdirRun),
      path: testDir
    });

    tempDir = mkdtempSync(join(tmpdir(), "fvtt-world-cli-live-smoke-"));
    const localPath = join(tempDir, "roundtrip.txt");
    const expectedContent = createRoundtripContent(stamp, worldId);
    const expectedBuffer = Buffer.from(expectedContent, "utf8");
    writeFileSync(localPath, expectedBuffer);

    const uploadRun = runFoundryctl([
      "file",
      "upload",
      "--path",
      remotePath,
      "--from-file",
      localPath,
      "--mime-type",
      "text/plain"
    ]);
    const uploadedFile = uploadRun.response?.result?.file || null;
    const uploadOk = Boolean(
      uploadRun.response?.ok &&
      uploadedFile?.path === remotePath &&
      uploadedFile?.kind === "file" &&
      uploadedFile?.size === expectedBuffer.length
    );
    markAndPush(summary, "file.upload", uploadOk, {
      ...summarizeCommand(uploadRun),
      path: remotePath,
      file: uploadedFile
    });

    const sizeMatches = (actual) => actual == null || actual === expectedBuffer.length;

    const fileListRun = runFoundryctl(["file", "list", "--path", testDir]);
    const listedEntry =
      fileListRun.response?.result?.entries?.find((entry) => entry.path === remotePath) || null;
    const fileListOk = Boolean(
      fileListRun.response?.ok &&
      listedEntry?.kind === "file" &&
      sizeMatches(listedEntry?.size) &&
      listedEntry?.extension === "txt"
    );
    markAndPush(summary, "file.list(test)", fileListOk, {
      ...summarizeCommand(fileListRun),
      entry: listedEntry
    });

    const statRun = runFoundryctl(["file", "stat", "--path", remotePath]);
    const statEntry = statRun.response?.result?.entry || null;
    const statOk = Boolean(
      statRun.response?.ok &&
      statEntry?.kind === "file" &&
      sizeMatches(statEntry?.size) &&
      statEntry?.path === remotePath
    );
    markAndPush(summary, "file.stat", statOk, {
      ...summarizeCommand(statRun),
      expectedSize: expectedBuffer.length,
      entry: statEntry
    });

    const readTextRun = runFoundryctl(["file", "read", "--path", remotePath, "--encoding", "text"]);
    const readTextOk = Boolean(
      readTextRun.response?.ok &&
      readTextRun.response?.result?.encoding === "text" &&
      readTextRun.response?.result?.file?.path === remotePath &&
      readTextRun.response?.result?.content === expectedContent
    );
    markAndPush(summary, "file.read(text)", readTextOk, {
      ...summarizeCommand(readTextRun),
      contentMatches: readTextRun.response?.result?.content === expectedContent
    });

    const readBase64Run = runFoundryctl(["file", "read", "--path", remotePath, "--encoding", "base64"]);
    const remoteBase64 = readBase64Run.response?.result?.content || null;
    const remoteBuffer = remoteBase64 ? Buffer.from(remoteBase64, "base64") : null;
    const readBase64Ok = Boolean(
      readBase64Run.response?.ok &&
      readBase64Run.response?.result?.encoding === "base64" &&
      readBase64Run.response?.result?.file?.path === remotePath &&
      remoteBuffer?.equals(expectedBuffer)
    );
    markAndPush(summary, "file.read(base64)", readBase64Ok, {
      ...summarizeCommand(readBase64Run),
      bytesMatch: Boolean(remoteBuffer?.equals(expectedBuffer))
    });

    const diskPath = relativePathToDiskPath(options.foundryDataDir, remotePath);
    summary.artifacts.diskPath = diskPath;
    if (existsSync(diskPath)) {
      const diskBuffer = readFileSync(diskPath);
      const diskMatches = diskBuffer.equals(expectedBuffer);
      markAndPush(summary, "disk.roundtrip", diskMatches, {
        path: diskPath,
        expectedSha256: sha256(expectedBuffer),
        actualSha256: sha256(diskBuffer),
        bytesMatch: diskMatches
      });
    } else {
      markAndPush(summary, "disk.roundtrip", false, { path: diskPath, reason: "File not found on disk" });
    }

    const httpUrl = `${options.baseUrl.replace(/\/$/u, "")}/${remotePath}`;
    summary.artifacts.httpUrl = httpUrl;
    try {
      const response = await fetch(httpUrl);
      const httpText = response.ok ? await response.text() : null;
      const httpMatches = response.ok && httpText === expectedContent;
      markAndPush(summary, "http.roundtrip", httpMatches, {
        url: httpUrl,
        status: response.status,
        textMatches: httpText === expectedContent
      });
    } catch (error) {
      markAndPush(summary, "http.roundtrip", false, {
        url: httpUrl,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const advertisedUploadBytes = systemInfoRun.response?.result?.limits?.uploadBytes;
    markAndPush(
      summary,
      "system.info(limits.uploadBytes present)",
      typeof advertisedUploadBytes === "number" && advertisedUploadBytes > 0,
      {
        uploadBytes: advertisedUploadBytes ?? null,
        wsMaxPayloadBytes: systemInfoRun.response?.result?.limits?.wsMaxPayloadBytes ?? null
      }
    );

    const bigLocalPath = join(tempDir, "big-blob.txt");

    const bigBuffer = Buffer.alloc(10 * 1024 * 1024);
    for (let i = 0; i < bigBuffer.length; i += 1) bigBuffer[i] = 0x20 + ((i * 2654435761) & 0x5e);
    writeFileSync(bigLocalPath, bigBuffer);
    const bigRemotePath = `${testDir}/big-blob.txt`;
    const bigUploadRun = runFoundryctl([
      "file",
      "upload",
      "--path",
      bigRemotePath,
      "--from-file",
      bigLocalPath,
      "--mime-type",
      "text/plain"
    ]);
    const bigUploadOk = Boolean(
      bigUploadRun.response?.ok &&
      bigUploadRun.response?.result?.file?.path === bigRemotePath &&
      bigUploadRun.response?.result?.file?.size === bigBuffer.length
    );
    markAndPush(summary, "file.upload(>8 MiB proves default limit)", bigUploadOk, {
      ...summarizeCommand(bigUploadRun),
      sizeBytes: bigBuffer.length,
      advertisedUploadBytes: advertisedUploadBytes ?? null
    });
    const bigHttpUrl = `${options.baseUrl.replace(/\/$/u, "")}/${bigRemotePath}`;
    try {
      const response = await fetch(bigHttpUrl);
      const httpBuffer = response.ok ? Buffer.from(await response.arrayBuffer()) : null;
      const bigHashMatches = Boolean(httpBuffer && sha256(httpBuffer) === sha256(bigBuffer));
      markAndPush(summary, "http.roundtrip(>8 MiB hash)", bigHashMatches, {
        url: bigHttpUrl,
        status: response.status,
        expectedSha256: sha256(bigBuffer),
        actualSha256: httpBuffer ? sha256(httpBuffer) : null
      });
    } catch (error) {
      markAndPush(summary, "http.roundtrip(>8 MiB hash)", false, {
        url: bigHttpUrl,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const specialLiteralName = "It's a (test) #1.ogg";
    const specialLocalPath = join(tempDir, "special.ogg");
    const specialContent = createRoundtripContent(`${stamp}-special`, worldId);
    const specialBuffer = Buffer.from(specialContent, "utf8");
    writeFileSync(specialLocalPath, specialBuffer);
    const specialLiteralPath = `${testDir}/${specialLiteralName}`;

    const specialUploadRun = runFoundryctl([
      "file",
      "upload",
      "--path",
      specialLiteralPath,
      "--from-file",
      specialLocalPath,
      "--mime-type",
      "audio/ogg"
    ]);

    const specialStoredPath = specialUploadRun.response?.result?.file?.path || null;
    markAndPush(
      summary,
      "file.upload(literal special-char name)",
      Boolean(specialUploadRun.response?.ok && specialStoredPath),
      {
        ...summarizeCommand(specialUploadRun),
        literalPath: specialLiteralPath,
        storedPath: specialStoredPath
      }
    );

    const specialListRun = runFoundryctl(["file", "list", "--path", testDir]);
    const specialBrowseEntry =
      specialListRun.response?.result?.entries?.find((entry) => entry.path === specialStoredPath) || null;
    markAndPush(
      summary,
      "file.list(special-char stored form matches upload)",
      Boolean(specialBrowseEntry && specialBrowseEntry.kind === "file"),
      {
        browsePath: specialBrowseEntry?.path ?? null,
        storedPath: specialStoredPath
      }
    );

    const specialStatRun = runFoundryctl(["file", "stat", "--path", specialLiteralPath]);
    markAndPush(
      summary,
      "file.stat(literal special-char name)",
      Boolean(specialStatRun.response?.ok && specialStatRun.response?.result?.entry?.kind === "file"),
      {
        ...summarizeCommand(specialStatRun)
      }
    );
    const specialReadRun = runFoundryctl([
      "file",
      "read",
      "--path",
      specialLiteralPath,
      "--encoding",
      "base64"
    ]);
    const specialReadBuffer = specialReadRun.response?.result?.content
      ? Buffer.from(specialReadRun.response.result.content, "base64")
      : null;
    markAndPush(
      summary,
      "file.read(literal special-char name)",
      Boolean(specialReadRun.response?.ok && specialReadBuffer?.equals(specialBuffer)),
      {
        ...summarizeCommand(specialReadRun),
        bytesMatch: Boolean(specialReadBuffer?.equals(specialBuffer))
      }
    );

    const specialPlaylistRun = runFoundryctl(["playlist", "create", "--name", `smoke-canon-${stamp}`]);
    const specialPlaylistId = specialPlaylistRun.response?.result?.playlist?.id ?? null;
    markAndPush(
      summary,
      "playlist.create(canon fixture)",
      Boolean(specialPlaylistRun.response?.ok && specialPlaylistId),
      {
        ...summarizeCommand(specialPlaylistRun)
      }
    );
    if (specialPlaylistId) {
      const soundCreateRun = runFoundryctl([
        "playlist",
        "sound",
        "create",
        "--playlist-id",
        specialPlaylistId,
        "--path",
        specialLiteralPath
      ]);
      const storedSoundPath = soundCreateRun.response?.result?.sound?.path ?? null;
      markAndPush(
        summary,
        "playlist.sound.create(literal path stores browse-canonical form)",
        Boolean(soundCreateRun.response?.ok && storedSoundPath && storedSoundPath === specialStoredPath),
        {
          ...summarizeCommand(soundCreateRun),
          literalPath: specialLiteralPath,
          storedSoundPath,
          browseStoredPath: specialStoredPath
        }
      );
      expectOk(
        summary,
        "playlist.delete(canon fixture cleanup)",
        runFoundryctl(["playlist", "delete", "--playlist-id", specialPlaylistId])
      );
    }

    const imageLiteralName = "It's a (test) #1.png";
    const imageLiteralPath = `${testDir}/${imageLiteralName}`;
    const imageUploadRun = runFoundryctl([
      "file",
      "upload",
      "--path",
      imageLiteralPath,
      "--from-file",
      specialLocalPath,
      "--mime-type",
      "image/png"
    ]);
    const imageStoredPath = imageUploadRun.response?.result?.file?.path || null;
    markAndPush(
      summary,
      "file.upload(literal special-char image name)",
      Boolean(imageUploadRun.response?.ok && imageStoredPath),
      {
        ...summarizeCommand(imageUploadRun),
        literalPath: imageLiteralPath,
        storedPath: imageStoredPath
      }
    );
    const specialMacroRun = runFoundryctl([
      "macro",
      "create",
      "--name",
      `smoke-canon-${stamp}`,
      "--type",
      "script",
      "--img",
      imageLiteralPath
    ]);
    const storedMacroImg = specialMacroRun.response?.result?.macro?.img ?? null;
    const specialMacroId = specialMacroRun.response?.result?.macro?.id ?? null;
    markAndPush(
      summary,
      "macro.create(literal img stores browse-canonical form)",
      Boolean(specialMacroRun.response?.ok && storedMacroImg && storedMacroImg === imageStoredPath),
      {
        ...summarizeCommand(specialMacroRun),
        literalPath: imageLiteralPath,
        storedMacroImg,
        browseStoredPath: imageStoredPath
      }
    );
    if (specialMacroId) {
      expectOk(
        summary,
        "macro.delete(canon fixture cleanup)",
        runFoundryctl(["macro", "delete", "--macro-id", specialMacroId])
      );
    }

    const recursiveRun = runFoundryctl([
      "file",
      "list",
      "--path",
      baseDir,
      "--recursive",
      "--max-entries",
      "2000"
    ]);
    const recursiveResult = recursiveRun.response?.result || null;
    const recursiveOk = Boolean(
      recursiveRun.response?.ok &&
      recursiveResult?.recursive === true &&
      recursiveResult?.truncated === false &&
      recursiveResult?.skippedTruncated === false &&
      Array.isArray(recursiveResult?.skipped) &&
      recursiveResult.skipped.length === 0 &&
      recursiveResult.entries.some((entry) => entry.path === testDir && entry.depth === 1) &&
      recursiveResult.entries.some((entry) => entry.path === bigRemotePath && entry.depth >= 2)
    );
    markAndPush(summary, "file.list(--recursive nesting + no truncation)", recursiveOk, {
      ...summarizeCommand(recursiveRun),
      total: recursiveResult?.entries?.length ?? 0,
      truncated: recursiveResult?.truncated ?? null,
      skippedTruncated: recursiveResult?.skippedTruncated ?? null
    });

    const moveGatedRun = runFoundryctl([
      "file",
      "move",
      "--from",
      remotePath,
      "--to",
      `${testDir}/moved-roundtrip.txt`
    ]);
    markAndPush(
      summary,
      "file.move(gated: UNSUPPORTED_OPERATION, not move coverage)",
      isExpectedError(moveGatedRun, ERROR_CODES.UNSUPPORTED_OPERATION),
      { ...summarizeCommand(moveGatedRun) }
    );

    const moveBadSourceRun = runFoundryctl([
      "file",
      "move",
      "--from",
      "../blocked.txt",
      "--to",
      `${testDir}/ok.txt`
    ]);
    markAndPush(
      summary,
      "file.move(bad source -> PATH_NOT_ALLOWED before gate)",
      isExpectedError(moveBadSourceRun, ERROR_CODES.PATH_NOT_ALLOWED),
      { ...summarizeCommand(moveBadSourceRun) }
    );

    const moveBadDestRun = runFoundryctl([
      "file",
      "move",
      "--from",
      remotePath,
      "--to",
      `worlds/${worldId}/world.json`
    ]);
    markAndPush(
      summary,
      "file.move(bad destination -> PATH_NOT_ALLOWED before gate)",
      isExpectedError(moveBadDestRun, ERROR_CODES.PATH_NOT_ALLOWED),
      { ...summarizeCommand(moveBadDestRun) }
    );

    runExtendedCoverage(summary, {
      actorId: options.actorId,
      targetSceneId: targetScene?.id ?? null,
      targetSceneActive: Boolean(targetScene?.active),
      gmUserId: systemInfoRun.response?.result?.user?.id ?? null,
      stamp,
      worldId,
      isV14
    });

    const missingSceneRun = runFoundryctl(["scene", "get", "--scene-id", createMissingId("scene", stamp)]);
    markAndPush(
      summary,
      "scene.get(missing)",
      isExpectedError(missingSceneRun, ERROR_CODES.SCENE_NOT_FOUND),
      {
        ...summarizeCommand(missingSceneRun)
      }
    );

    const missingActorRun = runFoundryctl([
      "actor",
      "item",
      "list",
      "--actor-id",
      createMissingId("actor", stamp)
    ]);
    markAndPush(
      summary,
      "actor.item.list(missing)",
      isExpectedError(missingActorRun, ERROR_CODES.ACTOR_NOT_FOUND),
      {
        ...summarizeCommand(missingActorRun)
      }
    );

    const traversalPathRun = runFoundryctl(["file", "list", "--path", "../blocked"]);
    markAndPush(
      summary,
      "file.list(traversal)",
      isExpectedError(traversalPathRun, ERROR_CODES.PATH_NOT_ALLOWED),
      {
        ...summarizeCommand(traversalPathRun)
      }
    );

    await runPolicySegment(summary, options, { stamp, coverage: policyCoverage });

    return { options, summary };
  } finally {
    if (summary.artifacts.actorItemId && options.actorId) {
      expectOk(
        summary,
        "actor.item.delete(cleanup)",
        runFoundryctl([
          "actor",
          "item",
          "delete",
          "--actor-id",
          options.actorId,
          "--item-id",
          summary.artifacts.actorItemId
        ])
      );
    }
    if (summary.artifacts.itemId) {
      expectOk(
        summary,
        "item.delete(cleanup)",
        runFoundryctl(["item", "delete", "--item-id", summary.artifacts.itemId])
      );
    }
    if (summary.artifacts.journalId) {
      expectOk(
        summary,
        "journal.delete(cleanup)",
        runFoundryctl(["journal", "delete", "--journal-id", summary.artifacts.journalId])
      );
    }
    if (policyHarness?.restore) {
      let failures = [];
      try {
        failures = await policyHarness.restore();
      } catch (error) {
        failures = [{ setting: null, reason: error.message }];
      }
      markAndPush(summary, "policy.restore", failures.length === 0, { failures });
    }

    flushPolicyCoverageNotes(summary, policyCoverage);

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

const { options, summary } = await main();

appendTimeoutHazardNote(summary);
emitSummary(summary, options);
process.exit(summary.ok ? 0 : 1);

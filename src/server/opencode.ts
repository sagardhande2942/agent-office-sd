import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Usage } from '../shared/protocol.js';

export type OpenCodeHookStatus = 'starting' | 'working' | 'needs_input' | 'done';

/** Compact, stable bridge payload sent by the generated OpenCode plugin. */
export interface OpenCodeStatusEvent {
  type: 'session' | 'prompt' | 'tool' | 'permission' | 'question' | 'error';
  sessionId: string;
  status: OpenCodeHookStatus;
  prompt?: string;
  tool?: string;
  detail?: string;
}

export interface OpenCodeUsageEvent {
  type: 'usage';
  sessionId: string;
  usage: Usage;
}

export type OpenCodeHookEvent = OpenCodeStatusEvent | OpenCodeUsageEvent;

/** The key an inline OpenCode config lists its plugins under: `plugin` in OpenCode 1, `plugins` in OpenCode 2. */
export type OpenCodePluginKey = 'plugin' | 'plugins';

/**
 * Merge the per-process plugin, and the office's MCP server when there is one (`mcp`, see
 * openCodeMcp), into inline OpenCode config without touching user config files.
 */
export function mergeOpenCodeConfigContent(existing: string | undefined, plugin: string, mcp?: Record<string, unknown>, pluginKey: OpenCodePluginKey = 'plugin'): string {
  let config: Record<string, unknown> = {};
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      config = { ...(parsed as Record<string, unknown>) };
      if (config[pluginKey] !== undefined && !Array.isArray(config[pluginKey])) throw new Error(`${pluginKey} is not an array`);
    } catch {
      throw new Error('OPENCODE_CONFIG_CONTENT must be valid JSON');
    }
  }
  const plugins = Array.isArray(config[pluginKey]) ? [...(config[pluginKey] as unknown[])] : [];
  if (!plugins.includes(plugin)) plugins.push(plugin);
  config[pluginKey] = plugins;
  if (mcp) {
    const theirs = config.mcp && typeof config.mcp === 'object' && !Array.isArray(config.mcp) ? (config.mcp as Record<string, unknown>) : {};
    config.mcp = { ...theirs, ...mcp };
  }
  return JSON.stringify(config);
}

/** The manifest OpenCode 2 needs before it will load a configured plugin directory. */
const OPENCODE_PLUGIN_MANIFEST = JSON.stringify({
  name: 'agent-office-opencode',
  version: '1.0.0',
  type: 'module',
  main: 'index.mjs',
  exports: { '.': './index.mjs' },
}, null, 2) + '\n';

/**
 * Write the plugin every OpenCode and Kilo worker loads, as a package directory (its entry module
 * plus the manifest OpenCode 2 requires), and return the entry module's path.
 */
export function writeOpenCodePlugin(dataDir: string): string {
  const dir = path.join(dataDir, 'agent-office-opencode');
  const entry = path.join(dir, 'index.mjs');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(entry, OPENCODE_PLUGIN_SOURCE, { mode: 0o600 });
  writeFileSync(path.join(dir, 'package.json'), OPENCODE_PLUGIN_MANIFEST, { mode: 0o600 });
  return entry;
}

/** The module specifier OpenCode 1 and Kilo take for the plugin's entry file. */
export function openCodePluginSpecifier(entry: string): string {
  return pathToFileURL(entry).href;
}

/** OpenCode 2 refuses a module file: a configured plugin is a package directory. */
export function openCodePluginDir(entry: string): string {
  return pathToFileURL(path.dirname(entry)).href;
}

/**
 * The office's OpenCode/Kilo plugin, written once per floor and loaded by each worker's CLI. One
 * default export serves both plugin APIs an OpenCode-family CLI may use: `server()` returns the
 * hook object OpenCode 1 and Kilo take, and `setup(ctx)` drives OpenCode 2's event stream and
 * hooks (see the Lifecycle/Events notes at the end). No imports: the CLI loads this module from the
 * office's data directory in packaged installs.
 */
export const OPENCODE_PLUGIN_SOURCE = String.raw`function createBridge(input) {
  const client = input && input.client;
  const url = process.env.AGENT_OFFICE_HOOK_URL;
  const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
  const worker = process.env.AGENT_OFFICE_WORKER_ID;
  const enabled = !!(url && token && worker);
  let rootSession = process.env.AGENT_OFFICE_SESSION_ID || undefined;
  const children = new Set();
  const pending = new Set();
  const usageByMessage = new Map();
  const liveUsageMessages = new Set();
  const removedUsageMessages = new Set();
  let hydrationPending = false;
  let hydrationIncomplete = false;
  let usageEpoch = 0;
  let queued = Promise.resolve();

  // SDK lookups, session selection and delivery share one order. A slow selection cannot let
  // a later idle event overtake its prompt, and a stalled office cannot stall the agent forever.
  function enqueue(job) {
    queued = queued.then(job).catch(() => {});
    return queued;
  }
  async function send(value) {
    if (!value || !enabled) return;
    try {
      const response = await fetch(url + "/hooks/opencode?worker=" + encodeURIComponent(worker), {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify(value),
        signal: AbortSignal.timeout(2500),
      });
      if (response.ok) return await response.json();
    } catch {}
  }
  function detail(value) {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : undefined;
  }
  function count(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
  function assistantUsage(info) {
    if (!info || info.role !== "assistant" || typeof info.id !== "string" || !info.id) return;
    const tokens = info.tokens || {};
    const cache = tokens.cache || {};
    const costKnown = typeof info.cost === "number" && Number.isFinite(info.cost) && info.cost >= 0;
    return {
      input: count(tokens.input),
      output: count(tokens.output),
      ...(tokens.reasoning === undefined ? {} : { reasoning: count(tokens.reasoning) }),
      cacheRead: count(cache.read),
      cacheWrite: count(cache.write),
      cost: costKnown ? info.cost : 0,
      calls: 1,
      costKnown,
    };
  }
  function usageEvent() {
    let input = 0, output = 0, reasoning = 0, cacheRead = 0, cacheWrite = 0, cost = 0, calls = 0;
    let hasReasoning = false, costKnown = true;
    for (const entry of usageByMessage.values()) {
      if (entry.sessionId !== rootSession && !children.has(entry.sessionId)) continue;
      const usage = entry.usage;
      input += usage.input;
      output += usage.output;
      if (usage.reasoning !== undefined) { reasoning += usage.reasoning; hasReasoning = true; }
      cacheRead += usage.cacheRead;
      cacheWrite += usage.cacheWrite;
      cost += usage.cost;
      calls += usage.calls;
      if (usage.costKnown === false) costKnown = false;
    }
    return { type: "usage", sessionId: rootSession, usage: {
      input, output,
      ...(hasReasoning ? { reasoning } : {}),
      cacheRead, cacheWrite, cost, calls, costKnown,
      ...(hydrationPending || hydrationIncomplete ? { incomplete: true } : {}),
    } };
  }
  function sdkCall(fn) {
    try {
      return Promise.resolve(fn()).then((data) => ({ ok: !!data && !data.error && Array.isArray(data.data), data }), () => ({ ok: false, data: undefined }));
    } catch { return Promise.resolve({ ok: false, data: undefined }); }
  }
  async function hydrate(id, epoch) {
    if (!client || !client.session || typeof client.session.messages !== "function") return;
    const queue = [id];
    const seen = new Set();
    let changed = false;
    let incomplete = false;
    while (queue.length && seen.size < 128) {
      const sessionId = queue.shift();
      if (typeof sessionId !== "string" || seen.has(sessionId)) continue;
      seen.add(sessionId);
      const signal = AbortSignal.timeout(2500);
      // The SDK has no cursor/offset for this endpoint; omitting limit avoids silently dropping
      // older assistant messages when OpenCode's server changes its default page size.
      const messagesPromise = sdkCall(() => client.session.messages({ path: { id: sessionId }, signal }));
      const childrenPromise = typeof client.session.children === "function"
        ? sdkCall(() => client.session.children({ path: { id: sessionId }, signal }))
        : Promise.resolve({ ok: false, data: undefined });
      const [messagesResult, descendantsResult] = await Promise.all([messagesPromise, childrenPromise]);
      if (epoch !== usageEpoch || rootSession !== id) return;
      if (!messagesResult.ok || !descendantsResult.ok) incomplete = true;
      const messages = messagesResult.data;
      const descendants = descendantsResult.data;
      const childRows = descendants && Array.isArray(descendants.data) ? descendants.data : [];
      for (const child of childRows) {
        if (!child || typeof child.id !== "string" || child.id === id) continue;
        if (typeof child.parentID === "string" && child.parentID !== sessionId) continue;
        children.add(child.id);
        queue.push(child.id);
      }
      const rows = messages && Array.isArray(messages.data) ? messages.data : [];
      for (const row of rows) {
        const info = row && row.info;
        const usage = assistantUsage(info);
        if (!usage || liveUsageMessages.has(info.id) || removedUsageMessages.has(info.id)) continue;
        usageByMessage.set(info.id, { sessionId, usage });
        changed = true;
      }
    }
    if (queue.length) incomplete = true;
    if (epoch !== usageEpoch || rootSession !== id) return;
    hydrationPending = false;
    hydrationIncomplete = incomplete;
    if (changed || usageByMessage.size > 0) {
      await enqueue(() => {
        if (epoch !== usageEpoch || rootSession !== id) return;
        return send(usageEvent());
      });
    }
  }
  function select(id) {
    if (rootSession === id) return { type: "session", sessionId: id, status: "starting" };
    rootSession = id;
    usageEpoch++;
    children.clear();
    usageByMessage.clear();
    liveUsageMessages.clear();
    removedUsageMessages.clear();
    hydrationPending = !!(client && client.session && typeof client.session.messages === "function");
    hydrationIncomplete = false;
    pending.clear();
    void hydrate(id, usageEpoch);
    return { type: "session", sessionId: id, status: "starting" };
  }
  async function selectExisting(id) {
    if (id === rootSession) return true;
    if (children.has(id) || !client || !client.session) return false;
    try {
      const result = await client.session.get({ path: { id }, signal: AbortSignal.timeout(2500) });
      const info = result.data;
      if (!info || info.id !== id) return false;
      if (info.parentID) {
        if (info.parentID === rootSession || children.has(info.parentID)) children.add(id);
        return false;
      }
      await send(select(id));
      return true;
    } catch { return false; }
  }
  function compact(event) {
    if (!event || typeof event.type !== "string") return;
    const p = event.properties || {};
    const info = p.info || {};
    const id = p.sessionID || info.sessionID || info.id;
    if (event.type === "session.created") {
      if (typeof id !== "string") return;
      if (info.parentID) {
        if (info.parentID === rootSession || children.has(info.parentID)) children.add(id);
        return;
      }
      return select(id);
    }
    if (!id || (id !== rootSession && !children.has(id))) return;
    if (event.type === "message.updated") {
      const usage = assistantUsage(info);
      if (!usage) return;
      liveUsageMessages.add(info.id);
      removedUsageMessages.delete(info.id);
      usageByMessage.set(info.id, { sessionId: id, usage });
      return usageEvent();
    }
    if (event.type === "message.removed") {
      const messageId = typeof p.messageID === "string" ? p.messageID : info.id;
      if (typeof messageId !== "string") return;
      const removed = usageByMessage.delete(messageId);
      liveUsageMessages.delete(messageId);
      removedUsageMessages.add(messageId);
      if (!removed) return;
      return usageEvent();
    }
    if (id !== rootSession) return;
    const base = { type: "session", sessionId: id };
    const working = () => ({ ...base, status: pending.size ? "needs_input" : "working" });
    if (event.type === "session.status" && (p.status?.type === "busy" || p.status?.type === "retry")) return working();
    if (event.type === "session.idle" || (event.type === "session.status" && p.status?.type === "idle")) {
      pending.clear();
      return { ...base, status: "done" };
    }
    if (event.type === "session.error") {
      const err = p.error || {};
      return { ...base, type: "error", status: "needs_input", detail: detail(err.data?.message) || detail(err.message) || detail(err.name) };
    }
    if (event.type === "permission.asked" || event.type === "question.asked") {
      const kind = event.type.split(".")[0];
      pending.add(kind + ":" + p.id);
      const q = Array.isArray(p.questions) ? p.questions[0] : undefined;
      return { ...base, type: kind, status: "needs_input", detail: detail(q?.question || q?.header || p.title || p.permission) };
    }
    if (["permission.replied", "question.replied", "question.rejected"].includes(event.type)) {
      pending.delete(event.type.split(".")[0] + ":" + p.requestID);
      return working();
    }
  }
  // A tool call, once its root session is settled: what it is doing, or that it waits on the person.
  function tool(sessionId, name) {
    if (!sessionId || sessionId !== rootSession || children.has(sessionId)) return;
    return send({ type: "tool", sessionId, tool: name, status: pending.size ? "needs_input" : "working" });
  }
  // The office's checkpoint for a finished root tool call: what it wants appended to the result.
  async function checkpoint(sessionId) {
    if (!sessionId || sessionId !== rootSession || children.has(sessionId)) return;
    const response = await send({ type: "checkpoint", sessionId });
    const context = response?.hookSpecificOutput?.additionalContext;
    return typeof context === "string" && context.length <= 10000 ? context : undefined;
  }
  // A worker picked back up: read what its session already spent, without blocking its start.
  if (rootSession && client && client.session && typeof client.session.messages === "function") {
    hydrationPending = true;
    void hydrate(rootSession, usageEpoch);
  }
  return { enabled, client, enqueue, send, compact, select, selectExisting, tool, checkpoint, pending, get rootSession() { return rootSession; } };
}

// OpenCode 1 and Kilo: a hook object, exactly what those CLIs call.
async function openCode1(input) {
  const bridge = createBridge(input || {});
  if (!bridge.enabled) return {};
  // The reasoning effort picked for this worker, for a fresh session: OpenCode calls it the model's
  // variant, and its TUI has no flag for one. It sends each message with the variant it remembers
  // for the model (the last one anyone used it at, in any session), so the first message goes out
  // at the worker's own instead. The TUI then takes its variant from that message, and ctrl+t still
  // changes it: once it sends another variant than it started with, or another model, theirs stands.
  let effort = process.env.AGENT_OFFICE_EFFORT || undefined;
  const effortModel = process.env.AGENT_OFFICE_MODEL || undefined;
  let effortSession;
  let effortOver;
  function applyEffort(input, output) {
    const model = output && output.message && output.message.model;
    // An OpenCode from before variants names none here, and wouldn't know what to do with one.
    if (!effort || !model || typeof model !== "object" || typeof input.sessionID !== "string" || !("variant" in input)) return;
    if (!effortSession) {
      effortSession = input.sessionID;
      effortOver = input.variant;
    }
    // A subagent's messages are its own.
    if (input.sessionID !== effortSession) return;
    if (input.variant !== effortOver || (effortModel && model.providerID + "/" + model.modelID !== effortModel)) {
      effort = undefined;
      return;
    }
    model.variant = effort;
  }
  return {
    event: ({ event }) => bridge.enqueue(() => bridge.send(bridge.compact(event))),
    "chat.message": (input, output) => {
      // Before anything is awaited: OpenCode saves the message as this hook leaves it.
      applyEffort(input, output);
      return bridge.enqueue(async () => {
        if (typeof input.sessionID !== "string" || !await bridge.selectExisting(input.sessionID)) return;
        const parts = output && Array.isArray(output.parts) ? output.parts : [];
        const prompt = parts.filter((part) => part && part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n").trim().slice(0, 20000);
        await bridge.send({ type: "prompt", sessionId: input.sessionID, status: "working", ...(prompt ? { prompt } : {}) });
      });
    },
    "tool.execute.after": (input, output) => bridge.enqueue(async () => {
      const context = await bridge.checkpoint(input.sessionID);
      if (context !== undefined && typeof output?.output === "string") output.output += "\n\n" + context;
    }),
    "tool.execute.before": (input) => {
      if (planReviewBlocked(input)) throw new Error("This planning session permits repository reads and its role's plan tools only");
      return bridge.enqueue(() => bridge.tool(input.sessionID, input.tool));
    },
  };
}

/** The plan-comparison lock: only repository reads and the role's own plan tools get through. */
function planReviewBlocked(input) {
  const role = process.env.AGENT_OFFICE_PLAN_ROLE;
  if (!role) return false;
  const tools = ["plan_review_state", ...(role === "candidate" ? ["submit_candidate_plan"] : ["request_plan_clarification", "submit_plan_review"])];
  const allowed = ["read", "glob", "grep", "list", ...tools.flatMap((t) => ["agent-office_" + t, "agent_office_" + t])];
  return !allowed.includes(input && input.tool);
}

// OpenCode 2: the CLI loads a definition and calls setup(ctx); its lifecycle arrives as events and
// hooks instead of the hook object an OpenCode 1 CLI calls. Same bridge, different wiring.
async function openCode2(ctx) {
  const bridge = createBridge({});
  if (!bridge.enabled || !ctx || !ctx.event || typeof ctx.event.subscribe !== "function") return;
  const controller = new AbortController();
  // One event from the connected server, as the compact payload the bridge reduces. A session the
  // worker has not claimed yet is not its own: unrelated (a subagent) and stale sessions are dropped
  // rather than reported, so they cannot overwrite the desk's status.
  function translate(event) {
    const type = event && event.type;
    const p = (event && event.data) || {};
    const id = p.sessionID;
    if (!id || id !== bridge.rootSession) return;
    if (type === "session.execution.started") return { type: "session.status", properties: { sessionID: id, status: { type: "busy" } } };
    if (type === "session.execution.succeeded" || type === "session.execution.interrupted") return { type: "session.idle", properties: { sessionID: id } };
    if (type === "session.execution.failed") return { type: "session.error", properties: { sessionID: id, error: p.error } };
    if (type === "session.status" || type === "session.idle" || type === "session.error") return { type, properties: p };
    if (type === "permission.asked") {
      return { type: "permission.asked", properties: { sessionID: id, id: p.id, permission: openCode2Permission(p) } };
    }
    if (type === "permission.replied") {
      return { type: "permission.replied", properties: { sessionID: id, requestID: p.requestID } };
    }
    return;
  }
  // The session a user prompt is admitted to is this worker's root. A resumed worker already has
  // one from AGENT_OFFICE_SESSION_ID; a fresh one is claimed here, before its first execution.
  try {
    await ctx.session.hook("prompt", (event) => {
      const id = event && event.sessionID;
      const text = event && event.prompt && typeof event.prompt.text === "string" ? event.prompt.text : "";
      return bridge.enqueue(async () => {
        if (typeof id !== "string" || !id) return;
        if (id !== bridge.rootSession) await bridge.send(bridge.select(id));
        await bridge.send({ type: "prompt", sessionId: id, status: "working", ...(text ? { prompt: text.slice(0, 20000) } : {}) });
      });
    });
  } catch {}
  try {
    await ctx.tool.hook("execute.before", (event) => {
      if (planReviewBlocked(event)) throw new Error("This planning session permits repository reads and its role's plan tools only");
      return bridge.tool(event && event.sessionID, event && event.tool);
    });
    await ctx.tool.hook("execute.after", async (event) => {
      if (!event || event.status !== "completed") return;
      const context = await bridge.checkpoint(event.sessionID);
      if (context !== undefined && event.result && Array.isArray(event.result.content)) {
        event.result.content.push({ type: "text", text: context });
      }
    });
  } catch {}
  async function handle(event) {
    // A fresh worker whose prompt hook has not named its session yet: the first session event is
    // its own (a subagent's only follows work the root already started). Claimed here, in order.
    const sessionID = event && event.data && event.data.sessionID;
    if (!bridge.rootSession && typeof sessionID === "string" && sessionID && typeof event.type === "string" && event.type.startsWith("session.")) {
      const start = bridge.select(sessionID);
      if (start) await bridge.send(start);
    }
    if (event && event.type === "session.usage.updated" && sessionID !== undefined && sessionID === bridge.rootSession) {
      return bridge.send({ type: "usage", sessionId: sessionID, usage: openCode2Usage(event.data) });
    }
    const payload = translate(event);
    if (payload) await bridge.send(payload.type === "usage" ? payload : bridge.compact(payload));
  }
  void (async () => {
    for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
      void bridge.enqueue(() => handle(event));
    }
  })().catch(() => {});
  // Returning the cleanup lets the CLI stop the subscription when the plugin unloads.
  return () => controller.abort();
}

// OpenCode 2 reports a permission request as an action plus its resources, with no title.
function openCode2Permission(p) {
  const what = typeof p.action === "string" && p.action ? p.action : "tool";
  const resource = Array.isArray(p.resources) && typeof p.resources[0] === "string" ? p.resources[0] : undefined;
  const text = resource ? what + ": " + resource : what;
  return text.trim().slice(0, 500) || undefined;
}

// A whole-session usage snapshot (session.usage.updated), as the bridge's Usage.
function openCode2Usage(data) {
  const tokens = data && data.tokens ? data.tokens : {};
  const cache = tokens.cache || {};
  const num = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  const cost = typeof data.cost === "number" && Number.isFinite(data.cost) && data.cost >= 0 ? data.cost : 0;
  return {
    input: num(tokens.input),
    output: num(tokens.output),
    ...(tokens.reasoning === undefined ? {} : { reasoning: num(tokens.reasoning) }),
    cacheRead: num(cache.read),
    cacheWrite: num(cache.write),
    cost,
    calls: 1,
    costKnown: typeof data.cost === "number" && Number.isFinite(data.cost) && data.cost >= 0,
  };
}

export default {
  id: "agent-office-opencode",
  setup: openCode2,
  server: openCode1,
};
`;

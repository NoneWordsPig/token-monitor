// @ts-check
'use strict';

// Hermes keeps long-lived agent sessions: one conversation can stay open for
// days and keep accumulating session_model_usage rows the whole time. tokscale
// buckets a Hermes session by sessions.started_at only, so a session that
// started last week but was still used today contributes nothing to --today,
// --month, or the day graph - only --since/allTime ever shows it. Hermes also
// does not store per-message token counts (messages.token_count stays NULL), so
// a true per-day split of a session's usage is impossible.
//
// This module rebuilds a *split mirror* of the live state.db: one synthetic
// session per (original session, local day it was active), carrying that day's
// message_count and a message-weighted share of the original session's per-
// (session, model, billing_provider) usage totals. The collector then points
// the tokscale child process at the mirror via HERMES_HOME, so tokscale's own
// pricing/provider/model parsing produces the same day/month/graph windows it
// produces for every other client. Token totals across the mirror still sum
// exactly to the real DB, so allTime (and the deltas derived from it) never
// jumps.
//
// The mirror is rebuilt lazily whenever the real DB file family (state.db plus
// -wal/-shm) changes and a Hermes-including tokscale scan is about to run.
// Rebuilds are throttled so a burst of Hermes writes does not rebuild on every
// watch tick; a scan may use a mirror at most a couple of seconds stale, and
// the next scan picks up the change. Read failures degrade to the real home
// (the pre-fix behavior) instead of breaking collection.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveHermesHome } = require('./hermesProfiles');
const { sharedDataDir } = require('./config');

const SHADOW_DIR_NAME = 'hermes-shadow';
const SHADOW_DB_NAME = 'state.db';
const REBUILD_MIN_INTERVAL_MS = 2000;

// Real Hermes homes are small (a handful of sessions / dozens of usage rows),
// but bound the mirror reads so a pathological install cannot balloon the
// in-memory pass or the mirror build.
const MAX_SESSION_ROWS = 200_000;
const MAX_USAGE_ROWS = 500_000;
const MAX_MESSAGE_DAY_ROWS = 2_000_000;

const lastState = {
  realDbPath: '',
  fingerprint: '',
  builtAtMs: 0,
  lastError: ''
};

function statFingerprint(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch (_) {
    return '';
  }
}

function dbFamilyFingerprint(realDbPath) {
  return [
    statFingerprint(realDbPath),
    statFingerprint(`${realDbPath}-wal`),
    statFingerprint(`${realDbPath}-shm`)
  ].join('|');
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function epochSecondsToMs(value) {
  const numeric = toNumber(value);
  if (!(numeric > 0)) return 0;
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

// Distribute an integer total across buckets proportionally to `weights`,
// guaranteeing the returned integers sum back to exactly `total`.
function distributeInteger(total, weights) {
  const count = weights.length;
  const out = new Array(count).fill(0);
  if (count === 0 || !(total > 0)) return out;
  let weightTotal = 0;
  for (const weight of weights) weightTotal += weight;
  if (!(weightTotal > 0)) {
    out[0] = total;
    return out;
  }
  let allocated = 0;
  for (let index = 0; index < count; index += 1) {
    out[index] = Math.floor((total * weights[index]) / weightTotal);
    allocated += out[index];
  }
  let remainder = total - allocated;
  const order = weights
    .map((weight, index) => ({ weight, index }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  let cursor = 0;
  while (remainder > 0) {
    out[order[cursor % order.length].index] += 1;
    remainder -= 1;
    cursor += 1;
  }
  return out;
}

// Distribute a float total (cost) across buckets the same way tokens are, so
// the mirror's per-day costs stay in sync with its token splits.
function distributeCost(total, weights) {
  const count = weights.length;
  const out = new Array(count).fill(0);
  if (!(total > 0)) return out;
  let weightTotal = 0;
  for (const weight of weights) weightTotal += weight;
  if (!(weightTotal > 0)) {
    out[0] = total;
    return out;
  }
  for (let index = 0; index < count; index += 1) {
    out[index] = total * (weights[index] / weightTotal);
  }
  return out;
}
function localDayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDayCompact(date) {
  return localDayKey(date).replace(/-/g, '');
}

function providerSlug(provider) {
  let slug = '';
  for (const char of String(provider || '').toLowerCase()) {
    if (/[a-z0-9]/.test(char)) slug += char;
  }
  return slug || 'p';
}

function loadNodeSqlite(requireFn) {
  const localRequire = requireFn || require;
  return localRequire('node:sqlite');
}

function readMirrorInputs(realHome, options = {}) {
  const realDbPath = path.join(realHome, SHADOW_DB_NAME);
  const { DatabaseSync } = loadNodeSqlite(options.requireFn);
  const database = new DatabaseSync(realDbPath, { readOnly: true });
  try {
    database.exec('PRAGMA busy_timeout = 2000');
    const bounded = (rows, limit, label) => {
      if (rows.length > limit) {
        const error = new Error(`hermes shadow read exceeded ${label} limit (${limit})`);
        error.code = 'HERMES_SHADOW_READ_LIMIT';
        throw error;
      }
      return rows;
    };
    const sessions = bounded(
      database.prepare(
        'SELECT id, started_at, last_activity_at, message_count, model FROM sessions'
      ).all(),
      MAX_SESSION_ROWS,
      'sessions'
    );
    const usage = bounded(
      database.prepare(
        `SELECT session_id, model, billing_provider,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
           reasoning_tokens, COALESCE(NULLIF(actual_cost_usd, 0), estimated_cost_usd, 0) AS cost_usd
         FROM session_model_usage
         WHERE model IS NOT NULL AND TRIM(model) != ''`
      ).all(),
      MAX_USAGE_ROWS,
      'session_model_usage'
    );
    const messageDays = bounded(
      database.prepare(
        `SELECT session_id, date(timestamp, 'unixepoch', 'localtime') AS day, COUNT(*) AS count
         FROM messages
         WHERE timestamp IS NOT NULL
         GROUP BY session_id, day`
      ).all(),
      MAX_MESSAGE_DAY_ROWS,
      'messages'
    );
    return { sessions, usage, messageDays };
  } finally {
    database.close();
  }
}

// Day buckets a real session can be attributed to: the local days that carry
// messages inside [started_at, last_activity_at]. Returns [] when the session
// has no dated messages (callers then fall back to the start day).
function eligibleDayBuckets(session, messageDaysBySession) {
  const byDay = messageDaysBySession.get(String(session.id || ''));
  if (!byDay || byDay.size === 0) return [];
  const startedMs = epochSecondsToMs(session.started_at);
  const lastActivityMs = epochSecondsToMs(session.last_activity_at);
  const dayMessages = [];
  for (const [day, count] of byDay) {
    if (!(count > 0)) continue;
    const parsed = Date.parse(`${day}T00:00:00`);
    if (Number.isNaN(parsed)) continue;
    dayMessages.push({ day, count, ms: parsed });
  }
  if (dayMessages.length === 0) return [];
  dayMessages.sort((a, b) => a.day.localeCompare(b.day));
  const startDay = startedMs > 0 ? localDayKey(new Date(startedMs)) : dayMessages[0].day;
  const endDay = lastActivityMs > 0 ? localDayKey(new Date(lastActivityMs)) : dayMessages[dayMessages.length - 1].day;
  const eligible = dayMessages.filter((entry) => entry.day >= startDay && entry.day <= endDay);
  return eligible.length > 0 ? eligible : dayMessages.slice(0, 1);
}

// Day buckets a session's usage should be split across. Prefer the dated
// message days inside [started_at, last_activity_at]; when a session has no
// dated messages (e.g. it was compacted) keep everything whole on its start
// day so no usage disappears from allTime.
function resolveUsageBuckets(session, sessionId, messageDaysBySession) {
  const eligible = session ? eligibleDayBuckets(session, messageDaysBySession) : [];
  if (eligible.length > 0) return eligible;
  let fallbackMs = 0;
  let fallbackDay = '';
  if (session) {
    fallbackMs = epochSecondsToMs(session.started_at);
    if (fallbackMs > 0) fallbackDay = localDayKey(new Date(fallbackMs));
  }
  if (!fallbackDay) {
    const byDay = messageDaysBySession.get(sessionId);
    if (byDay && byDay.size > 0) {
      const days = [...byDay.keys()].sort();
      fallbackDay = days[0];
      fallbackMs = Date.parse(`${fallbackDay}T00:00:00`);
    }
  }
  return fallbackDay ? [{ day: fallbackDay, count: 0, ms: fallbackMs }] : [];
}

// Base id for a (day, session). Provider groups get suffixed variants of the
// same base so every (session, model, provider) still maps to its own row.
function bucketBaseId(dayCompact, sessionId) {
  return `${dayCompact}__${sessionId}`;
}

function buildMirrorRows(inputs) {
  const sessionsById = new Map();
  for (const row of inputs.sessions) {
    sessionsById.set(String(row.id || ''), row);
  }

  const messageDaysBySession = new Map();
  for (const row of inputs.messageDays) {
    const sessionId = String(row.session_id || '');
    const day = String(row.day || '');
    if (!sessionId || !day) continue;
    let byDay = messageDaysBySession.get(sessionId);
    if (!byDay) {
      byDay = new Map();
      messageDaysBySession.set(sessionId, byDay);
    }
    byDay.set(day, (byDay.get(day) || 0) + Math.max(0, Math.trunc(toNumber(row.count))));
  }

  // Aggregate session_model_usage per (session, model, billing_provider) the
  // same way tokscale's Hermes query does; providers are priced separately.
  const usageGroups = new Map();
  for (const row of inputs.usage) {
    const sessionId = String(row.session_id || '');
    const model = String(row.model || '').trim();
    const provider = String(row.billing_provider || '').trim();
    if (!sessionId || !model) continue;
    const key = `${sessionId}\u0000${model}\u0000${provider}`;
    let acc = usageGroups.get(key);
    if (!acc) {
      acc = { sessionId, model, provider, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 };
      usageGroups.set(key, acc);
    }
    acc.input += Math.max(0, Math.trunc(toNumber(row.input_tokens)));
    acc.output += Math.max(0, Math.trunc(toNumber(row.output_tokens)));
    acc.cacheRead += Math.max(0, Math.trunc(toNumber(row.cache_read_tokens)));
    acc.cacheWrite += Math.max(0, Math.trunc(toNumber(row.cache_write_tokens)));
    acc.reasoning += Math.max(0, Math.trunc(toNumber(row.reasoning_tokens)));
    acc.cost += toNumber(row.cost_usd);
  }

  const dayRows = new Map(); // synthetic id -> { id, dayMs, messages, modelCounts }
  const dayClusters = new Map(); // base id -> [{ id, tokens }] for message bookkeeping

  for (const acc of usageGroups.values()) {
    const session = sessionsById.get(acc.sessionId);
    const buckets = resolveUsageBuckets(session, acc.sessionId, messageDaysBySession);
    if (buckets.length === 0) continue;

    const weights = buckets.map((bucket) => bucket.count);
    const inputShares = distributeInteger(acc.input, weights);
    const outputShares = distributeInteger(acc.output, weights);
    const cacheReadShares = distributeInteger(acc.cacheRead, weights);
    const cacheWriteShares = distributeInteger(acc.cacheWrite, weights);
    const reasoningShares = distributeInteger(acc.reasoning, weights);
    const costShares = distributeCost(acc.cost, weights);

    buckets.forEach((bucket, index) => {
      const baseId = bucketBaseId(localDayCompact(new Date(bucket.ms)), acc.sessionId);
      const groupId = acc.provider ? `${baseId}#${providerSlug(acc.provider)}` : baseId;
      const shareTokens = inputShares[index] + outputShares[index]
        + cacheReadShares[index] + cacheWriteShares[index] + reasoningShares[index];
      let dayRow = dayRows.get(groupId);
      if (!dayRow) {
        dayRow = { id: groupId, dayMs: bucket.ms, messages: 0, modelCounts: new Map() };
        dayRows.set(groupId, dayRow);
      }
      let cluster = dayClusters.get(baseId);
      if (!cluster) {
        cluster = [];
        dayClusters.set(baseId, cluster);
      }
      const existing = cluster.find((entry) => entry.id === groupId);
      if (existing) existing.tokens += shareTokens;
      else cluster.push({ id: groupId, tokens: shareTokens });

      const modelKey = `${acc.model}\u0000${acc.provider}`;
      let modelCount = dayRow.modelCounts.get(modelKey);
      if (!modelCount) {
        modelCount = { model: acc.model, provider: acc.provider, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 };
        dayRow.modelCounts.set(modelKey, modelCount);
      }
      modelCount.input += inputShares[index];
      modelCount.output += outputShares[index];
      modelCount.cacheRead += cacheReadShares[index];
      modelCount.cacheWrite += cacheWriteShares[index];
      modelCount.reasoning += reasoningShares[index];
      modelCount.cost += costShares[index];
    });
  }

  // Message bookkeeping: the real session's message_count (scaled to each day's
  // share) belongs to exactly one provider group per (day, session) so a multi-
  // provider session does not double-report it. The biggest-token group wins;
  // the provider-less id wins ties so the common single-provider path keeps the
  // clean unsuffixed id.
  const scaledDayMessages = new Map(); // `${day}\u0000${sessionId}` -> count
  for (const row of inputs.sessions) {
    const sessionId = String(row.id || '');
    const officialCount = Math.max(0, Math.trunc(toNumber(row.message_count)));
    if (officialCount <= 0) continue;
    const buckets = resolveUsageBuckets(row, sessionId, messageDaysBySession);
    if (buckets.length === 0) continue;
    const weights = buckets.map((bucket) => bucket.count);
    const shares = distributeInteger(officialCount, weights);
    buckets.forEach((bucket, index) => {
      scaledDayMessages.set(`${bucket.day}\u0000${sessionId}`, shares[index]);
    });
  }
  for (const [baseId, cluster] of dayClusters) {
    const match = baseId.match(/^(\d{8})__(.*)$/);
    if (!match) continue;
    const day = `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`;
    const sessionId = match[2];
    const messages = scaledDayMessages.get(`${day}\u0000${sessionId}`) || 0;
    if (!(messages > 0)) continue;
    cluster.sort((a, b) => b.tokens - a.tokens || (a.id === baseId ? -1 : 1));
    const row = dayRows.get(cluster[0].id);
    if (row) row.messages = messages;
  }
  return dayRows;
}

function writeMirrorDb(shadowRoot, dayRows) {
  fs.mkdirSync(shadowRoot, { recursive: true });
  const shadowDbPath = path.join(shadowRoot, SHADOW_DB_NAME);
  const tempPath = path.join(shadowRoot, `${SHADOW_DB_NAME}.tmp`);
  for (const stale of [`${shadowDbPath}-wal`, `${shadowDbPath}-shm`, tempPath]) {
    try { fs.unlinkSync(stale); } catch (_) {}
  }
  const { DatabaseSync } = loadNodeSqlite();
  const database = new DatabaseSync(tempPath);
  try {
    database.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        started_at REAL,
        message_count INTEGER,
        model TEXT
      );
      CREATE TABLE session_model_usage (
        session_id TEXT,
        model TEXT,
        billing_provider TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        reasoning_tokens INTEGER,
        actual_cost_usd REAL,
        estimated_cost_usd REAL
      );
    `);
    const insertSession = database.prepare(
      'INSERT INTO sessions (id, started_at, message_count, model) VALUES (?, ?, ?, ?)'
    );
    const insertUsage = database.prepare(
      `INSERT INTO session_model_usage
        (session_id, model, billing_provider, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, reasoning_tokens, actual_cost_usd, estimated_cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    );
    for (const dayRow of dayRows.values()) {
      insertSession.run(dayRow.id, dayRow.dayMs / 1000, dayRow.messages, null);
      for (const count of dayRow.modelCounts.values()) {
        if (count.input <= 0 && count.output <= 0 && count.cacheRead <= 0
          && count.cacheWrite <= 0 && count.reasoning <= 0) continue;
        insertUsage.run(
          dayRow.id,
          count.model,
          count.provider || null,
          count.input,
          count.output,
          count.cacheRead,
          count.cacheWrite,
          count.reasoning,
          count.cost > 0 ? count.cost : null
        );
      }
    }
    database.exec('CREATE INDEX idx_usage_session ON session_model_usage (session_id)');
  } finally {
    database.close();
  }
  fs.renameSync(tempPath, shadowDbPath);
}

function shadowRootPath(options = {}) {
  const env = options.env || process.env;
  return path.join(
    sharedDataDir({ env, platform: options.platform, homeDir: options.homeDir }),
    SHADOW_DIR_NAME
  );
}

// Returns the shadow home directory to pass as HERMES_HOME, or null when the
// mirror is unavailable (no real Hermes DB, unsupported runtime, build error).
function hermesShadowHome(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  const platform = options.platform || process.platform;
  const nowMs = options.nowMs || Date.now();
  const realHome = resolveHermesHome({ env, homeDir, platform });
  const realDbPath = path.join(realHome, SHADOW_DB_NAME);
  try {
    if (!fs.statSync(realDbPath).isFile()) return null;
  } catch (_) {
    return null;
  }

  const shadowRoot = shadowRootPath({ env, homeDir, platform });
  const shadowDbPath = path.join(shadowRoot, SHADOW_DB_NAME);
  const fingerprint = dbFamilyFingerprint(realDbPath);

  try {
    if (fs.statSync(shadowDbPath).isFile()) {
      if (fingerprint === lastState.fingerprint && lastState.realDbPath === realDbPath) {
        return shadowRoot;
      }
      if (nowMs - lastState.builtAtMs < REBUILD_MIN_INTERVAL_MS) {
        // Throttled: reuse the last mirror (at most a couple of seconds stale).
        return shadowRoot;
      }
    }
  } catch (_) { /* first build */ }

  try {
    const inputs = readMirrorInputs(realHome, { requireFn: options.requireFn });
    const dayRows = buildMirrorRows(inputs);
    writeMirrorDb(shadowRoot, dayRows);
    lastState.realDbPath = realDbPath;
    lastState.fingerprint = fingerprint;
    lastState.builtAtMs = nowMs;
    lastState.lastError = '';
    return shadowRoot;
  } catch (error) {
    lastState.lastError = error.message;
    if (typeof options.logger === 'function') options.logger(`hermes shadow build failed: ${error.message}`);
    try {
      return fs.statSync(shadowDbPath).isFile() ? shadowRoot : null;
    } catch (_) {
      return null;
    }
  }
}

// True when a real Hermes DB exists for the current environment. Cheap stat
// only - used by the collector's config fingerprint so enabling the mirror
// invalidates a persisted pre-mirror anchor exactly once.
function hermesShadowActive(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  const platform = options.platform || process.platform;
  const realHome = resolveHermesHome({ env, homeDir, platform });
  try {
    return fs.statSync(path.join(realHome, SHADOW_DB_NAME)).isFile();
  } catch (_) {
    return false;
  }
}

function resetHermesShadowState() {
  lastState.realDbPath = '';
  lastState.fingerprint = '';
  lastState.builtAtMs = 0;
  lastState.lastError = '';
}

module.exports = {
  buildMirrorRows,
  bucketBaseId,
  hermesShadowActive,
  hermesShadowHome,
  localDayKey,
  resetHermesShadowState,
  shadowRootPath,
  writeMirrorDb
};

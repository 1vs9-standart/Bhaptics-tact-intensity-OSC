/**
 * VRChat OSCQuery — mDNS discovery + HTTP bulk snapshot (как OscGoesBrrr).
 */

import bonjourPkg from 'bonjour-service';

const Bonjour = bonjourPkg.default ?? bonjourPkg.Bonjour ?? bonjourPkg;
import { findOscqueryPortFromLogs } from './log-port.js';

const RESCAN_MS = 5000;
const HTTP_TIMEOUT_MS = 5000;
const AVATAR_PARAM_PREFIX = '/avatar/parameters/';

function isVrchatHostInfo(json) {
  return json && typeof json.NAME === 'string' && json.NAME.startsWith('VRChat-Client-');
}

function collectValues(input, output) {
  if (input == null) return;
  if (Array.isArray(input)) {
    for (const child of input) collectValues(child, output);
    return;
  }
  if (typeof input === 'object') {
    if (Array.isArray(input.VALUE) && input.VALUE.length > 0 && typeof input.FULL_PATH === 'string') {
      output[input.FULL_PATH] = input.VALUE[0];
    }
    for (const child of Object.values(input)) collectValues(child, output);
  }
}

function parseParamFromPath(path) {
  if (typeof path !== 'string') return undefined;
  if (path.startsWith(AVATAR_PARAM_PREFIX)) return path.slice(AVATAR_PARAM_PREFIX.length);
  return undefined;
}

function bulkToEntries(values) {
  const entries = [];
  for (const [fullPath, rawValue] of Object.entries(values)) {
    const paramName = parseParamFromPath(fullPath);
    if (!paramName) continue;
    const t = typeof rawValue;
    if (t !== 'number' && t !== 'boolean') continue;
    entries.push({
      paramName,
      value: t === 'boolean' ? (rawValue ? 1 : 0) : rawValue,
    });
  }
  return entries;
}

export function createVrchatOscquery(getConfig, hooks = {}) {
  let browser = null;
  let bonjour = null;
  let rescanTimer = null;

  let status = 'disabled';
  let httpHost = '';
  let httpPort = 0;
  let sendHost = '';
  let sendPort = 0;
  let hasBulk = false;
  let waitingForBulk = false;
  let lastBulkAt = 0;
  let lastError = '';

  function isEnabled() {
    const cfg = getConfig();
    return cfg?.osc?.useOscQuery !== false;
  }

  function emitStatus() {
    hooks.onStatus?.(getSnapshot());
  }

  function getSnapshot() {
    return {
      enabled: isEnabled(),
      status,
      httpHost,
      httpPort,
      sendHost,
      sendPort,
      hasBulk,
      waitingForBulk,
      lastBulkAt,
      error: lastError,
      ready: isReady(),
    };
  }

  function isReady() {
    if (!isEnabled()) return true;
    if (status !== 'connected') return false;
    const requireBulk = getConfig()?.osc?.oscQueryRequireBulk !== false;
    if (!requireBulk) return true;
    return hasBulk;
  }

  function getOscSendTarget() {
    if (sendHost && sendPort > 0) return { host: sendHost, port: sendPort };
    const cfg = getConfig()?.osc || {};
    return { host: cfg.sendHost || '127.0.0.1', port: cfg.sendPort ?? 9000 };
  }

  async function fetchJson(url) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function getHostInfo(ip, port) {
    const json = await fetchJson(`http://${ip}:${port}/?HOST_INFO`);
    return isVrchatHostInfo(json) ? json : null;
  }

  async function checkPort(ip, port) {
    try {
      const hostInfo = await getHostInfo(ip, port);
      if (!hostInfo) return false;
      const isNewEndpoint = httpHost !== ip || httpPort !== port;
      httpHost = ip;
      httpPort = port;
      sendHost = hostInfo.OSC_IP || '127.0.0.1';
      sendPort = Number(hostInfo.OSC_PORT) || 9000;
      status = 'connected';
      lastError = '';
      console.log(`[OSCQuery] VRChat at http://${ip}:${port} → send ${sendHost}:${sendPort}`);
      emitStatus();
      if (isNewEndpoint) void fetchBulk();
      return true;
    } catch (e) {
      lastError = e?.message || String(e);
      return false;
    }
  }

  async function rescan() {
    if (!isEnabled()) return;
    if (httpHost && httpPort) {
      try {
        if (await checkPort(httpHost, httpPort)) return;
      } catch (_) {}
    }

    status = 'searching';
    emitStatus();

    const services = browser?.services ?? [];
    for (const entry of services) {
      if (entry.protocol !== 'tcp') continue;
      const port = entry.port;
      if (!port) continue;
      const addresses = entry.addresses?.length ? entry.addresses : ['127.0.0.1'];
      for (const ip of addresses) {
        if (ip !== '127.0.0.1') {
          if (await checkPort('127.0.0.1', port)) return;
        }
        if (await checkPort(ip, port)) return;
      }
    }

    const { port: logPort, logsFound } = await findOscqueryPortFromLogs();
    if (logPort && await checkPort('127.0.0.1', logPort)) return;

    if (!logsFound && !services.length) {
      status = 'searching';
    } else {
      status = 'not_found';
    }
    emitStatus();
  }

  async function fetchBulk() {
    if (!isEnabled() || !httpHost || !httpPort) {
      waitingForBulk = false;
      return [];
    }
    waitingForBulk = true;
    hasBulk = false;
    emitStatus();
    try {
      const json = await fetchJson(`http://${httpHost}:${httpPort}/`);
      const values = {};
      collectValues(json, values);
      const entries = bulkToEntries(values);
      hasBulk = entries.length > 0;
      lastBulkAt = Date.now();
      waitingForBulk = false;
      lastError = '';
      console.log(`[OSCQuery] Bulk snapshot: ${entries.length} parameters`);
      hooks.onBulk?.(entries, lastBulkAt);
      emitStatus();
      return entries;
    } catch (e) {
      waitingForBulk = false;
      lastError = e?.message || String(e);
      console.warn('[OSCQuery] Bulk fetch failed:', lastError);
      emitStatus();
      return [];
    }
  }

  function markAvatarChanged() {
    hasBulk = false;
    void fetchBulk();
  }

  function start() {
    if (!isEnabled()) {
      status = 'disabled';
      emitStatus();
      return;
    }
    if (bonjour) return;
    bonjour = new Bonjour();
    browser = bonjour.find({ type: 'oscjson', protocol: 'tcp' });
    void rescan();
    rescanTimer = setInterval(() => { void rescan(); }, RESCAN_MS);
    console.log('[OSCQuery] mDNS discovery started (_oscjson._tcp)');
  }

  function stop() {
    if (rescanTimer) {
      clearInterval(rescanTimer);
      rescanTimer = null;
    }
    try { browser?.stop?.(); } catch (_) {}
    try { bonjour?.destroy?.(); } catch (_) {}
    browser = null;
    bonjour = null;
  }

  function restart() {
    stop();
    httpHost = '';
    httpPort = 0;
    sendHost = '';
    sendPort = 0;
    hasBulk = false;
    waitingForBulk = false;
    start();
  }

  return {
    start,
    stop,
    restart,
    rescan,
    fetchBulk,
    markAvatarChanged,
    isEnabled,
    isReady,
    getOscSendTarget,
    getSnapshot,
  };
}

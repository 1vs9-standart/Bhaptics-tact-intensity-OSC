/**
 * Lovense intensity tracker.
 *
 * Режимы:
 *  - `ogb`    — парсер OGB/TPS/VFH (как OscGoesBrrr GameDevice)
 *  - `legacy` — include/ignore по имени параметра (старое поведение)
 */

import { createOgbParser } from '../vrchat/ogb-parser.js';

function compileMatcher(patterns) {
  if (!Array.isArray(patterns) || !patterns.length) return null;
  const exact = new Set();
  const subs = [];
  for (const raw of patterns) {
    if (typeof raw !== 'string') continue;
    const p = raw.trim();
    if (!p) continue;
    if (/[*?]/.test(p)) {
      const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
      subs.push(re);
    } else if (p.endsWith('/') || p.endsWith('_')) {
      subs.push(new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&'), 'i'));
    } else {
      exact.add(p.toLowerCase());
      subs.push(new RegExp(p.replace(/[.+^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  }
  return { exact, subs };
}

function matchesAny(matcher, name) {
  if (!matcher || !name) return false;
  const lower = name.toLowerCase();
  if (matcher.exact.has(lower)) return true;
  for (let i = 0; i < matcher.subs.length; i++) if (matcher.subs[i].test(name)) return true;
  return false;
}

export function createLovenseEngine(getConfig, ogbParser) {
  const parser = ogbParser || createOgbParser();
  const values = new Map();
  let cachedKey = '';
  let includeMatcher = null;
  let ignoreMatcher = null;
  let ema = 0;
  let lastSourceLevels = new Map();
  let lastTickMs = 0;

  function refreshMatchers(cfg) {
    const inc = (cfg?.params?.include ?? []).slice();
    const ign = (cfg?.params?.ignore ?? []).slice();
    const key = JSON.stringify([inc, ign]);
    if (key === cachedKey) return;
    cachedKey = key;
    includeMatcher = compileMatcher(inc);
    ignoreMatcher = compileMatcher(ign);
  }

  function isLegacyTracked(paramName) {
    const cfg = getConfig();
    if (!cfg?.enabled) return false;
    refreshMatchers(cfg);
    if (!includeMatcher) return false;
    if (matchesAny(ignoreMatcher, paramName)) return false;
    return matchesAny(includeMatcher, paramName);
  }

  function isOgbShaped(paramName) {
    if (!paramName) return false;
    if (paramName.startsWith('OGB/') || paramName.startsWith('TPS_Internal/')) return true;
    return paramName.startsWith('VFH/Zone/');
  }

  function isTracked(paramName) {
    const cfg = getConfig();
    if (!cfg?.enabled) return false;
    if ((cfg.mode || 'ogb') === 'legacy') return isLegacyTracked(paramName);
    if (isOgbShaped(paramName)) return true;
    return isLegacyTracked(paramName);
  }

  /** Регистрирует OSC; в OGB-режиме только парсит, интенсивность считается в tick(). */
  function ingest(paramName, value, timestamp) {
    const cfg = getConfig();
    if (!cfg?.enabled) return false;
    const mode = cfg.mode || 'ogb';
    if (mode === 'legacy') {
      if (!isLegacyTracked(paramName)) return false;
      const num = Number(value) || 0;
      values.set(paramName, { value: num, timestamp });
      return true;
    }
    return parser.update(paramName, value, timestamp);
  }

  function buildOgbFilters(cfg) {
    const ogb = cfg.ogb || {};
    const kinds = ogb.kinds || ['plug', 'socket', 'touch'];
    const sources = ogb.sources || {};
    const includeSet = new Set((ogb.includeIds || []).map((x) => String(x).trim()).filter(Boolean));
    const excludeSet = new Set((ogb.excludeIds || []).map((x) => String(x).trim()).filter(Boolean));
    const filters = [];
    for (const kind of kinds) {
      filters.push({ kind, sources, includeSet, excludeSet });
    }
    return filters;
  }

  function devicePassesFilter(device, filter) {
    if (filter.excludeSet.has(device.id)) return false;
    if (filter.includeSet.size > 0 && !filter.includeSet.has(device.id)) return false;
    return true;
  }

  function computeLegacyIntensity(cfg, now) {
    const timeoutMs = Math.max(50, Math.round(cfg?.mapping?.contactTimeoutMs ?? 400));
    let max = 0;
    for (const [k, v] of values) {
      if (now - v.timestamp > timeoutMs) {
        values.delete(k);
        continue;
      }
      if (v.value > max) max = v.value;
    }
    return max;
  }

  /**
   * Вызывается из tick-loop (~15 Гц). Возвращает сглаженную интенсивность 0..1.
   */
  function tick(now = Date.now()) {
    const cfg = getConfig();
    if (!cfg?.enabled) {
      ema = 0;
      return 0;
    }
    const mode = cfg.mode || 'ogb';
    const timeoutMs = Math.max(50, Math.round(cfg?.mapping?.contactTimeoutMs ?? 400));
    const motionBased = cfg?.mapping?.motionBased !== false;
    const motionDtMs = lastTickMs ? Math.min(250, now - lastTickMs) : 67;
    lastTickMs = now;

    let raw = 0;
    if (mode === 'legacy') {
      raw = computeLegacyIntensity(cfg, now);
    } else {
      parser.pruneStale(now, timeoutMs);
      const filters = buildOgbFilters(cfg);
      const nextSourceLevels = new Map();
      for (const filter of filters) {
        const agg = parser.aggregate(
          { kind: filter.kind, sources: filter.sources },
          lastSourceLevels,
          motionBased ? motionDtMs : 0,
          (device) => devicePassesFilter(device, filter)
        );
        if (motionBased) {
          raw = Math.max(raw, agg.motionLevel, agg.level * 0.35);
        } else {
          raw = Math.max(raw, agg.level);
        }
        for (const s of agg.sources) nextSourceLevels.set(s.key, s.level);
      }
      lastSourceLevels = nextSourceLevels;
    }

    const alpha = Math.min(1, Math.max(0, cfg?.mapping?.emaAlpha ?? 0.45));
    ema = alpha * raw + (1 - alpha) * ema;
    if (ema < 0.001) ema = 0;
    return ema;
  }

  function reset() {
    values.clear();
    ema = 0;
    lastSourceLevels.clear();
    lastTickMs = 0;
    parser.clear();
  }

  function clearOnAvatarChange() {
    parser.clear();
    values.clear();
    lastSourceLevels.clear();
    ema = 0;
  }

  function getOgbDeviceCount() {
    return parser.getDevices().length;
  }

  return {
    ingest,
    tick,
    reset,
    clearOnAvatarChange,
    isTracked,
    getOgbDeviceCount,
    parser,
  };
}

/**
 * Face tracking / expression params — не касания.
 */
export function isFaceTrackingParam(name) {
  if (!name || typeof name !== 'string') return false;
  const n = name.toLowerCase();
  if (n.startsWith('ft/') || n.startsWith('ft\\')) return true;
  if (/^touch\/ear/i.test(n)) return true;
  if (/^touch\/cheek/i.test(n)) return true;
  if (/^touch\/eyepoke/i.test(n)) return true;
  return /eyesquint|cheeksquint|eyeopen|eyewide|brow|viseme|jaw|gaze|mouth|lip/i.test(n);
}

/**
 * State Analyzer — хранит состояние контакта, вычисляет скорость и длительность
 */
export function createStateAnalyzer(contactParams, forceIncludePredicate = null) {
  let cachedContactParams = null;
  let cachedHelpers = null;

  function getContactParams() {
    const value = typeof contactParams === 'function' ? contactParams() : contactParams;
    return value && typeof value === 'object' ? value : {};
  }

  function getHelpers() {
    const cp = getContactParams();
    if (cp === cachedContactParams && cachedHelpers) return cachedHelpers;

    const paramValue = cp.value ?? 'ContactChest';
    const paramSpeed = cp.speed ?? 'ContactSpeed';
    const extraParams = cp.extra ?? [];
    const acceptAll = cp.acceptAll ?? false;
    const excludeFaceTracking = cp.excludeFaceTracking !== false;
    const contactTimeoutMs = cp.contactTimeoutMs ?? 250;
    const ignoreParams = new Set(
      (cp.ignore ?? []).filter(Boolean).map((n) => String(n).toLowerCase())
    );
    const contactParamNames = new Set([paramValue, paramSpeed, ...extraParams].filter(Boolean));

    function isContactParam(name) {
      if (isFaceTrackingParam(name)) return false;
      if (contactParamNames.has(name)) return true;
      return (
        /contact/i.test(name) ||
        /vest/i.test(name) ||
        /proximity/i.test(name) ||
        /touch/i.test(name) ||
        /haptic/i.test(name) ||
        /chest/i.test(name)
      );
    }

    cachedContactParams = cp;
    cachedHelpers = { paramSpeed, acceptAll, excludeFaceTracking, contactTimeoutMs, ignoreParams, isContactParam };
    return cachedHelpers;
  }

  const state = {
    values: {},
    lastUpdate: 0,
    contactStart: 0,
    contactActive: false,
    velocity: 0,
    peakVelocity: 0,
    maxValue: 0,
  };
  /** Параметры, по которым писали значение контакта — сброс по таймауту без обхода всех ключей OSC. */
  const contactKeysWritten = new Set();

  function clearStaleContact(now, helpers = getHelpers()) {
    const { contactTimeoutMs } = helpers;
    if (!state.contactActive || !state.lastUpdate) return;
    if (now - state.lastUpdate <= contactTimeoutMs) return;
    for (const k of contactKeysWritten) state.values[k] = 0;
    contactKeysWritten.clear();
    state.maxValue = 0;
    state.contactActive = false;
    state.peakVelocity = 0;
  }

  function update(msg) {
    const helpers = getHelpers();
    const { acceptAll, excludeFaceTracking, ignoreParams, isContactParam } = helpers;
    const { paramName, value, timestamp } = msg;
    const nameLower = typeof paramName === 'string' ? paramName.toLowerCase() : '';
    const dt = state.lastUpdate ? (timestamp - state.lastUpdate) / 1000 : 0.02;

    clearStaleContact(timestamp, helpers);

    const forceIncluded = typeof forceIncludePredicate === 'function' && forceIncludePredicate(paramName);

    if (!forceIncluded && nameLower && ignoreParams.has(nameLower)) return getSnapshot();

    if (excludeFaceTracking && isFaceTrackingParam(paramName)) return getSnapshot();

    const isRelevant = forceIncluded || acceptAll || isContactParam(paramName);

    if (!isRelevant) return getSnapshot();

    const prevMax = state.maxValue;
    state.values[paramName] = value;
    if (forceIncluded || isContactParam(paramName)) contactKeysWritten.add(paramName);
    state.lastUpdate = timestamp;
    const activeState = getActiveState();
    state.maxValue = activeState.maxValue;
    state.velocity = dt > 0 ? Math.abs(state.maxValue - prevMax) / dt : 0;

    if (state.maxValue > 0.01) {
      if (!state.contactActive) {
        state.contactStart = timestamp;
        state.contactActive = true;
      }
      state.peakVelocity = Math.max(state.peakVelocity, state.velocity);
    } else {
      state.contactActive = false;
      state.peakVelocity = 0;
      contactKeysWritten.clear();
    }

    return getSnapshot(activeState);
  }

  function getActiveState() {
    let maxValue = 0;
    let lastParam = '';
    const activeParams = [];
    for (const [param, value] of Object.entries(state.values)) {
      const numericValue = Number(value) || 0;
      if (numericValue > maxValue) {
        maxValue = numericValue;
        lastParam = param;
      }
      if (numericValue > 0.01) activeParams.push({ param, value: numericValue });
    }
    activeParams.sort((a, b) => b.value - a.value);
    return { maxValue, lastParam, activeParams };
  }

  function getSnapshot(activeState = getActiveState()) {
    const { paramSpeed } = getHelpers();
    const now = state.lastUpdate;
    const duration = state.contactActive ? (now - state.contactStart) / 1000 : 0;
    const eventType = state.velocity > 0.5 ? 'impact' : state.contactActive ? 'smooth' : 'idle';
    const { lastParam, activeParams } = activeState;

    return {
      value: state.maxValue,
      velocity: state.velocity,
      peakVelocity: state.peakVelocity,
      speed: state.values[paramSpeed] ?? 0,
      duration,
      contactActive: state.contactActive,
      eventType,
      timestamp: state.lastUpdate,
      lastParam,
      activeParams,
    };
  }

  return { update, getSnapshot };
}

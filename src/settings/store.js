import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const settingsPath = join(__dirname, '..', '..', 'user-settings.json');

const DEFAULT_SETTINGS = Object.freeze({
  ui: Object.freeze({
    port: 1969,
  }),
  osc: Object.freeze({
    port: 9001,
    host: '127.0.0.1',
    sendHost: '127.0.0.1',
    sendPort: 9000,
    autoFreePorts: true,
    useOscQuery: true,
    oscQueryRequireBulk: true,
  }),
  bhaptics: Object.freeze({
    appId: '',
    apiKey: '',
    remote: '127.0.0.1:15881',
  }),
  onboarding: Object.freeze({
    completed: false,
  }),
  debug: false,
  intensity: Object.freeze({
    impactThreshold: 0.4,
    velocityMin: 0.2,
    velocityMax: 5.0,
    durationMin: 0.15,
    durationMax: 1.25,
    longContactMs: 1500,
    emaAlpha: 0.4,
    cooldownMs: 30,
    sustainCooldownMs: 150,
    minIntensity: 0.15,
    maxIntensity: 2.0,
  }),
  haptic: Object.freeze({
    eventKey: 'customTouch',
    useDotMode: true,
    vestMotorCount: 16,
    motorClusterSize: 0,
  }),
  contactParams: Object.freeze({
    value: 'ContactChest',
    speed: 'ContactSpeed',
    zone: 'ContactZone',
    acceptAll: false,
    excludeFaceTracking: true,
    contactTimeoutMs: 300,
    extra: [],
    ignore: ['touch/headpat', 'Touch/FootLeft', 'Touch/FootRight', 'VF108_superneko.realkiss.contact.activator'],
  }),
  lovense: Object.freeze({
    enabled: false,
    backend: 'buttplug',
    mode: 'ogb',
    buttplug: Object.freeze({
      url: 'ws://127.0.0.1:12345',
      clientName: 'VRChatOSC-bhaptics-js',
    }),
    ogb: Object.freeze({
      kinds: ['plug', 'socket', 'touch'],
      sources: Object.freeze({
        ownHands: false,
        otherHands: true,
        myPlugs: true,
        mySockets: true,
        otherPlugs: true,
        otherSockets: true,
      }),
      includeIds: [],
      excludeIds: [],
    }),
    params: Object.freeze({
      include: ['OGB/', 'SPS/', 'DPS_', 'TPS_Internal/', 'VF10_Slit/', 'VF108_superneko'],
      ignore: [],
    }),
    mapping: Object.freeze({
      minIntensity: 0.0,
      maxIntensity: 1.0,
      contactTimeoutMs: 400,
      emaAlpha: 0.45,
      minIntervalMs: 90,
      stopAfterIdleMs: 400,
      tickHz: 15,
      motionBased: true,
      maxLevelParam: '',
    }),
    triggerVest: true,
  }),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numberOrFallback(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
}

function normalizeIntensity(input = {}, fallback = DEFAULT_SETTINGS.intensity) {
  return {
    impactThreshold: numberOrFallback(input.impactThreshold, fallback.impactThreshold, 0, 100),
    velocityMin: numberOrFallback(input.velocityMin, fallback.velocityMin, 0, 100),
    velocityMax: numberOrFallback(input.velocityMax, fallback.velocityMax, 0.001, 100),
    durationMin: numberOrFallback(input.durationMin, fallback.durationMin, 0, 10),
    durationMax: numberOrFallback(input.durationMax, fallback.durationMax, 0, 10),
    longContactMs: numberOrFallback(input.longContactMs, fallback.longContactMs, 50, 60000),
    emaAlpha: numberOrFallback(input.emaAlpha, fallback.emaAlpha, 0, 1),
    cooldownMs: numberOrFallback(input.cooldownMs, fallback.cooldownMs, 0, 10000),
    sustainCooldownMs: numberOrFallback(input.sustainCooldownMs, fallback.sustainCooldownMs, 0, 10000),
    minIntensity: numberOrFallback(input.minIntensity, fallback.minIntensity, 0, 2),
    maxIntensity: numberOrFallback(input.maxIntensity, fallback.maxIntensity, 0, 2),
  };
}

function normalizeUi(input = {}, fallback = DEFAULT_SETTINGS.ui) {
  return {
    port: Math.round(numberOrFallback(input.port, fallback.port, 1, 65535)),
  };
}

function normalizeOsc(input = {}, fallback = DEFAULT_SETTINGS.osc) {
  return {
    port: Math.round(numberOrFallback(input.port, fallback.port, 1, 65535)),
    host: typeof input.host === 'string' && input.host.trim() ? input.host.trim() : fallback.host,
    sendHost: typeof input.sendHost === 'string' && input.sendHost.trim() ? input.sendHost.trim() : (fallback.sendHost ?? '127.0.0.1'),
    sendPort: Math.round(numberOrFallback(input.sendPort, fallback.sendPort ?? 9000, 1, 65535)),
    autoFreePorts: typeof input.autoFreePorts === 'boolean' ? input.autoFreePorts : fallback.autoFreePorts,
    useOscQuery: typeof input.useOscQuery === 'boolean' ? input.useOscQuery : (fallback.useOscQuery ?? true),
    oscQueryRequireBulk: typeof input.oscQueryRequireBulk === 'boolean' ? input.oscQueryRequireBulk : (fallback.oscQueryRequireBulk ?? true),
  };
}

function normalizeOgbSources(input = {}, fallback = DEFAULT_SETTINGS.lovense.ogb.sources) {
  return {
    ownHands: typeof input.ownHands === 'boolean' ? input.ownHands : fallback.ownHands,
    otherHands: typeof input.otherHands === 'boolean' ? input.otherHands : fallback.otherHands,
    myPlugs: typeof input.myPlugs === 'boolean' ? input.myPlugs : fallback.myPlugs,
    mySockets: typeof input.mySockets === 'boolean' ? input.mySockets : fallback.mySockets,
    otherPlugs: typeof input.otherPlugs === 'boolean' ? input.otherPlugs : fallback.otherPlugs,
    otherSockets: typeof input.otherSockets === 'boolean' ? input.otherSockets : fallback.otherSockets,
  };
}

function normalizeOgb(input = {}, fallback = DEFAULT_SETTINGS.lovense.ogb) {
  const kindsIn = Array.isArray(input.kinds) ? input.kinds : fallback.kinds;
  const validKinds = new Set(['plug', 'socket', 'touch']);
  const kinds = kindsIn.filter((k) => validKinds.has(k));
  return {
    kinds: kinds.length ? kinds : [...fallback.kinds],
    sources: normalizeOgbSources(input.sources, fallback.sources),
    includeIds: normalizeStringArray(input.includeIds, fallback.includeIds),
    excludeIds: normalizeStringArray(input.excludeIds, fallback.excludeIds),
  };
}

function normalizeBhaptics(input = {}, fallback = DEFAULT_SETTINGS.bhaptics) {
  return {
    appId: typeof input.appId === 'string' ? input.appId.trim() : fallback.appId,
    apiKey: typeof input.apiKey === 'string' ? input.apiKey.trim() : fallback.apiKey,
    remote: typeof input.remote === 'string' && input.remote.trim() ? input.remote.trim() : fallback.remote,
  };
}

function normalizeOnboarding(input = {}, fallback = DEFAULT_SETTINGS.onboarding) {
  return {
    completed: typeof input.completed === 'boolean' ? input.completed : fallback.completed,
  };
}

function normalizeHaptic(input = {}, fallback = DEFAULT_SETTINGS.haptic) {
  return {
    eventKey: typeof input.eventKey === 'string' && input.eventKey.trim() ? input.eventKey.trim() : fallback.eventKey,
    useDotMode: typeof input.useDotMode === 'boolean' ? input.useDotMode : fallback.useDotMode,
    vestMotorCount: Math.round(numberOrFallback(input.vestMotorCount, fallback.vestMotorCount, 1, 64)),
    motorClusterSize: Math.round(numberOrFallback(input.motorClusterSize, fallback.motorClusterSize, 0, 3)),
  };
}

function normalizeStringArray(input, fallback) {
  if (!Array.isArray(input)) return [...fallback];
  return input.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
}

function normalizeLovense(input = {}, fallback = DEFAULT_SETTINGS.lovense) {
  const buttplugIn = (input.buttplug && typeof input.buttplug === 'object') ? input.buttplug : {};
  const paramsIn = (input.params && typeof input.params === 'object') ? input.params : {};
  const mappingIn = (input.mapping && typeof input.mapping === 'object') ? input.mapping : {};
  const ogbIn = (input.ogb && typeof input.ogb === 'object') ? input.ogb : {};
  const mode = input.mode === 'legacy' ? 'legacy' : 'ogb';
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : fallback.enabled,
    backend: typeof input.backend === 'string' && input.backend.trim() ? input.backend.trim() : fallback.backend,
    mode,
    buttplug: {
      url: typeof buttplugIn.url === 'string' && buttplugIn.url.trim() ? buttplugIn.url.trim() : fallback.buttplug.url,
      clientName: typeof buttplugIn.clientName === 'string' && buttplugIn.clientName.trim() ? buttplugIn.clientName.trim() : fallback.buttplug.clientName,
    },
    ogb: normalizeOgb(ogbIn, fallback.ogb),
    params: {
      include: normalizeStringArray(paramsIn.include, fallback.params.include),
      ignore: normalizeStringArray(paramsIn.ignore, fallback.params.ignore),
    },
    mapping: {
      minIntensity: numberOrFallback(mappingIn.minIntensity, fallback.mapping.minIntensity, 0, 1),
      maxIntensity: numberOrFallback(mappingIn.maxIntensity, fallback.mapping.maxIntensity, 0, 1),
      contactTimeoutMs: Math.round(numberOrFallback(mappingIn.contactTimeoutMs, fallback.mapping.contactTimeoutMs, 50, 60000)),
      emaAlpha: numberOrFallback(mappingIn.emaAlpha, fallback.mapping.emaAlpha, 0, 1),
      minIntervalMs: Math.round(numberOrFallback(mappingIn.minIntervalMs, fallback.mapping.minIntervalMs, 0, 5000)),
      stopAfterIdleMs: Math.round(numberOrFallback(mappingIn.stopAfterIdleMs, fallback.mapping.stopAfterIdleMs, 50, 60000)),
      tickHz: numberOrFallback(mappingIn.tickHz, fallback.mapping.tickHz ?? 15, 5, 60),
      motionBased: typeof mappingIn.motionBased === 'boolean' ? mappingIn.motionBased : (fallback.mapping.motionBased ?? true),
      maxLevelParam: typeof mappingIn.maxLevelParam === 'string' ? mappingIn.maxLevelParam.trim() : (fallback.mapping.maxLevelParam ?? ''),
    },
    triggerVest: typeof input.triggerVest === 'boolean' ? input.triggerVest : fallback.triggerVest,
  };
}

function normalizeContactParams(input = {}, fallback = DEFAULT_SETTINGS.contactParams) {
  return {
    value: typeof input.value === 'string' && input.value.trim() ? input.value.trim() : fallback.value,
    speed: typeof input.speed === 'string' && input.speed.trim() ? input.speed.trim() : fallback.speed,
    zone: typeof input.zone === 'string' && input.zone.trim() ? input.zone.trim() : fallback.zone,
    acceptAll: typeof input.acceptAll === 'boolean' ? input.acceptAll : fallback.acceptAll,
    excludeFaceTracking: typeof input.excludeFaceTracking === 'boolean' ? input.excludeFaceTracking : fallback.excludeFaceTracking,
    contactTimeoutMs: Math.round(numberOrFallback(input.contactTimeoutMs, fallback.contactTimeoutMs, 50, 10000)),
    extra: normalizeStringArray(input.extra, fallback.extra),
    ignore: normalizeStringArray(input.ignore, fallback.ignore),
  };
}

function normalizeSettings(input = {}, fallback = DEFAULT_SETTINGS) {
  return {
    ui: normalizeUi(input.ui, fallback.ui),
    osc: normalizeOsc(input.osc, fallback.osc),
    bhaptics: normalizeBhaptics(input.bhaptics, fallback.bhaptics),
    onboarding: normalizeOnboarding(input.onboarding, fallback.onboarding),
    debug: typeof input.debug === 'boolean' ? input.debug : fallback.debug,
    intensity: normalizeIntensity(input.intensity, fallback.intensity),
    haptic: normalizeHaptic(input.haptic, fallback.haptic),
    contactParams: normalizeContactParams(input.contactParams, fallback.contactParams),
    lovense: normalizeLovense(input.lovense, fallback.lovense),
  };
}

function loadSettings() {
  if (!existsSync(settingsPath)) {
    const defaults = clone(DEFAULT_SETTINGS);
    saveSettings(defaults);
    return defaults;
  }
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    return normalizeSettings(parsed, DEFAULT_SETTINGS);
  } catch (e) {
    console.warn('[Settings] Failed to load user-settings.json, using defaults:', e.message);
    return clone(DEFAULT_SETTINGS);
  }
}

function saveSettings(settings) {
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
}

export const systemSettings = loadSettings();
let serializedSystemSettings = null;

const settingsListeners = new Set();

export function onSettingsUpdate(listener) {
  if (typeof listener !== 'function') return () => {};
  settingsListeners.add(listener);
  return () => settingsListeners.delete(listener);
}

function emitSettingsUpdate(prev) {
  for (const cb of settingsListeners) {
    try { cb(getSystemSettings(), prev); } catch (e) { console.warn('[Settings] listener error:', e?.message || e); }
  }
}

export function getSystemSettings() {
  return clone(systemSettings);
}

export function getSystemSettingsJson() {
  if (!serializedSystemSettings) serializedSystemSettings = JSON.stringify(systemSettings);
  return serializedSystemSettings;
}

export function updateSystemSettings(partial) {
  if (!partial || typeof partial !== 'object') return getSystemSettings();
  const prev = getSystemSettings();
  if (partial.ui && typeof partial.ui === 'object') {
    systemSettings.ui = normalizeUi(partial.ui, systemSettings.ui);
  }
  if (partial.osc && typeof partial.osc === 'object') {
    systemSettings.osc = normalizeOsc(partial.osc, systemSettings.osc);
  }
  if (partial.bhaptics && typeof partial.bhaptics === 'object') {
    systemSettings.bhaptics = normalizeBhaptics(partial.bhaptics, systemSettings.bhaptics);
  }
  if (partial.onboarding && typeof partial.onboarding === 'object') {
    systemSettings.onboarding = normalizeOnboarding(partial.onboarding, systemSettings.onboarding);
  }
  if (typeof partial.debug === 'boolean') {
    systemSettings.debug = partial.debug;
  }
  if (partial.intensity && typeof partial.intensity === 'object') {
    systemSettings.intensity = normalizeIntensity(partial.intensity, systemSettings.intensity);
  }
  if (partial.haptic && typeof partial.haptic === 'object') {
    systemSettings.haptic = normalizeHaptic(partial.haptic, systemSettings.haptic);
  }
  if (partial.contactParams && typeof partial.contactParams === 'object') {
    systemSettings.contactParams = normalizeContactParams(partial.contactParams, systemSettings.contactParams);
  }
  if (partial.lovense && typeof partial.lovense === 'object') {
    systemSettings.lovense = normalizeLovense(partial.lovense, systemSettings.lovense);
  }
  saveSettings(systemSettings);
  serializedSystemSettings = null;
  emitSettingsUpdate(prev);
  return getSystemSettings();
}

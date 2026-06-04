/**
 * VRChatOSC-bhaptics-js — точка входа: связывает VRChat OSC, жилет bHaptics и Lovense.
 */
import { config } from './config.js';
import { checkPort, freePorts } from './util/port-check.js';
import { createOSCListener } from './vrchat/osc-listener.js';
import { createStateAnalyzer, isFaceTrackingParam } from './bhaptics/state-analyzer.js';
import { createIntensityEngine } from './bhaptics/intensity-engine.js';
import { dashboardState } from './dashboard/state.js';
import { startDashboard } from './dashboard/server.js';
import { combineParsedMotorValues } from './bhaptics/motor-utils.js';
import { systemSettings, onSettingsUpdate } from './settings/store.js';
import { createLovenseEngine } from './lovense/engine.js';
import { createLovenseBridge } from './lovense/bridge.js';
import { createLovenseLoop } from './lovense/loop.js';
import { createVrcConfigCheck } from './vrchat/vrc-config-check.js';
import { createVrchatOscquery } from './vrchat/oscquery.js';

const OSC_STALE_MS = 15_000;

async function main() {
  console.log('[VRChatOSC-bhaptics-js] Запуск...');

  const oscPort = config.osc.port;
  const uiPort = config.ui?.port ?? 1969;

  if (config.osc?.autoFreePorts !== false) {
    freePorts([oscPort, uiPort]);
    await new Promise((r) => setTimeout(r, 500));
  }

  const [port9000, port9001, portUi] = await Promise.all([
    checkPort(9000),
    checkPort(oscPort),
    checkPort(uiPort),
  ]);

  if (!port9001.free) {
    console.error(`[VRChatOSC-bhaptics-js] Порт ${oscPort} (OSC) занят`);
    process.exit(1);
  }
  if (!portUi.free) {
    console.error(`[VRChatOSC-bhaptics-js] Порт ${uiPort} (Dashboard) занят`);
    process.exit(1);
  }

  if (!port9000.free) {
    console.log('[VRChatOSC-bhaptics-js] VRChat подключён (порт 9000 занят)');
  }
  dashboardState.osc.portStatus = port9001.free ? 'ok' : 'busy';
  dashboardState.osc.vrchatPortOpen = !port9000.free;
  console.log(`[VRChatOSC-bhaptics-js] OSC :${oscPort} | Dashboard :${uiPort}`);

  const lovenseEngine = createLovenseEngine(() => systemSettings.lovense);

  const stateAnalyzer = createStateAnalyzer(
    () => config.contactParams,
    (paramName) => {
      const lv = systemSettings.lovense;
      if (!lv?.enabled || !lv.triggerVest) return false;
      return lovenseEngine.isTracked(paramName);
    }
  );
  const intensityEngine = createIntensityEngine(() => systemSettings.intensity);

  const vestFrontMax = 19;
  const vestBackMax = 19;
  function getClusterSize() {
    return config.haptic?.motorClusterSize ?? 1;
  }
  let lastLogSummary = '';
  let lastLogTime = 0;

  function parseZoneAndMotor(lastParam) {
    const p = (lastParam || '').toLowerCase();
    const backMatch = p.match(/vest_back[_-]?(\d+)|back[_-]?(\d+)/i);
    const frontMatch = p.match(/vest_front[_-]?(\d+)|vestfront[_-]?(\d+)/i);
    if (backMatch) {
      const raw = parseInt(backMatch[1] || backMatch[2] || '0', 10);
      return { zone: 'Back', motorIndex: Math.min(vestBackMax, Math.max(0, raw)), rawMotorIndex: raw };
    }
    if (frontMatch) {
      const raw = parseInt(frontMatch[1] || frontMatch[2] || '0', 10);
      return { zone: 'Front', motorIndex: Math.min(vestFrontMax, Math.max(0, raw)), rawMotorIndex: raw };
    }
    if (/chest|front|vest_front/.test(p)) return { zone: 'Chest', motorIndex: null, rawMotorIndex: null };
    if (/stomach|belly/.test(p)) return { zone: 'Stomach', motorIndex: null, rawMotorIndex: null };
    if (/back|upperback|upper|lowerback|lower|vest_back/.test(p)) return { zone: 'Back', motorIndex: null, rawMotorIndex: null };
    return { zone: 'Chest', motorIndex: null, rawMotorIndex: null };
  }

  function parseActiveParams(activeParams) {
    return activeParams.map(({ param, value }) => ({ ...parseZoneAndMotor(param), param, value }));
  }

  function zoneFromParam(p) {
    const lp = (p || '').toLowerCase();
    const frontMatch = lp.match(/vest_front[_-]?(\d+)|vestfront[_-]?(\d+)/i);
    const backMatch = lp.match(/vest_back[_-]?(\d+)|back[_-]?(\d+)/i);
    if (frontMatch) {
      const raw = parseInt(frontMatch[1] || frontMatch[2] || '0', 10);
      const idx0 = Math.max(0, raw - 1);
      const row = Math.floor(Math.min(15, idx0) / 4);
      return row <= 1 ? 'chest' : 'stomach';
    }
    if (backMatch) {
      const raw = parseInt(backMatch[1] || backMatch[2] || '0', 10);
      const idx0 = Math.max(0, raw - 1);
      const row = Math.floor(Math.min(15, idx0) / 4);
      return row <= 1 ? 'upperBack' : 'lowerBack';
    }
    if (/stomach|belly/.test(lp)) return 'stomach';
    if (/upperback/.test(lp)) return 'upperBack';
    if (/lowerback/.test(lp)) return 'lowerBack';
    if (/back|vest_back/.test(lp)) return 'upperBack';
    if (/chest|front|vest_front/.test(lp)) return 'chest';
    return 'chest';
  }

  function canSendHaptic(activeParams) {
    const { allowZones, allowWhile, lastOscParams, stats } = dashboardState;
    const params = lastOscParams || {};

    const hasStateParams =
      'IsGrounded' in params || 'InStation' in params || 'AFK' in params || 'Seated' in params;
    if (hasStateParams && stats.messagesReceived >= 5) {
      const isGrounded = !!params.IsGrounded;
      const inStation = !!params.InStation;
      const afk = !!params.AFK;
      const seated = !!params.Seated;
      const stateOk =
        (allowWhile.grounded && isGrounded) ||
        (allowWhile.seated && seated) ||
        (allowWhile.inStation && inStation) ||
        (allowWhile.afk && afk);
      if (!stateOk) return false;
    }

    if (activeParams?.length) {
      return activeParams.some(({ param }) => {
        const zoneKey = zoneFromParam(param);
        return allowZones[zoneKey] !== false;
      });
    }

    const lastParam = dashboardState.contact?.lastParam;
    if (!lastParam) return false;
    return allowZones[zoneFromParam(lastParam)] !== false;
  }

  const { stop, hapticsBridge } = startDashboard(config.ui?.port ?? 1969);

  const lovenseBridge = createLovenseBridge(
    () => systemSettings.lovense,
    (patch) => {
      const lv = dashboardState.lovense;
      if (patch.status !== undefined) lv.status = patch.status;
      if (patch.error !== undefined) lv.error = patch.error;
      if (patch.url !== undefined) lv.url = patch.url;
      if (patch.deviceCount !== undefined) lv.deviceCount = patch.deviceCount;
      if (patch.deviceNames !== undefined) lv.deviceNames = patch.deviceNames;
    }
  );

  let oscStaleTimer = null;
  function markOscLive(ts = Date.now()) {
    dashboardState.osc.lastPacketAt = ts;
    dashboardState.osc.stale = false;
    if (oscStaleTimer) clearTimeout(oscStaleTimer);
    oscStaleTimer = setTimeout(() => {
      oscStaleTimer = null;
      dashboardState.osc.stale = true;
      lovenseEngine.clearOnAvatarChange();
    }, OSC_STALE_MS);
  }

  let oscListener = null;

  function applyBulkEntries(entries, timestamp = Date.now()) {
    if (!entries?.length) return;
    const p = dashboardState.lastOscParams;
    for (const { paramName, value } of entries) {
      if (!isFaceTrackingParam(paramName)) p[paramName] = value;
      if (systemSettings.lovense?.enabled) lovenseEngine.ingest(paramName, value, timestamp);
    }
  }

  const vrchatOscquery = createVrchatOscquery(
    () => systemSettings,
    {
      onStatus: (snap) => { Object.assign(dashboardState.oscQuery, snap); },
      onBulk: (entries, ts) => applyBulkEntries(entries, ts),
    }
  );
  vrchatOscquery.start();

  const lovenseLoop = createLovenseLoop({
    getConfig: () => systemSettings.lovense,
    engine: lovenseEngine,
    bridge: lovenseBridge,
    sendOscParam: (param, value) => oscListener?.sendParam?.(param, value),
    onTick: (intensity) => {
      dashboardState.lovense.lastIntensity = intensity;
      dashboardState.lovense.lastSent = Date.now();
      dashboardState.lovense.ogbDeviceCount = lovenseEngine.getOgbDeviceCount();
      dashboardState.lovense.mode = systemSettings.lovense?.mode || 'ogb';
    },
  });

  dashboardState.lovense.enabled = !!systemSettings.lovense?.enabled;
  dashboardState.lovense.mode = systemSettings.lovense?.mode || 'ogb';
  if (systemSettings.lovense?.enabled) {
    lovenseBridge.enable();
    lovenseLoop.restart();
  }

  const vrcConfigCheck = createVrcConfigCheck((st) => {
    Object.assign(dashboardState.vrcConfig, st);
  });
  vrcConfigCheck.start(5000);

  onSettingsUpdate((next, prev) => {
    const wasEnabled = !!prev?.lovense?.enabled;
    const isEnabled = !!next?.lovense?.enabled;
    const prevUrl = prev?.lovense?.buttplug?.url || '';
    const nextUrl = next?.lovense?.buttplug?.url || '';
    const tickChanged = (prev?.lovense?.mapping?.tickHz ?? 15) !== (next?.lovense?.mapping?.tickHz ?? 15);
    const modeChanged = (prev?.lovense?.mode || 'ogb') !== (next?.lovense?.mode || 'ogb');
    dashboardState.lovense.enabled = isEnabled;
    dashboardState.lovense.mode = next?.lovense?.mode || 'ogb';
    if (!wasEnabled && isEnabled) {
      lovenseBridge.enable();
      lovenseLoop.restart();
    } else if (wasEnabled && !isEnabled) {
      lovenseLoop.stop();
      lovenseEngine.reset();
      lovenseBridge.disconnectSoft().catch(() => {});
    } else if (isEnabled && prevUrl !== nextUrl) {
      lovenseBridge.disconnectSoft().then(() => lovenseBridge.enable()).catch(() => {});
    } else if (isEnabled && (tickChanged || modeChanged)) {
      lovenseEngine.reset();
      lovenseLoop.restart();
    }
    const prevOscQ = !!prev?.osc?.useOscQuery;
    const nextOscQ = next?.osc?.useOscQuery !== false;
    if (prevOscQ !== nextOscQ) vrchatOscquery.restart();
  });

  oscListener = createOSCListener(
    config,
    (msg) => {
      dashboardState.vrchat.connected = true;
      const v = dashboardState.avatar.oscType;
      if (!v || /^avtr_/i.test(v)) dashboardState.avatar.oscType = 'Avatar Parameters';
      dashboardState.stats.messagesReceived++;
      dashboardState.lastUpdate = Date.now();
      markOscLive(msg.timestamp);
      if (vrchatOscquery.isEnabled() && !dashboardState.oscQuery.hasBulk && !dashboardState.oscQuery.waitingForBulk) {
        void vrchatOscquery.fetchBulk();
      }
      const p = dashboardState.lastOscParams;
      if (!isFaceTrackingParam(msg.paramName)) {
        p[msg.paramName] = msg.value;
      }
      const pKeys = Object.keys(p);
      if (pKeys.length > 50) {
        for (let i = 0; i < pKeys.length - 30; i++) delete p[pKeys[i]];
      }

      if (systemSettings.lovense?.enabled) {
        lovenseEngine.ingest(msg.paramName, msg.value, msg.timestamp);
      }

      if (msg.ready === false) return;

      const snapshot = stateAnalyzer.update(msg);
      const { intensity, emit, touchType } = intensityEngine.process(snapshot);

      dashboardState.contact = { ...snapshot };
      dashboardState.intensity = intensity;

      const activeParams = snapshot.activeParams || [];
      const hasTouch = snapshot.lastParam || activeParams.length > 0;
      if (emit && intensity > 0.01 && hasTouch && canSendHaptic(activeParams)) {
        const now = Date.now();
        const vel = Math.max(snapshot.velocity ?? 0, snapshot.peakVelocity ?? 0);

        if (activeParams.length > 0) {
          const parsedTouches = parseActiveParams(activeParams);
          const motorValues = combineParsedMotorValues(parsedTouches, intensity, getClusterSize());
          const hasAny = motorValues.some((v) => v > 0);
          if (hasAny) {
            const logEntries = [];
            const byZone = new Map();
            for (const { param, value, zone: parsedZone, motorIndex, rawMotorIndex } of parsedTouches) {
              const zone = parsedZone === 'Front' ? 'Chest' : parsedZone;
              logEntries.push({ zone, param, motorIndex: rawMotorIndex ?? motorIndex, timestamp: now, intensity: value * intensity, velocity: vel });
              if (rawMotorIndex != null) {
                let motors = byZone.get(zone);
                if (!motors) {
                  motors = new Set();
                  byZone.set(zone, motors);
                }
                motors.add(rawMotorIndex);
              }
            }
            dashboardState.touchLog.unshift(...logEntries);
            if (dashboardState.touchLog.length > 50) dashboardState.touchLog.splice(50);
            const summary = [...byZone.entries()]
              .map(([z, motors]) => {
                const arr = [...motors].sort((a, b) => a - b);
                return arr.length ? `${z}#${arr.join(',')}` : z;
              })
              .join(' | ');
            if (config.debug && (summary !== lastLogSummary || now - lastLogTime > 300)) {
              lastLogSummary = summary;
              lastLogTime = now;
              const params = activeParams.map((a) => a.param).join(', ');
              console.log(
                `[Touch] ${summary} type=${touchType || 'unknown'} intensity=${intensity.toFixed(
                  2
                )} vel=${vel.toFixed(2)} | params: ${params}`
              );
            }
            hapticsBridge.sendHaptic(intensity, config, null, null, motorValues);
            dashboardState.stats.hapticsSent++;
            dashboardState.lastHaptic = now;
          }
        } else {
          const lastParam = snapshot.lastParam || '';
          const { zone: parsedZone, motorIndex, rawMotorIndex } = parseZoneAndMotor(lastParam);
          const zone = parsedZone === 'Front' ? 'Chest' : parsedZone;
          const entry = { zone, param: lastParam, motorIndex: rawMotorIndex ?? motorIndex, timestamp: now, intensity, velocity: vel };
          dashboardState.touchLog.unshift(entry);
          if (dashboardState.touchLog.length > 50) dashboardState.touchLog.splice(50);
          if (config.debug) {
            const loc = motorIndex != null ? ` motor #${motorIndex}` : '';
            console.log(
              `[Touch] ${zone}${loc} — ${lastParam || '—'} | type=${touchType || 'unknown'} intensity=${intensity.toFixed(
                2
              )} vel=${vel.toFixed(2)}`
            );
          }
          hapticsBridge.sendHaptic(intensity, config, zone, motorIndex);
          dashboardState.stats.hapticsSent++;
          dashboardState.lastHaptic = now;
        }
      }
    },
    (avatar) => {
      dashboardState.avatar.id = avatar.avatarId;
      dashboardState.avatar.oscType = 'Avatar Parameters';
      dashboardState.vrchat.connected = true;
      dashboardState.osc.avatarChangedAt = avatar.timestamp || Date.now();
      lovenseEngine.clearOnAvatarChange();
      dashboardState.lastOscParams = {};
    },
    { oscquery: vrchatOscquery }
  );

  dashboardState.osc.listening = true;
  dashboardState.osc.port = config.osc.port;

  const shutdown = () => {
    console.log('\n[VRChatOSC-bhaptics-js] Остановка...');
    let done = false;
    const forceExit = () => {
      if (!done) {
        done = true;
        console.log('[VRChatOSC-bhaptics-js] Принудительный выход');
        process.exit(0);
      }
    };
    setTimeout(forceExit, 3000);
    lovenseLoop.stop();
    vrchatOscquery.stop();
    if (oscStaleTimer) clearTimeout(oscStaleTimer);
    Promise.resolve(lovenseBridge.close()).catch(() => {}).finally(() => {
      oscListener.close(() => {
        stop(() => {
          done = true;
          process.exit(0);
        });
      });
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();

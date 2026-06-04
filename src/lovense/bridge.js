/**
 * Lovense / Buttplug bridge (connection-generation pattern from OscGoesBrrr).
 */

import { ButtplugClient, ButtplugNodeWebsocketClientConnector, DeviceOutput, OutputType } from 'buttplug';

const DEFAULT_URL = 'ws://127.0.0.1:12345';
const DEFAULT_CLIENT_NAME = 'VRChatOSC-bhaptics-js';
const RECONNECT_DELAY_MS = 5000;
const CONNECT_TIMEOUT_MS = 8000;

export function createLovenseBridge(getConfig, statusSink) {
  let client = null;
  let connected = false;
  let lastIntensity = -1;
  let stopTimer = null;
  let reconnectTimer = null;
  let connecting = false;
  let connectionGeneration = 0;
  let connectTimeout = null;

  function setStatus(patch) {
    if (!statusSink) return;
    try { statusSink(patch); } catch (_) {}
  }

  function listDevices() {
    if (!client) return [];
    return [...client.devices.values()];
  }

  function vibratable(d) {
    try { return d.hasOutput(OutputType.Vibrate); } catch (_) { return false; }
  }

  async function vibrateAll(level) {
    const devices = listDevices().filter(vibratable);
    if (!devices.length) return 0;
    const cmd = DeviceOutput.Vibrate.percent(Math.max(0, Math.min(1, level)));
    let ok = 0;
    await Promise.all(devices.map(async (d) => {
      try {
        if (level <= 0) await d.stop();
        else await d.runOutput(cmd);
        ok++;
      } catch (_) {}
    }));
    return ok;
  }

  function clearTimers() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
  }

  function teardownClient() {
    const c = client;
    client = null;
    connected = false;
    connecting = false;
    if (c) {
      c.disconnect().catch(() => {});
    }
  }

  function requestReconnect(delayMs = RECONNECT_DELAY_MS) {
    const cfg = getConfig();
    if (!cfg?.enabled) return;
    clearTimers();
    teardownClient();
    const gen = connectionGeneration;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (gen !== connectionGeneration) return;
      connect();
    }, delayMs);
  }

  async function connect() {
    const cfg = getConfig();
    if (!cfg?.enabled) return;
    if (connected || connecting) return;

    const gen = ++connectionGeneration;
    connecting = true;
    setStatus({ status: 'connecting', error: '' });

    connectTimeout = setTimeout(() => {
      if (gen !== connectionGeneration) return;
      setStatus({ status: 'error', error: 'Connection timeout' });
      requestReconnect();
    }, CONNECT_TIMEOUT_MS);

    try {
      const nextClient = new ButtplugClient(cfg.buttplug?.clientName?.trim() || DEFAULT_CLIENT_NAME);
      nextClient.on('deviceadded', () => {
        if (gen !== connectionGeneration) return;
        setStatus({ deviceCount: nextClient.devices.size, deviceNames: listDevices().map((x) => x.name) });
      });
      nextClient.on('deviceremoved', () => {
        if (gen !== connectionGeneration) return;
        setStatus({ deviceCount: nextClient?.devices.size ?? 0, deviceNames: listDevices().map((x) => x.name) });
      });
      nextClient.on('disconnect', () => {
        if (gen !== connectionGeneration) return;
        connected = false;
        setStatus({ status: 'disconnected', deviceCount: 0, deviceNames: [] });
        requestReconnect();
      });

      const url = cfg.buttplug?.url?.trim() || DEFAULT_URL;
      const connector = new ButtplugNodeWebsocketClientConnector(url);
      await nextClient.connect(connector);
      if (gen !== connectionGeneration) {
        await nextClient.disconnect().catch(() => {});
        return;
      }

      client = nextClient;
      connected = true;
      connecting = false;
      if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
      setStatus({ status: 'connected', error: '', url });
      try { await nextClient.startScanning(); } catch (_) {}
    } catch (e) {
      if (gen !== connectionGeneration) return;
      connecting = false;
      connected = false;
      client = null;
      if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
      setStatus({ status: 'error', error: e?.message || String(e) });
      requestReconnect();
    }
  }

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  function send(rawIntensity) {
    if (!connected) return;
    const cfg = getConfig();
    if (!cfg?.enabled) return;
    const minI = clamp01(cfg.mapping?.minIntensity ?? 0);
    const maxI = clamp01(cfg.mapping?.maxIntensity ?? 1);
    const idleStopMs = Math.max(50, Math.round(cfg.mapping?.stopAfterIdleMs ?? 400));
    const eps = 0.005;

    let level = clamp01(rawIntensity);
    if (level > 0) level = clamp01(minI + level * (maxI - minI));

    if (Math.abs(level - lastIntensity) >= eps || (level === 0 && lastIntensity !== 0)) {
      lastIntensity = level;
      vibrateAll(level).catch(() => {});
    }

    if (stopTimer) clearTimeout(stopTimer);
    if (level > 0) {
      stopTimer = setTimeout(() => {
        stopTimer = null;
        if (lastIntensity !== 0) {
          lastIntensity = 0;
          vibrateAll(0).catch(() => {});
        }
      }, idleStopMs);
    }
  }

  async function stopAll() {
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    lastIntensity = 0;
    try { await vibrateAll(0); } catch (_) {}
  }

  async function disconnectSoft() {
    connectionGeneration++;
    clearTimers();
    await stopAll();
    teardownClient();
    setStatus({ status: 'disabled', deviceCount: 0, deviceNames: [], error: '' });
  }

  function enable() {
    connectionGeneration++;
    return connect();
  }

  async function close() {
    await disconnectSoft();
  }

  return {
    connect,
    enable,
    disconnectSoft,
    send,
    stopAll,
    close,
    isConnected: () => connected,
    deviceCount: () => (client ? client.devices.size : 0),
    deviceNames: () => listDevices().map((d) => d.name),
  };
}

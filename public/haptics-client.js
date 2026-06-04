/**
 * tact-js работает только в браузере.
 * Подключается к bHaptics Player, слушает WebSocket, выполняет haptic-команды.
 * Автоопределение устройства и количества моторов.
 */
(async () => {
  const wsUrl = `ws://${location.host}/haptics`;
  const ws = new WebSocket(wsUrl);

  let Tact = null;
  let PositionType = null;
  let detectedMotorCount = 16;
  let pendingStatus = null;
  let devicePollBusy = false;
  let devicePollTimer = null;

  function sendStatus(status, error = '') {
    pendingStatus = { type: 'hapticsStatus', status, error };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(pendingStatus));
    }
  }

  ws.addEventListener('open', () => {
    if (pendingStatus) ws.send(JSON.stringify(pendingStatus));
  });

  function inferVestMotorCount(dev) {
    if (!dev || typeof dev !== 'object') return 16;
    const name = String(dev.name || dev.deviceName || dev.DeviceName || dev.Device || dev.type || '').toLowerCase();
    const pos = dev.position ?? dev.Position;
    if (pos && typeof pos === 'object' && Array.isArray(pos.motors)) return pos.motors.length;
    if (/x40/.test(name)) return 40;
    if (/pro|32/.test(name)) return 32;
    if (/air|x16|16/.test(name)) return 16;
    return 16;
  }

  /** Поля версии прошивки из bHaptics Player / tact-js (названия могут отличаться). */
  const FIRMWARE_KEYS = [
    'firmwareVersion',
    'FirmwareVersion',
    'firmware',
    'Firmware',
    'fwVersion',
    'FwVersion',
    'deviceVersion',
    'DeviceVersion',
    'mcuVersion',
    'McuVersion',
    'version',
    'Version',
    'fw',
    'FW',
  ];

  function firmwareFromObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    for (const k of FIRMWARE_KEYS) {
      const v = obj[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    const nested = obj.details ?? obj.info ?? obj.metadata ?? obj.Meta;
    if (nested && typeof nested === 'object') {
      for (const k of FIRMWARE_KEYS) {
        const v = nested[k];
        if (v != null && String(v).trim() !== '') return String(v).trim();
      }
    }
    return null;
  }

  function extractFirmware(primaryDev, allDevices) {
    let fw = firmwareFromObject(primaryDev);
    if (fw) return fw;
    if (!Array.isArray(allDevices)) return null;
    for (const d of allDevices) {
      fw = firmwareFromObject(d);
      if (fw) return fw;
    }
    return null;
  }

  try {
    const mod = await import('/tact/bundle.js');
    Tact = mod.default;
    PositionType = mod.PositionType;

    const cfgRes = await fetch('/api/bhaptics-config');
    const cfg = await cfgRes.json();
    if (!cfg.appId || !cfg.apiKey) {
      sendStatus('missingCredentials', 'bHaptics appId/apiKey are not configured.');
      return;
    }
    if (cfg.appId && cfg.apiKey) {
      const initParams = { appId: cfg.appId, apiKey: cfg.apiKey };
      if (cfg.remote) initParams.remote = cfg.remote;
      sendStatus('connecting');
      await Tact.init(initParams);
      console.log('[Haptics] Connected to bHaptics Player');
      sendStatus('ready');
      ws.send(JSON.stringify({ type: 'ready' }));

      const pollDeviceInfo = async () => {
        if (!Tact || devicePollBusy) return;
        devicePollBusy = true;
        try {
          const devices = await Tact.getConnectedDevices();
          const arr = Array.isArray(devices) ? devices : [];
          const dev = arr.find((d) => /vest|tactsuit|tact suit/i.test(String(d.name || d.deviceName || d.type || d.position || ''))) || arr[0] || {};
          const findVal = (obj, ...keys) => {
            for (const k of keys) {
              const v = obj?.[k];
              if (v != null) return v;
            }
            return null;
          };
          detectedMotorCount = inferVestMotorCount(dev);
          const data = {
            devices: arr,
            battery: findVal(dev, 'battery', 'batteryLevel', 'Battery', 'battery_percent', 'BatteryLevel'),
            deviceName: findVal(dev, 'name', 'deviceName', 'DeviceName', 'Device') || (arr.length ? 'TactSuit' : null),
            vestMotorCount: detectedMotorCount,
            firmwareVersion: extractFirmware(dev, arr),
          };
          ws.send(JSON.stringify({ type: 'deviceInfo', data }));
        } catch (_) {
        } finally {
          devicePollBusy = false;
        }
      };
      pollDeviceInfo();
      devicePollTimer = setInterval(pollDeviceInfo, 5000);
    }
  } catch (e) {
    sendStatus('error', e.message || 'bHaptics init failed');
    console.warn('[Haptics] Init failed:', e.message);
  }

  ws.onmessage = async (ev) => {
    if (!Tact) return;
    try {
      const { type, intensity, zone, motorIndex, motorIndices, motorValues: rawMotorValues, useDotMode, eventKey } = JSON.parse(ev.data);
      if (type !== 'play' || intensity < 0.01) return;
      const ratio = Math.max(0, Math.min(2.0, intensity));

      if (useDotMode) {
        const VEST_MOTORS = 32;
        let motorValues = Array(VEST_MOTORS).fill(0);
        if (Array.isArray(rawMotorValues) && rawMotorValues.length >= VEST_MOTORS) {
          motorValues = rawMotorValues.slice(0, VEST_MOTORS).map((v) => Math.round(Math.min(100, Math.max(0, v))));
        } else {
          let indices = [];
          if (Array.isArray(motorIndices) && motorIndices.length > 0) {
            indices = motorIndices.filter((i) => i >= 0 && i < VEST_MOTORS);
          } else {
            const z = (zone || '').toLowerCase();
            const isBack = /back|vest_back/i.test(z);
            const isFront = /chest|front|stomach|belly|vest_front/i.test(z);
            if (typeof motorIndex === 'number' && motorIndex >= 0 && motorIndex <= 19) {
              const m = Math.min(15, motorIndex);
              indices = [isBack ? m + 16 : m];
            } else if (isBack) {
              indices = [...Array(16).keys()].map((i) => i + 16);
            } else if (isFront) {
              indices = [...Array(16).keys()];
            } else return;
          }
          const val = Math.round(Math.min(100, 100 * ratio));
          for (const i of indices) {
            if (i >= 0 && i < VEST_MOTORS) motorValues[i] = val;
          }
        }
        await Tact.playDot({ position: PositionType.Vest, motorValues, duration: 150 });
      } else {
        await Tact.play({ eventKey: eventKey || 'customTouch', intensityRatio: ratio, durationRatio: 1 });
      }
    } catch (e) {
      sendStatus('playError', e.message || 'bHaptics play error');
      console.warn('[Haptics] play error:', e.message);
    }
  };

  ws.addEventListener('close', () => {
    if (devicePollTimer) clearInterval(devicePollTimer);
  });
})();

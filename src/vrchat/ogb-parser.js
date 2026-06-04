/**
 * OGB / TPS / VFH protocol parser. Inspired by OscGoesBrrr's GameDevice/bridge.
 *
 * Распознаёт VRChat-параметры формата:
 *   OGB/{type}/{id}/{contactType}        (open-source SPS / OGB)
 *   TPS_Internal/{type}/{id}/{contactType} (legacy TPS)
 *   VFH/Zone/{type}/{id}/{contactType}   (VFH zones)
 *
 * Где:
 *   type        — 'Pen' (пенетратор) | 'Orf' (отверстие) | 'Touch'
 *   id          — уникальный идентификатор устройства
 *   contactType — TouchSelf, TouchOthers, PenSelf, PenOthers, FrotOthers,
 *                 Depth_In, Self, Others, и т.д.
 *
 * Каждое уникальное (type, id) даёт `GameDevice`. На каждое OSC-сообщение
 * с подходящим адресом значение пишется в соответствующий слот; при смене
 * аватара / простое — устройства очищаются.
 */

const KNOWN_CONTACT_KEYS = new Set([
  'TouchSelf', 'TouchOthers', 'TouchSelfClose', 'TouchOthersClose',
  'PenSelf', 'PenOthers', 'PenOthersClose',
  'FrotOthers', 'FrotOthersClose',
  'Depth_In', 'RootRoot',
  'PenSelfNewRoot', 'PenSelfNewTip',
  'PenOthersNewRoot', 'PenOthersNewTip',
  'Self', 'Others',
]);

class GameDevice {
  constructor(type, id, isTps = false) {
    this.type = type;
    this.id = id;
    this.isTps = !!isTps;
    this.values = new Map();
  }

  set(key, value, timestamp) {
    this.values.set(key, { value: Number(value) || 0, timestamp });
  }

  get(key) {
    return this.values.get(key);
  }

  getNumber(key) {
    const v = this.values.get(key);
    return v ? v.value : undefined;
  }

  getBool(key) {
    const v = this.values.get(key);
    if (!v) return false;
    return !!v.value;
  }

  /**
   * Возвращает массив { sourceKey, level } для текущего устройства, согласно фильтру.
   * filter: { kind, sources: { ownHands, otherHands, myPlugs, mySockets, otherPlugs, otherSockets } }
   */
  getSources(filter) {
    const out = [];
    const s = filter.sources || {};
    const push = (enabled, sourceKey, level) => {
      if (enabled && level > 0) out.push({ sourceKey, level });
    };

    if (this.isTps) {
      if (this.type === 'Orf' && filter.kind === 'socket') {
        push(s.otherPlugs, 'penOthers', this.getNumber('Depth_In') ?? 0);
      }
      if (this.type === 'Pen' && filter.kind === 'plug') {
        push(s.otherSockets, 'penOthers', this.getNumber('RootRoot') ?? 0);
      }
      return out;
    }

    if (this.type === 'Orf' && filter.kind === 'socket') {
      const touchSelf = this.getBool('TouchSelfClose') ? this.getNumber('TouchSelf') ?? 0 : 0;
      const touchOthers = this.getBool('TouchOthersClose') ? this.getNumber('TouchOthers') ?? 0 : 0;
      const penSelf = this.getNumber('PenSelf') ?? 0;
      const penOthersLegacyClose = this.getBool('PenOthersClose') || this.values.get('PenOthersClose') === undefined;
      const penOthers = penOthersLegacyClose ? (this.getNumber('PenOthers') ?? 0) : 0;
      const frotOthers = this.getNumber('FrotOthers') ?? 0;
      push(s.ownHands, 'touchSelf', touchSelf);
      push(s.otherHands, 'touchOthers', touchOthers);
      push(s.myPlugs, 'penSelf', penSelf);
      push(s.otherPlugs, 'penOthers', penOthers);
      push(s.otherSockets, 'frotOthers', frotOthers);
    }
    if (this.type === 'Pen' && filter.kind === 'plug') {
      const touchSelf = this.getBool('TouchSelfClose') ? this.getNumber('TouchSelf') ?? 0 : 0;
      const touchOthers = this.getBool('TouchOthersClose') ? this.getNumber('TouchOthers') ?? 0 : 0;
      const penSelf = this.getNumber('PenSelf') ?? 0;
      const penOthers = this.getNumber('PenOthers') ?? 0;
      const frotOthers = this.getBool('FrotOthersClose') ? this.getNumber('FrotOthers') ?? 0 : 0;
      push(s.ownHands, 'touchSelf', touchSelf);
      push(s.otherHands, 'touchOthers', touchOthers);
      push(s.mySockets, 'penSelf', penSelf);
      push(s.otherSockets, 'penOthers', penOthers);
      push(s.otherPlugs, 'frotOthers', frotOthers);
    }
    if (this.type === 'Touch' && filter.kind === 'touch') {
      push(s.ownHands, 'touchSelf', this.getNumber('Self') ?? 0);
      push(s.otherHands, 'touchOthers', this.getNumber('Others') ?? 0);
    }
    return out;
  }
}

export function createOgbParser() {
  /** @type {Map<string, GameDevice>} */
  const devices = new Map();

  function parse(paramName) {
    if (!paramName || typeof paramName !== 'string') return null;
    const split = paramName.split('/');
    if (split.length < 4) return null;

    if (split[0] === 'OGB' || split[0] === 'TPS_Internal') {
      const isTps = split[0] === 'TPS_Internal';
      const type = split[1];
      const id = split[2];
      const contactType = split.slice(3).join('/');
      if (!type || !id || !contactType) return null;
      return { isTps, type, id, contactType, devKey: `${isTps ? 'tps' : 'ogb'}__${type}__${id}` };
    }
    if (split[0] === 'VFH' && split[1] === 'Zone') {
      const type = split[2];
      const id = split[3];
      const contactType = split.slice(4).join('/');
      if (!type || !id || !contactType) return null;
      return { isTps: false, type, id, contactType, devKey: `vfh__${type}__${id}` };
    }
    return null;
  }

  /**
   * Зарегистрировать OSC-обновление. Возвращает true, если параметр относится к OGB.
   */
  function update(paramName, value, timestamp) {
    const parsed = parse(paramName);
    if (!parsed) return false;
    let device = devices.get(parsed.devKey);
    if (!device) {
      device = new GameDevice(parsed.type, parsed.id, parsed.isTps);
      devices.set(parsed.devKey, device);
    }
    device.set(parsed.contactType, value, timestamp);
    return true;
  }

  function clear() {
    devices.clear();
  }

  function getDevices() {
    const all = [...devices.values()];
    const hasOgb = all.some((d) => !d.isTps);
    return hasOgb ? all.filter((d) => !d.isTps) : all;
  }

  function getStatusList() {
    return getDevices().map((d) => ({ type: d.type, id: d.id, isTps: d.isTps }));
  }

  /** Сбросить значения старше timeoutMs (полное удаление параметра). */
  function pruneStale(now, timeoutMs) {
    for (const [, device] of devices) {
      for (const [key, slot] of device.values) {
        if (now - slot.timestamp > timeoutMs) device.values.delete(key);
      }
    }
  }

  /**
   * Агрегировать максимальный уровень по всем устройствам, сгруппированным фильтром.
   * Возвращает { level, motionLevel, sources: [{deviceId, sourceKey, level}] }.
   */
  function aggregate(filter, lastSourceLevels = new Map(), motionDtMs = 0, devicePredicate = null) {
    let level = 0;
    let motionLevel = 0;
    const sources = [];
    const candidate = (a, b) => (a > b ? a : b);
    for (const device of getDevices()) {
      if (devicePredicate && !devicePredicate(device)) continue;
      for (const src of device.getSources(filter)) {
        const fullKey = `${device.type}/${device.id}/${src.sourceKey}`;
        sources.push({ key: fullKey, level: src.level });
        level = candidate(level, src.level);
        if (motionDtMs > 0) {
          const prev = lastSourceLevels.get(fullKey);
          if (prev !== undefined) {
            const diff = Math.abs(src.level - prev);
            const perSecond = (diff / motionDtMs) * 1000;
            const intensity = Math.min(1, perSecond / 5);
            motionLevel = candidate(motionLevel, intensity);
          }
        }
      }
    }
    return { level, motionLevel, sources };
  }

  return { update, clear, getDevices, getStatusList, pruneStale, aggregate, KNOWN_CONTACT_KEYS };
}

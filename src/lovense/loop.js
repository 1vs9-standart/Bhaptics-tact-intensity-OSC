/**
 * Lovense tick-loop (~15 Гц), как pushToBio() в OscGoesBrrr bridge.ts.
 */

export function createLovenseLoop({ getConfig, engine, bridge, sendOscParam, onTick }) {
  let timer = null;
  let lastMaxLevelSent = -1;

  function tick() {
    const cfg = getConfig();
    if (!cfg?.enabled) return;
    const intensity = engine.tick(Date.now());
    if (typeof onTick === 'function') {
      try { onTick(intensity); } catch (_) {}
    }
    bridge.send(intensity);

    const maxParam = cfg?.mapping?.maxLevelParam?.trim();
    if (maxParam && typeof sendOscParam === 'function') {
      const eps = 0.01;
      if (Math.abs(intensity - lastMaxLevelSent) >= eps) {
        lastMaxLevelSent = intensity;
        sendOscParam(maxParam, intensity);
      }
    }
  }

  function restart() {
    stop();
    const cfg = getConfig();
    if (!cfg?.enabled) return;
    const hz = Math.max(5, Math.min(60, cfg?.mapping?.tickHz ?? 15));
    const intervalMs = Math.round(1000 / hz);
    timer = setInterval(tick, intervalMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    lastMaxLevelSent = -1;
  }

  return { restart, stop, tick };
}

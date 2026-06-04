/**
 * Intensity Engine — вычисляет динамическую интенсивность по velocity и duration
 */
export function createIntensityEngine(getIntensitySettings) {
  function readCfg() {
    const value = typeof getIntensitySettings === 'function' ? getIntensitySettings() : getIntensitySettings;
    return value ?? {};
  }

  let lastEmit = 0;
  let ema = 0;
  let lastType = 'idle';

  function process(snapshot) {
    const cfg = readCfg();
    const impactThreshold = cfg.impactThreshold ?? 0.5;
    const velocityMin = cfg.velocityMin ?? 0.3;
    const velocityMax = cfg.velocityMax ?? 2.0;
    const durationMin = cfg.durationMin ?? 0.1;
    const durationMax = cfg.durationMax ?? 1.0;
    const longContactMs = cfg.longContactMs ?? 2000;
    const emaAlpha = cfg.emaAlpha ?? 0.3;
    const cooldownMs = cfg.cooldownMs ?? 50;
    const sustainCooldownMs = cfg.sustainCooldownMs ?? 200;
    const minIntensity = cfg.minIntensity ?? 0.0;
    const maxIntensity = cfg.maxIntensity ?? 2.0;

    const { velocity, duration, contactActive, peakVelocity, value } = snapshot;
    const now = Date.now();

    let intensity = 0;
    let touchType = 'idle';

    const v = Math.max(velocity, peakVelocity);
    const isImpact = v > impactThreshold && duration < 0.25;

    if (isImpact) {
      const normVel = Math.min(1, (v - velocityMin) / (velocityMax - velocityMin));
      intensity = minIntensity + (maxIntensity - minIntensity) * Math.max(0, normVel);
      touchType = 'impact';
    } else if (contactActive && duration > 0) {
      const t = Math.min(1, (duration * 1000) / longContactMs);
      const base = durationMin + (durationMax - durationMin) * t;
      intensity = base * (0.7 + 0.3 * Math.max(0, Math.min(1, value ?? 0)));
      touchType = 'smooth';
    }

    intensity = Math.max(minIntensity, Math.min(maxIntensity, intensity));

    if (intensity > 0) {
      ema = emaAlpha * intensity + (1 - emaAlpha) * ema;
      intensity = ema;
    }

    const sinceLast = now - lastEmit;
    const cooldown = touchType === 'impact' ? cooldownMs : sustainCooldownMs;
    const emit = intensity > (minIntensity || 0.01) && sinceLast >= cooldown;

    if (emit) {
      lastEmit = now;
      lastType = touchType;
    } else {
      touchType = lastType;
    }

    return { intensity, emit, touchType };
  }

  return { process };
}

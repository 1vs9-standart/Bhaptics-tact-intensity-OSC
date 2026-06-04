/**
 * Проверка настроек VRChat в реестре Windows (как OscGoesBrrr VrcConfigCheck).
 * native-reg — optionalDependency; без него возвращает unknown.
 */

export function createVrcConfigCheck(onUpdate) {
  const state = {
    available: false,
    oscEnabled: null,
    selfInteractEnabled: null,
    everyoneInteractEnabled: null,
    loggingFull: null,
    lastCheck: 0,
    error: '',
  };

  async function checkOnce() {
    state.lastCheck = Date.now();
    try {
      const reg = await import('native-reg');
      const vrChatKey = reg.openKey(reg.HKCU, 'Software\\VRChat\\VRChat', reg.Access.READ);
      if (!vrChatKey) {
        state.available = false;
        state.error = 'registry_key_missing';
        onUpdate?.(state);
        return;
      }
      try {
        const subKeys = reg.enumValueNames(vrChatKey);
        const getValue = (subKey) => {
          const searchLower = subKey.toLowerCase();
          const realKey = subKeys.find((key) => {
            const lower = key.toLowerCase();
            return lower === searchLower || lower.startsWith(searchLower + '_h');
          });
          if (!realKey) return null;
          return reg.queryValue(vrChatKey, realKey);
        };
        state.available = true;
        state.error = '';
        state.oscEnabled = getValue('UI.Settings.Osc') === 1;
        state.selfInteractEnabled = getValue('VRC_AV_INTERACT_SELF') === 1;
        state.everyoneInteractEnabled = getValue('VRC_AV_INTERACT_LEVEL') === 2;
        state.loggingFull = getValue('LOGGING_ENABLED') === 1;
      } finally {
        reg.closeKey(vrChatKey);
      }
    } catch (e) {
      state.available = false;
      state.error = e?.code === 'ERR_MODULE_NOT_FOUND' ? 'native_reg_missing' : (e?.message || String(e));
    }
    onUpdate?.(state);
  }

  function start(intervalMs = 5000) {
    void checkOnce();
    return setInterval(() => { void checkOnce(); }, intervalMs);
  }

  return { start, checkOnce, getState: () => ({ ...state }) };
}

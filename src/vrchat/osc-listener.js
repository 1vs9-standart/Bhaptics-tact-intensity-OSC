import { Server, Client, Message } from 'node-osc';

/**
 * OSC Listener — принимает параметры от VRChat и (опционально) шлёт обратно.
 * При OSCQuery send-target берётся из HOST_INFO (OSC_IP / OSC_PORT).
 */
export function createOSCListener(config, onMessage, onAvatarChange, options = {}) {
  const { oscquery } = options;
  const { port, host } = config.osc;
  const fallbackSendHost = config.osc?.sendHost || '127.0.0.1';
  const fallbackSendPort = config.osc?.sendPort ?? 9000;

  const server = new Server(port, host, () => {
    console.log(`[OSC] Listening on ${host}:${port}`);
  });

  let sender = null;
  let senderKey = '';

  function getSendTarget() {
    if (oscquery?.isEnabled?.()) {
      const t = oscquery.getOscSendTarget();
      if (t?.host && t?.port) return t;
    }
    return { host: fallbackSendHost, port: fallbackSendPort };
  }

  function getSender() {
    const { host: sh, port: sp } = getSendTarget();
    const key = `${sh}:${sp}`;
    if (!sender || senderKey !== key) {
      try { sender?.close(); } catch (_) {}
      sender = new Client(sh, sp);
      senderKey = key;
    }
    return sender;
  }

  function sendParam(paramName, value) {
    if (!paramName || typeof paramName !== 'string') return;
    const num = Number(value);
    if (!Number.isFinite(num)) return;
    try {
      const c = getSender();
      const msg = new Message(`/avatar/parameters/${paramName}`);
      msg.append(num);
      c.send(msg, () => {});
    } catch (_) {}
  }

  function isProcessingReady() {
    if (!oscquery?.isEnabled?.()) return true;
    return oscquery.isReady();
  }

  server.on('message', (msg) => {
    const [address, ...args] = msg;
    if (!address) return;

    if (address === '/avatar/change') {
      const avatarId = args[0];
      const timestamp = Date.now();
      if (oscquery?.isEnabled?.()) {
        oscquery.markAvatarChanged();
      }
      if (avatarId != null) {
        onAvatarChange?.({ avatarId: String(avatarId), timestamp });
      }
      return;
    }

    if (address.startsWith('/avatar/parameters/')) {
      const paramName = address.replace('/avatar/parameters/', '');
      const value = args[0];
      const type = typeof value;

      if (type !== 'number' && type !== 'boolean') return;

      const numValue = type === 'boolean' ? (value ? 1 : 0) : value;
      onMessage({
        paramName,
        value: numValue,
        timestamp: Date.now(),
        ready: isProcessingReady(),
      });
    }
  });

  return {
    close(cb) {
      try { sender?.close(); } catch (_) {}
      sender = null;
      senderKey = '';
      server.close(cb || (() => {}));
    },
    sendParam,
    isProcessingReady,
    getSendTarget,
  };
}

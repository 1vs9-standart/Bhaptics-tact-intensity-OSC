import { execSync } from 'child_process';
import net from 'net';

export function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve({ port, free: false }));
    server.once('listening', () => {
      server.close(() => resolve({ port, free: true }));
    });
    server.listen(port, '127.0.0.1');
  });
}

const SAFE_PORT_RE = /^\d+$/;
function getPidsListeningOnPort(port) {
  const p = String(port);
  if (!SAFE_PORT_RE.test(p) || p.length > 5) return [];
  const num = parseInt(p, 10);
  if (num < 1 || num > 65535) return [];
  try {
    const out = execSync(`netstat -ano | findstr :${num}`, { encoding: 'utf-8' });
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (!line.toUpperCase().includes('LISTENING')) continue;
      const m = line.trim().match(/\s+(\d+)\s*$/);
      if (m && m[1] !== '0') pids.add(m[1]);
    }
    return [...pids];
  } catch {
    return [];
  }
}

export function freePorts(ports) {
  for (const port of ports) {
    const pids = getPidsListeningOnPort(port);
    for (const pid of pids) {
      if (!SAFE_PORT_RE.test(String(pid)) || String(pid).length > 8) continue;
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
        console.log(`[VRChatOSC-bhaptics-js] Freed port ${port} (killed PID ${pid})`);
      } catch (_) {}
    }
  }
}

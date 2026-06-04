/**
 * Fallback: порт OSCQuery из output_log VRChat (как OscGoesBrrr).
 */

import { createReadStream, existsSync, readdirSync } from 'fs';
import { createInterface } from 'readline';
import { homedir } from 'os';
import { join } from 'path';

function getVrcLogDir() {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) return join(localAppData, 'Low', 'VRChat', 'VRChat');
  }
  if (process.platform === 'linux') {
    return join(homedir(), '.local/share/Steam/steamapps/compatdata/438100/pfx/drive_c/users/steamuser/AppData/LocalLow/VRChat/VRChat');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library/Logs/Unity/Player.log');
  }
  return null;
}

export async function findOscqueryPortFromLogs() {
  const dir = getVrcLogDir();
  if (!dir || !existsSync(dir)) return { port: undefined, logsFound: false };

  let files;
  try {
    files = readdirSync(dir).filter((n) => n.startsWith('output_log'));
  } catch {
    return { port: undefined, logsFound: false };
  }
  if (!files.length) return { port: undefined, logsFound: true };

  files.sort();
  const logPath = join(dir, files[files.length - 1]);
  let port;

  const input = createReadStream(logPath, { encoding: 'utf8' });
  const rl = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const m = line.match(/of type OSCQuery on (\d+)/);
      if (m) port = parseInt(m[1], 10);
    }
  } finally {
    input.destroy();
    rl.close();
  }
  return { port, logsFound: true };
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function loadKey() {
  const file = path.join(os.homedir(), '.config/elevenlabs/.env');
  if (!fs.existsSync(file)) {
    throw new Error(`Нет ключа ElevenLabs. Положи его в ${file} строкой ELEVENLABS_API_KEY=sk_...`);
  }
  const m = fs.readFileSync(file, 'utf8').match(/^ELEVENLABS_API_KEY=(.+)$/m);
  if (!m) throw new Error(`В ${file} нет строки ELEVENLABS_API_KEY=`);
  return m[1].trim();
}

export const mask = (k) => `${k.slice(0, 6)}...***...${k.slice(-4)}`;

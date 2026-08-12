import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { preparePublic } from './lib/public-dir.mjs';
import { fileURLToPath } from 'node:url';

// Studio запускается через этот скрипт, а не напрямую: public/project нужно
// привязать к нужному ролику до старта (дефект I7 — в бандл больше не едет вся
// папка projects, поэтому кто-то должен положить туда текущий ролик).
const slug = process.argv[2];
if (!slug) {
  console.error('Использование: node scripts/studio.mjs <slug>');
  process.exit(1);
}

const engine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
preparePublic(engine, slug);
console.log(`public/project → projects/${slug}`);

const res = spawnSync('npx', ['remotion', 'studio', ...process.argv.slice(3)], {
  cwd: engine,
  stdio: 'inherit',
});
process.exit(res.status ?? 1);

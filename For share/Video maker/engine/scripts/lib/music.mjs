import fs from 'node:fs';
import path from 'node:path';

// Реестр музыки (дефект I6).
//
// Правило «трек без строки в LICENSES.md не подключается» до этого жило только
// текстом в SKILL.md — то есть держалось на внимании. Теперь это код: рендер
// падает ДО обращения к Remotion, если трека нет в реестре или нет самого файла.
//
// Хранение: сами файлы лежат в engine/assets/music/ рядом с реестром и под git,
// а engine/public/music — генерируемая КОПИЯ этой папки, которую перед каждым
// рендером/студией собирает scripts/lib/public-dir.mjs (public целиком
// собирается скриптами и в git не хранится). Копия, а не симлинк: Remotion
// зовёт serveStatic с allowOutsidePublicFolder: false, и на симлинки dev-сервер
// отвечает 404 (staticFile не находит файл), хотя бандлер их разворачивает
// нормально — расхождение всплывает только в Studio. Так на чистой машине
// приезжают и реестр, и треки одним клоном.

/** Имена файлов из таблицы LICENSES.md (первая колонка). */
export function parseLicenses(markdown) {
  const names = new Set();
  for (const line of markdown.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    const [file, source, license] = cells;
    if (!file || /^-+$/.test(file)) continue; // разделитель таблицы
    if (file === 'Файл') continue; // шапка
    if (!source || !license) continue;
    names.add(file);
  }
  return names;
}

export const licensesPath = (engineDir) => path.join(engineDir, 'assets', 'music', 'LICENSES.md');
export const musicDir = (engineDir) => path.join(engineDir, 'assets', 'music');

/** Бросает Error, если трек нельзя подключать. Возвращает путь к файлу. */
export function assertMusicAllowed(engineDir, fileName) {
  const reg = licensesPath(engineDir);
  if (!fs.existsSync(reg)) {
    throw new Error(`Нет реестра лицензий ${reg} — музыку подключать нельзя.`);
  }
  const allowed = parseLicenses(fs.readFileSync(reg, 'utf8'));
  if (!allowed.has(fileName)) {
    throw new Error(
      `Трек "${fileName}" не подключён: нет строки в assets/music/LICENSES.md. ` +
        `Ролики публикуются коммерчески — сначала внеси файл, источник, лицензию и дату в реестр. ` +
        `Сейчас в реестре: ${[...allowed].join(', ') || '(пусто)'}.`,
    );
  }
  const file = path.join(musicDir(engineDir), fileName);
  if (!fs.existsSync(file)) {
    throw new Error(`Трек "${fileName}" есть в реестре, но файла ${file} нет на диске.`);
  }
  return file;
}

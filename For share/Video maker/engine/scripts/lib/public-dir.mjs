import fs from 'node:fs';
import path from 'node:path';

// Сборка public/ под конкретный ролик (дефект I7).
//
// Было: public/projects — симлинк на ВСЮ папку projects. Remotion затягивал в
// бандл все ролики целиком, включая прошлые mp4 в out/. К десятому ролику это
// сотни мегабайт на каждый запуск.
//
// Стало: public/project содержит только то, что нужно кадру текущего ролика —
// audio/ (wav + timeline.json), assets/ (если есть) и video.json. Папка out/
// в бандл не попадает вообще.
//
// Почему копирование, а не симлинки: проверено на этом проекте — бандлер
// Remotion пересоздаёт симлинки в бандле, но dev-сервер отдаёт по такому пути
// 404 (staticFile('project/video.json') не находится). Копия работает и в
// рендере, и в Studio. Копируются килобайты-мегабайты одного ролика, не гигабайты
// всей папки, поэтому цена приемлема; файлы с тем же размером и временем
// изменения не перезаписываются.
//
// public/ целиком генерируется этим скриптом и в git не хранится.

const ENTRIES = ['audio', 'assets', 'video.json'];

const sameFile = (a, b) => {
  const sa = fs.statSync(a, { throwIfNoEntry: false });
  const sb = fs.statSync(b, { throwIfNoEntry: false });
  return !!sa && !!sb && sa.size === sb.size && Math.abs(sa.mtimeMs - sb.mtimeMs) < 1;
};

// Остатки прежней раскладки (public/music и public/project/* были симлинками)
// снимаем: копировать поверх симлинка — значит копировать папку саму в себя.
const dropSymlink = (p) => {
  const st = fs.lstatSync(p, { throwIfNoEntry: false });
  if (st?.isSymbolicLink()) fs.unlinkSync(p);
};

const copyTree = (src, dest) => {
  dropSymlink(dest);
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    const wanted = new Set(fs.readdirSync(src));
    // всё лишнее из прошлых прогонов убираем, иначе в бандл поедет мусор
    for (const name of fs.readdirSync(dest)) {
      if (!wanted.has(name)) fs.rmSync(path.join(dest, name), { recursive: true, force: true });
    }
    for (const name of wanted) copyTree(path.join(src, name), path.join(dest, name));
    return;
  }
  if (sameFile(src, dest)) return;
  fs.copyFileSync(src, dest);
  fs.utimesSync(dest, st.atime, st.mtime);
};

/**
 * Готовит engine/public под ролик slug. Возвращает путь к public/project.
 * Идемпотентна: можно звать перед каждым рендером и перед стартом Studio.
 */
export function preparePublic(engineDir, slug) {
  const projDir = path.join(engineDir, '..', 'projects', slug);
  if (!fs.existsSync(projDir)) {
    throw new Error(`Нет проекта ${projDir}`);
  }

  const publicDir = path.join(engineDir, 'public');
  fs.mkdirSync(publicDir, { recursive: true });

  // Наследие прежней схемы: симлинк на всю папку projects. Пока он жив, в бандл
  // едут все ролики — снимаем (удаляется только сам симлинк, не содержимое).
  const legacy = path.join(publicDir, 'projects');
  const legacyStat = fs.lstatSync(legacy, { throwIfNoEntry: false });
  if (legacyStat?.isSymbolicLink()) fs.unlinkSync(legacy);

  // Музыка: файлы лежат в assets/music под git (см. assets/music/LICENSES.md),
  // в public попадает их копия.
  copyTree(path.join(engineDir, 'assets', 'music'), path.join(publicDir, 'music'));

  const projectPublic = path.join(publicDir, 'project');
  fs.mkdirSync(projectPublic, { recursive: true });

  for (const entry of ENTRIES) {
    const src = path.join(projDir, entry);
    const dest = path.join(projectPublic, entry);
    if (!fs.existsSync(src)) {
      // assets/ есть не у каждого ролика; хвост от прошлого ролика убираем
      fs.rmSync(dest, { recursive: true, force: true });
      continue;
    }
    copyTree(src, dest);
  }

  return projectPublic;
}

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { analyseVideo, probeDurationSec } from './lib/color-grade.mjs';

// Цветокоррекция ЛЮБОГО видео с выбором из четырёх вариантов.
//
// Зачем отдельный скрипт, если коррекция уже есть в prepare-source.mjs: тот
// заточен под говорящую голову и применяет ровно один вариант — свой. На
// материале другого рода (ребёнок во дворе, пейзаж, интерьер) цель по коже
// бессмысленна, а «правильного» варианта не существует вовсе: контраст,
// теплота и насыщенность — вопрос вкуса, а не замера.
//
// Правило автора от 12.08.2026: **показать четыре варианта и применять только
// после выбора.** До этого я поставил один вариант и пошёл рендерить — он
// остановил на полпути. Скрипт делает выбор обязательным шагом: без --apply он
// физически не трогает видео.
//
// Использование:
//   node scripts/grade.mjs <файл.mp4>              # анализ + 4 варианта картинкой
//   node scripts/grade.mjs <файл.mp4> --at 7       # кадр для сравнения на 7-й секунде
//   node scripts/grade.mjs <файл.mp4> --apply 3    # применить третий вариант
//
// Оригинал никогда не перезаписывается: результат кладётся рядом с суффиксом
// -graded.

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const applyIdx = args.includes('--apply') ? Number(args[args.indexOf('--apply') + 1]) : null;
const atArg = args.includes('--at') ? Number(args[args.indexOf('--at') + 1]) : null;

if (!file || !fs.existsSync(file)) {
  console.error('Использование: node scripts/grade.mjs <файл> [--at секунда] [--apply 1..4]');
  process.exit(1);
}

const durationSec = probeDurationSec(file);
const at = atArg ?? Math.min(durationSec / 2, durationSec - 0.5);

// ── Замер исходника ──────────────────────────────────────────────────────────
function stats(src, seek = null) {
  const a = ['-v', 'error'];
  if (seek !== null) a.push('-ss', String(seek));
  a.push('-i', src, '-frames:v', '1', '-vf', 'signalstats,metadata=print:file=-', '-an', '-f', 'null', '-');
  const out = spawnSync('ffmpeg', a, { encoding: 'utf8' }).stderr + spawnSync('ffmpeg', a, { encoding: 'utf8' }).stdout;
  const grab = (k) => {
    const m = out.match(new RegExp(`${k}=([\\d.]+)`));
    return m ? parseFloat(m[1]) : null;
  };
  return { ymin: grab('YMIN'), yavg: grab('YAVG'), ymax: grab('YMAX'), uavg: grab('UAVG'), vavg: grab('VAVG') };
}

// Кадры бывают 8- и 10-битные; приводим к привычной шкале 0–255, иначе числа в
// отчёте не сравнить между собой.
const scaleTo255 = (v, peak) => (peak > 300 ? v / 4 : v);

const src = stats(file, at);
const peak = src.ymax;
const norm = (v) => Math.round(scaleTo255(v, peak));

console.log(`Файл: ${path.basename(file)} · ${durationSec.toFixed(1)} с · кадр для сравнения на ${at.toFixed(1)} с\n`);
console.log('Замер исходника (шкала 0–255):');
console.log(`  чёрная точка ${norm(src.ymin)} · средняя ${norm(src.yavg)} · белая точка ${norm(src.ymax)}`);
const neutral = peak > 300 ? 512 : 128;
const warm = Math.round(scaleTo255(src.vavg - neutral, peak) - scaleTo255(src.uavg - neutral, peak));
console.log(`  увод по цвету: ${warm > 0 ? '+' : ''}${warm} в тёплую сторону\n`);

// ── Четыре варианта ──────────────────────────────────────────────────────────
//
// Точки кривой считаются от замера конкретного файла, а не зашиты: другой свет
// даст другие числа. Растягиваем реальную чёрную и белую точки к краям
// диапазона, оставляя запас, чтобы не выбить детали в упор.
const lo = scaleTo255(src.ymin, peak) / 255;
const hi = scaleTo255(src.ymax, peak) / 255;
const curve = (blackTo, whiteTo, mid = null) => {
  const pts = [`0/0`, `${lo.toFixed(3)}/${blackTo}`];
  if (mid) pts.push(mid);
  pts.push(`${hi.toFixed(3)}/${whiteTo}`, `1/1`);
  return `curves=all='${pts.join(' ')}'`;
};

const midShadow = `${(lo + (hi - lo) * 0.33).toFixed(3)}/${(lo + (hi - lo) * 0.33 + 0.06).toFixed(3)}`;

const VARIANTS = [
  {
    name: 'Только диапазон',
    note: 'растянуты чёрная и белая точки, цвет не тронут. Самый безопасный.',
    vf: curve('0.03', '0.93'),
  },
  {
    name: 'Диапазон + меньше тепла',
    note: 'то же плюс частично убран тёплый увод, насыщенность +12%.',
    vf: `${curve('0.03', '0.93')},colorbalance=rm=-0.04:bm=0.04,eq=saturation=1.12`,
  },
  {
    name: 'Диапазон + светлее тени',
    note: 'тени подняты — для объекта в тени: лицо под козырьком, комната против окна.',
    vf: `${curve('0.03', '0.93', midShadow)},eq=saturation=1.10`,
  },
  {
    name: 'Мягкий',
    note: 'растяжение слабее, тепло сохранено полностью. Для вечернего света.',
    vf: `${curve('0.05', '0.88')},eq=saturation=1.08`,
  },
];

// ── Применение выбранного ────────────────────────────────────────────────────
if (applyIdx) {
  const v = VARIANTS[applyIdx - 1];
  if (!v) {
    console.error(`ОШИБКА: вариант ${applyIdx} не существует, их четыре.`);
    process.exit(1);
  }
  console.log(`Применяю вариант ${applyIdx} — ${v.name}\n  ${v.vf}\n`);

  // Профиль качества выбирается флагом, а не угадывается.
  //
  // Замер 12.08.2026 на этом же материале (SSIM против эталона без потерь):
  //   HEVC 108 Мбит/с — 0,9892   (первая версия скрипта: тихая потеря)
  //   HEVC 200 Мбит/с — 0,9938
  //   HEVC 300 Мбит/с — 0,9957
  //   ProRes 422 HQ   — 0,9987
  // Перекодирование всегда что-то отнимает: исходник уже сжат. Вопрос лишь в
  // том, сколько мы готовы отдать и сколько весит результат.
  const profile = args.includes('--prores') ? 'prores'
    : args.includes('--compact') ? 'compact' : 'high';

  const enc = {
    prores: ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'],
    high: ['-c:v', 'hevc_videotoolbox', '-b:v', '300M', '-tag:v', 'hvc1', '-pix_fmt', 'p010le'],
    compact: ['-c:v', 'hevc_videotoolbox', '-b:v', '200M', '-tag:v', 'hvc1', '-pix_fmt', 'p010le'],
  }[profile];
  const ext = profile === 'prores' ? 'mov' : 'mp4';
  const quality = {
    prores: 'ProRes 422 HQ — для монтажа, потери на грани измеримого',
    high: 'HEVC 300 Мбит/с — визуально без потерь, файл втрое меньше ProRes',
    compact: 'HEVC 200 Мбит/с — компактный',
  }[profile];

  console.log(`  качество: ${quality}; звук копируется без перекодирования`);

  // Цветовые метаданные переносятся явно: без них плеер угадывает пространство
  // сам, и на другом устройстве картинка уезжает по цвету.
  const colorTags = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
  const out = file.replace(/\.\w+$/, `-graded.${ext}`);

  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file,
    '-vf', `${v.vf},format=${profile === 'prores' ? 'yuv422p10le' : 'p010le'}`, ...enc, ...colorTags,
    '-c:a', 'copy', '-map_metadata', '0', '-movflags', '+faststart', '-y', out], { stdio: 'inherit' });

  const after = stats(out, at);
  const p2 = after.ymax;
  console.log(`Готово: ${out}`);
  console.log(`  было:  чёрная ${norm(src.ymin)} · средняя ${norm(src.yavg)} · белая ${norm(src.ymax)}`);
  console.log(`  стало: чёрная ${Math.round(scaleTo255(after.ymin, p2))} · средняя ${Math.round(scaleTo255(after.yavg, p2))} · белая ${Math.round(scaleTo255(after.ymax, p2))}`);
  process.exit(0);
}

// ── Лист сравнения ───────────────────────────────────────────────────────────
const outDir = path.join(path.dirname(file), 'grade-preview');
fs.mkdirSync(outDir, { recursive: true });
const tiles = [];

// Превью — крупные и по одному файлу на вариант. Узкая полоска из пяти кадров
// в чате не даёт разглядеть, что происходит в тенях, а выбирают именно по
// этому (правило автора 12.08.2026).
// Превью — в ПОЛНОМ разрешении исходника и в PNG.
//
// Две итерации 12.08.2026, обе поймал автор: сначала JPEG качества 2 съедал
// 1,3 % (SSIM 0,987) ровно в тенях, по которым и выбирают; потом кадры
// оставались уменьшенными вдвое (900×1600 против 1728×3072), и мелких деталей
// в них просто не было. Вес полноразмерного PNG — 5–8 МБ, это укладывается в
// лимит отправки, так что экономить не на чем.
//
// PREVIEW_H = 0 означает «не масштабировать».
const PREVIEW_H = Number(args[args.indexOf('--preview-height') + 1]) || 0;
const scaleChain = PREVIEW_H ? `,scale=-2:${PREVIEW_H}:flags=lanczos` : '';
const orig = path.join(outDir, '0-original.png');
execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1',
  '-vf', `format=yuv420p${scaleChain}`, '-y', orig]);
tiles.push(orig);

console.log('Варианты:\n');
VARIANTS.forEach((v, i) => {
  const p = path.join(outDir, `${i + 1}-${v.name.replace(/[^\wа-яё]+/gi, '-').toLowerCase()}.png`);
  // format=yuv420p обязателен: без него фильтры, не меняющие битность (одни
  // curves), отдают 10-битный кадр и PNG пишется 16-битным. Замеры вариантов
  // тогда лежат в разных шкалах и не сравниваются — поймано на первом же
  // прогоне 12.08.2026, где вариант 1 показал «белая точка 58643».
  execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1',
    '-vf', `${v.vf},format=yuv420p${scaleChain}`, '-y', p]);
  tiles.push(p);

  const s = stats(p);
  const clip = spawnSync('ffmpeg', ['-v', 'error', '-i', p, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }).stdout;
  const black = clip ? [...clip].filter((b) => b <= 2).length / clip.length : 0;
  const white = clip ? [...clip].filter((b) => b >= 253).length / clip.length : 0;

  console.log(`  ${i + 1}. ${v.name}`);
  console.log(`     ${v.note}`);
  console.log(`     чёрная ${Math.round(s.ymin)} · средняя ${Math.round(s.yavg)} · белая ${Math.round(s.ymax)}`
    + ` · в упоре: тени ${(black * 100).toFixed(2)}%, света ${(white * 100).toFixed(2)}%`);
});

// Кроп в масштабе 1:1 — по нему видно то, чего не видно в уменьшенном кадре:
// шум в тенях, ступеньки на градиентах, детали в тёмном.
const cropW = 760;
const cropH = 620;
const cropSheet = path.join(outDir, 'compare-crop.png');
const crops = [];
[{ vf: null, tag: '0-orig' }, ...VARIANTS.map((v, i) => ({ vf: v.vf, tag: String(i + 1) }))]
  .forEach(({ vf, tag }) => {
    const c = path.join(outDir, `crop-${tag}.png`);
    const chain = [vf, 'format=yuv420p', `crop=${cropW}:${cropH}:(iw-${cropW})/2:ih*0.28`]
      .filter(Boolean).join(',');
    execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1',
      '-vf', chain, '-y', c]);
    crops.push(c);
  });
execFileSync('ffmpeg', ['-v', 'error', ...crops.flatMap((c) => ['-i', c]),
  '-filter_complex', `[0][1][2][3][4]hstack=inputs=5`, '-y', cropSheet]);

// ── Короткие клипы вариантов в финальном качестве ────────────────────────────
//
// Кадр не показывает того, ради чего и поднимали качество: шум в движении,
// поведение градиентов, артефакты сжатия на панорамах. Выбирать по картинке,
// а рендерить в другом качестве — значит выбирать вслепую (замечание автора
// 12.08.2026). Клипы кодируются ТЕМ ЖЕ профилем, что и финал.
if (args.includes('--clips')) {
  const clipSec = Number(args[args.indexOf('--clips') + 1]) || 3;
  const clipCrop = args.includes('--clip-full') ? null : 'crop=1080:1080:(iw-1080)/2:ih*0.22';
  const from = Math.max(0, at - clipSec / 2);
  // Битрейт масштабируется по площади кадра. При жёстких 300 Мбит/с фрагмент
  // 1080×1080 весил бы столько же, сколько полный кадр 1728×3072, — то есть
  // втрое больше нужного, при том же качестве на пиксель.
  const srcDims = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' })
    .stdout.trim().split(',').map(Number);
  const srcPixels = (srcDims[0] || 1080) * (srcDims[1] || 1920);
  const clipPixels = clipCrop ? 1080 * 1080 : srcPixels;
  const clipMbit = Math.max(20, Math.round(300 * (clipPixels / srcPixels)));

  const clipProfile = args.includes('--prores')
    ? ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le']
    : ['-c:v', 'hevc_videotoolbox', '-b:v', `${clipMbit}M`, '-tag:v', 'hvc1', '-pix_fmt', 'p010le'];
  const clipExt = args.includes('--prores') ? 'mov' : 'mp4';

  // Кадр целиком в финальном качестве весит больше сотни мегабайт на три
  // секунды и не отправляется никуда. Поэтому клип — это ФРАГМЕНТ кадра в
  // масштабе 1:1: настоящие пиксели и настоящий битрейт, просто меньшая
  // площадь. Уменьшать разрешение или битрейт нельзя — тогда смотреть будет
  // не на что.
  console.log(`\nКлипы вариантов по ${clipSec} с в финальном качестве${clipCrop ? ' (фрагмент кадра 1:1)' : ''}:`);
  VARIANTS.forEach((v, i) => {
    const c = path.join(outDir, `clip-${i + 1}.${clipExt}`);
    const chain = [v.vf, clipCrop, `format=${args.includes('--prores') ? 'yuv422p10le' : 'p010le'}`]
      .filter(Boolean).join(',');
    execFileSync('ffmpeg', ['-v', 'error', '-ss', String(from), '-t', String(clipSec), '-i', file,
      '-vf', chain, ...clipProfile, '-an', '-y', c]);
    const mb = (fs.statSync(c).size / 1048576).toFixed(0);
    console.log(`  ${i + 1}. ${v.name} — ${mb} МБ · ${c}`);
  });
}

const sheet = path.join(outDir, 'compare.png');
execFileSync('ffmpeg', ['-v', 'error',
  ...tiles.flatMap((t) => ['-i', t]),
  '-filter_complex', `[0][1][2][3][4]hstack=inputs=5`, '-y', sheet]);

console.log(`\nЛист сравнения: ${sheet}`);
console.log(`Кроп 1:1 (шум и детали в тенях): ${cropSheet}`);
console.log(`Отдельные кадры: ${outDir}`);
console.log('Порядок слева направо: оригинал, 1, 2, 3, 4.');
console.log(`\nВыбрал — применяй: node scripts/grade.mjs "${file}" --apply <номер>`);
console.log('Без --apply видео не трогается.');
console.log('Качество: по умолчанию HEVC 300 Мбит/с. --prores — максимум для монтажа, --compact — 200 Мбит/с.');

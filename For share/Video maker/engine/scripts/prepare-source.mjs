import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseVideoJson } from '../src/lib/video-schema.mjs';
import { buildStoryTimeline } from './lib/story-timeline.mjs';
import { buildContactSheet, evenMoments } from './lib/contact-sheet.mjs';
import { denoiseVideoAudio } from './lib/denoise.mjs';
import { analyseVideo, buildGradeFilter, probeDurationSec } from './lib/color-grade.mjs';
import { fileURLToPath } from 'node:url';

// Подготовка снятого видео под шаблон story@1.
//
// Заменяет tts.mjs для роликов, где речь не синтезируется, а снята. Делает три
// вещи, и все три — один раз, а не при каждом рендере:
//   1. Прокси. Исходник с айфона (1728×3072, 60 fps, ~345 МБ на 38 секундах)
//      кладётся в бандл Remotion целиком и декодируется на каждом кадре. Прокси
//      1080×1920@30 весит десятки мегабайт и совпадает с канвой композиции —
//      масштабирование уходит из горячего пути.
//   2. Транскрипт с метками слов (mlx_whisper). Кэшируется: правка раскадровки
//      не должна гонять распознавание заново, это минуты.
//   3. audio/timeline.json того же формата, что отдаёт tts.mjs, — дальше по
//      конвейеру (preparePublic, render.mjs, Subtitles) ничего менять не нужно.
//
// Использование:
//   node scripts/prepare-source.mjs <slug> [путь-к-исходнику] [--force] [--denoise] [--grade]
//
// Путь к исходнику нужен на первом прогоне. Дальше прокси и транскрипт лежат в
// папке ролика и переиспользуются; --force пересобирает их с нуля.

const args = process.argv.slice(2);
const force = args.includes('--force');
// Чистка голоса по умолчанию ВЫКЛЮЧЕНА. Она необратима, требует тяжёлой
// зависимости и на записи с приличным отношением сигнал/шум даёт разницу
// только в паузах между словами — навязывать её каждому ролику нечестно.
const denoise = args.includes('--denoise');
// Цветокоррекция тоже по флагу: она меняет картинку необратимо, и на съёмке с
// нормальной экспозицией не нужна вовсе.
const grade = args.includes('--grade');
const [slug, sourceArg] = args.filter((a) => !a.startsWith('--'));

if (!slug) {
  console.error('Использование: node scripts/prepare-source.mjs <slug> [путь-к-исходнику] [--force] [--denoise]');
  process.exit(1);
}

function checkOnPath(cmd, hint) {
  if (spawnSync('which', [cmd], { encoding: 'utf8' }).status !== 0) {
    console.error(`ОШИБКА: команда "${cmd}" не найдена в PATH. ${hint}`);
    process.exit(1);
  }
}

const engine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proj = path.join(engine, '..', 'projects', slug);

if (!fs.existsSync(proj)) {
  console.error(`ОШИБКА: нет папки ролика ${proj}`);
  process.exit(1);
}

let video;
try {
  video = parseVideoJson(JSON.parse(fs.readFileSync(path.join(proj, 'video.json'), 'utf8')), {
    file: `projects/${slug}/video.json`,
  });
} catch (err) {
  console.error(`ОШИБКА: ${err.message}`);
  process.exit(1);
}

if (video.template !== 'story@1') {
  console.error(
    `ОШИБКА: ролик ${slug} собран по шаблону ${video.template}. Этот скрипт готовит только story@1 — ` +
      `для синтезируемых роликов звук делает scripts/tts.mjs.`,
  );
  process.exit(1);
}

const proxyRel = video.story.source;
const proxyAbs = path.join(proj, proxyRel);
const audioDir = path.join(proj, 'audio');
const wordsFile = path.join(audioDir, 'words.json');
fs.mkdirSync(audioDir, { recursive: true });
fs.mkdirSync(path.dirname(proxyAbs), { recursive: true });

const FPS = 30;

// ── 1. Прокси ────────────────────────────────────────────────────────────────

if (force || !fs.existsSync(proxyAbs)) {
  if (!sourceArg) {
    // Два разных случая, и путать их нельзя: прокси может отсутствовать, а
    // может существовать, но подлежать пересборке по --force. В обоих нужен
    // исходник, но сообщение «нет файла» про существующий файл сбивает с толку.
    const reason = fs.existsSync(proxyAbs)
      ? `--force пересобирает ${proxyRel} с нуля, для этого нужен исходник`
      : `нет ${proxyRel}, а путь к исходнику не передан`;
    console.error(
      `ОШИБКА: ${reason}.\n` +
        `  node scripts/prepare-source.mjs ${slug} <путь-к-исходному-видео>${force ? ' --force' : ''}`,
    );
    process.exit(1);
  }
  const src = path.resolve(sourceArg);
  if (!fs.existsSync(src)) {
    console.error(`ОШИБКА: исходник не найден: ${src}`);
    process.exit(1);
  }
  checkOnPath('ffmpeg', 'Установи ffmpeg, например: brew install ffmpeg.');

  // CRF 14, а не 20. Прокси — это потолок качества для всего, что будет
  // дальше: рендер Remotion кладёт графику ПОВЕРХ него, и вернуть потерянное
  // уже нельзя. Замер 12.08.2026 на съёмке DJI (даунскейл 1728×3072 → 1080×1920):
  //   crf 20 — 6,5 Мбит/с, SSIM 0,9837   (было)
  //   crf 14 — 16,2 Мбит/с, SSIM 0,9892  (стало)
  // Прокси живёт в папке проекта и удаляется вместе с ним, поэтому лишние
  // мегабайты здесь дешевле потерянных деталей.
  console.log(`Готовлю прокси 1080×1920@${FPS} из ${path.basename(src)} …`);
  // scale + crop, а не растяжение: исходник уже 9:16, но если когда-нибудь
  // придёт кадр другой пропорции, обрезка по центру честнее искажения лиц.
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
      '-vf', `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=${FPS}`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart',
      proxyAbs,
    ],
    { stdio: 'inherit' },
  );
  const mb = (fs.statSync(proxyAbs).size / 1024 / 1024).toFixed(1);
  console.log(`  прокси готов: ${proxyRel} (${mb} МБ)`);
} else {
  console.log(`Прокси уже есть: ${proxyRel} (пересобрать — флаг --force)`);
}

// ── 1a. Цветокоррекция (по флагу) ────────────────────────────────────────────
//
// Замер mvp-palatka 11.08.2026: света кадра доходили до 113 из 255, средняя
// яркость 55 при норме около 110 — больше половины диапазона пустовало, и
// картинка читалась вялой. Тёплый увод (R−B = +18) на этом фоне второстепенен.
//
// Коэффициенты считаются по кадрам ЭТОЙ съёмки, а не берутся готовыми: баланс
// белого зависит от света в комнате, и зашитые числа на другой съёмке испортили
// бы кадр. Нейтраль ищется автоматически — объект с наименьшим разбросом
// каналов при средней яркости (у автора это металлическая дверь слева).

const gradeMarker = path.join(audioDir, 'grade.json');
const rawProxy = proxyAbs.replace(/\.mp4$/, '.raw.mp4');

if (grade) {
  // Маркер годен, только пока он новее прокси. Прокси пересобран — коррекции в
  // нём нет, сколько бы маркеров ни лежало рядом. Поймано 12.08.2026: после
  // пересборки прокси ролик вышел с яркостью 69 вместо 98, потому что шаг
  // отрапортовал «уже скорректировано» и ничего не сделал.
  //
  // Тот же класс, что урок L008: производный артефакт рассинхронизирован с
  // источником, а признак этого — время изменения, а не факт существования.
  const markerFresh = fs.existsSync(gradeMarker)
    && fs.statSync(gradeMarker).mtimeMs >= fs.statSync(proxyAbs).mtimeMs;

  if (markerFresh && !force) {
    console.log('Кадр уже скорректирован (audio/grade.json) — повторно не трогаю: две коррекции подряд пересветят.');
  } else {
    console.log('Считаю цветокоррекцию по кадрам ролика …');
    const durationSec = probeDurationSec(proxyAbs);
    const analysis = analyseVideo(proxyAbs, { durationSec });
    if (!analysis) {
      console.error('ОШИБКА: не нашёл в кадре нейтральный объект — не по чему считать баланс белого.');
      console.error('Собрать ролик без коррекции можно тем же вызовом без --grade.');
      process.exit(1);
    }
    const filter = buildGradeFilter(analysis);
    if (!filter) {
      console.log('  кадр уже в норме — коррекция не нужна');
    } else {
      // Оригинал прокси сохраняется рядом: коррекция необратима, а откат должен
      // стоить одну команду, а не пересборку из исходника.
      if (!fs.existsSync(rawProxy)) fs.copyFileSync(proxyAbs, rawProxy);
      const tmp = proxyAbs.replace(/\.mp4$/, '.grade.tmp.mp4');
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', rawProxy,
        '-vf', filter, '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy', '-movflags', '+faststart', tmp], { stdio: 'inherit' });
      fs.renameSync(tmp, proxyAbs);
      fs.writeFileSync(gradeMarker, `${JSON.stringify({ filter, gains: analysis.gains, meanLum: Math.round(analysis.meanLum), meanHigh: Math.round(analysis.meanHigh), probes: analysis.probes }, null, 2)}\n`);
      console.log(`  применено: ${filter}`);
      console.log(`  было: яркость ${analysis.meanLum.toFixed(0)}, света ${analysis.meanHigh.toFixed(0)} из 255`);
    }
  }
}

// ── 1a. Чистка голоса (по флагу) ─────────────────────────────────────────────
//
// Идёт ДО транскрипта намеренно: метки слов должны сниматься с той дорожки,
// которая реально поедет в ролик, иначе субтитры окажутся синхронизированы с
// несуществующим звуком.
//
// Маркер нужен, чтобы повторный запуск не почистил уже чистое: двойной проход
// денойзера начинает есть речь, и на слух это «подводный» голос.

const denoiseMarker = path.join(audioDir, 'denoise.json');

if (denoise) {
  if (fs.existsSync(denoiseMarker) && !force) {
    console.log('Голос уже почищен (audio/denoise.json) — повторно не чищу, иначе речь начнёт «плыть».');
  } else {
    console.log('Чищу голос (DeepFilterNet3) …');
    const res = denoiseVideoAudio(proxyAbs, { workDir: audioDir });
    if (res.applied) {
      const worst = res.report?.worstDropDb ?? 0;
      fs.writeFileSync(denoiseMarker, `${JSON.stringify({ tool: 'DeepFilterNet3', worstDropDb: worst, bands: res.report?.bands ?? [] }, null, 2)}\n`);
      console.log(`  готово: верх голоса просел на ${Math.abs(worst).toFixed(1)} дБ (допуск 1 дБ)`);
      // Дорожка изменилась — прежний транскрипт снят с несуществующего звука.
      // Метки почти совпадут, но «почти» здесь означает субтитры, рассинхрон
      // которых заметит только зритель. Кэш сбрасываем, распознавание пойдёт
      // заново по той дорожке, что реально поедет в ролик.
      if (fs.existsSync(wordsFile)) {
        fs.rmSync(wordsFile);
        console.log('  транскрипт сброшен — будет снят заново с почищенной дорожки');
      }
    } else {
      console.error(`ОШИБКА: чистка не применена — ${res.reason}`);
      console.error('Прокси не тронут. Собрать ролик без чистки можно тем же вызовом без --denoise.');
      process.exit(1);
    }
  }
} else if (fs.existsSync(denoiseMarker)) {
  console.log('Примечание: дорожка этого ролика была почищена ранее (audio/denoise.json).');
}

// ── 2. Транскрипт ────────────────────────────────────────────────────────────

if (force || !fs.existsSync(wordsFile)) {
  checkOnPath('ffmpeg', 'Установи ffmpeg, например: brew install ffmpeg.');

  // Распознавание — единственное место во всём конвейере, завязанное на железо.
  // mlx_whisper быстрый, но работает только на Apple Silicon; openai-whisper
  // идёт везде, включая Windows и Linux, просто медленнее на процессоре.
  // Формат вывода у них одинаковый (segments[].words[] со start/end/word),
  // поэтому остальной конвейер про эту разницу не знает.
  const engines = [
    {
      bin: 'mlx_whisper',
      args: (wav) => [wav, '--language', 'ru',
        '--model', 'mlx-community/whisper-large-v3-turbo',
        '--word-timestamps', 'True', '--output-format', 'json',
        '--output-name', 'words', '--output-dir', audioDir],
    },
    {
      bin: 'whisper',
      args: (wav) => [wav, '--language', 'ru',
        '--model', 'large-v3-turbo',
        '--word_timestamps', 'True', '--output_format', 'json',
        '--output_dir', audioDir],
    },
  ];
  const engine = engines.find((e) => spawnSync('which', [e.bin]).status === 0);
  if (!engine) {
    console.error('ОШИБКА: не найден распознаватель речи. Поставь один из двух:');
    console.error('  pip install mlx-whisper     — быстрый, только Apple Silicon');
    console.error('  pip install openai-whisper  — медленнее, работает везде');
    process.exit(1);
  }

  // Имя файла берётся из имени входа: openai-whisper не умеет --output-name,
  // зато оба кладут <имя входа>.json в каталог вывода.
  const wav = path.join(audioDir, 'words.wav');
  console.log(`Извлекаю дорожку и распознаю речь (${engine.bin}, это минуты) …`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', proxyAbs,
    '-vn', '-ac', '1', '-ar', '16000', wav], { stdio: 'inherit' });

  execFileSync(engine.bin, engine.args(wav), { stdio: 'inherit' });

  fs.unlinkSync(wav);
  console.log('  транскрипт готов: audio/words.json');
} else {
  console.log('Транскрипт уже есть: audio/words.json (пересобрать — флаг --force)');
}

// ── 3. Таймлайн ──────────────────────────────────────────────────────────────

checkOnPath('ffprobe', 'Установи ffmpeg (ffprobe идёт в комплекте), например: brew install ffmpeg.');

// Длительность берётся из САМОГО файла, а не из меток транскрипта. Урок
// 06.08.2026 (Decisions/2026-08-06-video-maker-dizajn.md): метки — это отчёт о
// звуке, а не звук; конвейер, который сверяется только с ними, не замечает, что
// на дорожке вообще не то.
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=noprint_wrappers=1:nokey=1', proxyAbs], { encoding: 'utf8' });
const sourceMs = Math.round(parseFloat(probe.stdout.trim()) * 1000);
if (!Number.isFinite(sourceMs) || sourceMs <= 0) {
  console.error(`ОШИБКА: не удалось измерить длительность ${proxyRel}. Вывод ffprobe: ${probe.stderr || probe.stdout}`);
  process.exit(1);
}

const whisper = JSON.parse(fs.readFileSync(wordsFile, 'utf8'));

let timeline;
try {
  timeline = buildStoryTimeline({
    slug,
    fps: FPS,
    sourceMs,
    scenes: video.story.scenes,
    whisper,
  });
} catch (err) {
  console.error(`ОШИБКА: ${err.message}`);
  process.exit(1);
}

fs.writeFileSync(path.join(audioDir, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);

const spokenWords = timeline.scenes.reduce((n, s) => n + s.captions.length, 0);
console.log(
  `ГОТОВО: audio/timeline.json — ${timeline.scenes.length} сцен, ${timeline.totalFrames} кадров ` +
    `(${(timeline.totalFrames / FPS).toFixed(2)} с), ${spokenWords} слов в субтитрах.`,
);

// ── 4. Замер кадра ДО вёрстки ────────────────────────────────────────────────
//
// Разбор 11.08.2026: раскладка ролика проектировалась по одному кадру первой
// секунды. На нём верхняя полоса выглядела свободной, туда встали тезисы — и
// оказались на лбу говорящего, как только он наклонился к камере. Три
// переделки подряд, каждая по жалобе, потому что смотрели на кадр, а не на
// ролик.
//
// Лист собирается ВСЕГДА и печатается до того, как написана первая сцена: это
// единственный шаг, где решение о раскладке ещё ничего не стоит.
const sheet = path.join(proj, 'out', `${slug}-source.jpg`);
fs.mkdirSync(path.dirname(sheet), { recursive: true });
try {
  const legend = buildContactSheet({
    src: proxyAbs,
    atSeconds: evenMoments(sourceMs / 1000, 6),
    out: sheet,
  });
  console.log(`\nЗАМЕР КАДРА (посмотри до того, как размечать сцены): ${path.relative(proj, sheet)}`);
  for (const line of legend) console.log(`  · ${line}`);
  console.log('  · если лицо заходит НИЖЕ жёлтой линии хотя бы на одном кадре — панель его перекроет');
  console.log('  · если голова касается верхней красной полосы — ставить тезисы сверху нельзя');
} catch (err) {
  console.warn(`ПРЕДУПРЕЖДЕНИЕ: не собрался контактный лист исходника (${err.message.split('\n')[0]})`);
}

console.log(`\nДальше: node scripts/render.mjs ${slug}`);

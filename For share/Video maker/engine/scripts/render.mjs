import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseVideoJson, COMPOSITION_BY_TEMPLATE } from '../src/lib/video-schema.mjs';
import { findStaleTimeline } from '../src/lib/story-checks.mjs';
import { assertMusicAllowed } from './lib/music.mjs';
import { preparePublic } from './lib/public-dir.mjs';
import { fileURLToPath } from 'node:url';

const slug = process.argv[2];
if (!slug) { console.error('Использование: node scripts/render.mjs <slug>'); process.exit(1); }

// Проверка PATH перед началом работы: без npx/ffmpeg скрипт иначе падает голым
// ENOENT со стектрейсом, непонятным продакту.
function checkOnPath(cmd, hint) {
  const res = spawnSync('which', [cmd], { encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(`ОШИБКА: команда "${cmd}" не найдена в PATH. ${hint}`);
    process.exit(1);
  }
}
checkOnPath('npx', 'Нужен Node.js/npm (в составе Node.js) — установи Node.js.');
checkOnPath('ffmpeg', 'Установи ffmpeg, например: brew install ffmpeg.');

const engine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proj = path.join(engine, '..', 'projects', slug);
const outDir = path.join(proj, 'out');
fs.mkdirSync(outDir, { recursive: true });

// Настройки ролика берутся из его video.json, а не из defaultProps композиции
// (дефект I4): раньше bg/accent/music/musicVolume были одинаковы для всех
// роликов, и ролик не мог иметь своих цветов и своей музыки.
let video;
try {
  video = parseVideoJson(JSON.parse(fs.readFileSync(path.join(proj, 'video.json'), 'utf8')), {
    file: `projects/${slug}/video.json`,
  });
} catch (err) {
  console.error(`ОШИБКА: ${err.message}`);
  process.exit(1);
}

// Какую композицию рендерить, решает поле template ролика, а не строка в коде.
// Раньше здесь стояло 'Kinetic' намертво: ролик scheme@1 отрисовался бы
// кинетическим текстом вместо схемы и никто бы не узнал, почему. Отказ до
// рендера дешевле сорока секунд рендера не того.
const composition = COMPOSITION_BY_TEMPLATE[video.template];
if (composition === undefined) {
  console.error(`ОШИБКА: шаблон ${video.template} не описан в COMPOSITION_BY_TEMPLATE.`);
  process.exit(1);
}
if (composition === null) {
  console.error(
    `ОШИБКА: шаблон ${video.template} рисует не Remotion, а движок canvas — ` +
      `этот скрипт его не собирает. Смотри Content/AI-Video/canvas.`,
  );
  process.exit(1);
}

// Трек без строки в assets/music/LICENSES.md не подключается — проверка в коде,
// а не только в тексте скилла (дефект I6). Падаем до рендера, а не после.
if (video.music) {
  try { assertMusicAllowed(engine, video.music); }
  catch (err) { console.error(`ОШИБКА: ${err.message}`); process.exit(1); }
}

// Таймлайн собирает разный скрипт в зависимости от того, откуда взялась речь:
// синтезированную делает tts.mjs, снятую — prepare-source.mjs. Совет «запусти
// tts» на story@1 отправил бы в ElevenLabs ролик, которому синтез не нужен.
const timelineFile = path.join(proj, 'audio', 'timeline.json');
const maker = video.template === 'story@1' ? 'prepare-source.mjs' : 'tts.mjs';
if (!fs.existsSync(timelineFile)) {
  console.error(`ОШИБКА: нет projects/${slug}/audio/timeline.json — сначала node scripts/${maker} ${slug}`);
  process.exit(1);
}

// Раскадровка правится в video.json, а рендер читает тайминги сцен из
// timeline.json. Без этой проверки правка монтажа молча не доезжает: рендер
// проходит, приёмка проходит, кадры остаются прежними.
const stale = findStaleTimeline({
  videoMtimeMs: fs.statSync(path.join(proj, 'video.json')).mtimeMs,
  timelineMtimeMs: fs.statSync(timelineFile).mtimeMs,
  maker,
});
if (stale) {
  console.error(`ОШИБКА: ${stale.replace('<slug>', slug)}`);
  process.exit(1);
}

// Прокси-видео обязано лежать на месте: без него Remotion отрисует пустой фон и
// молча отдаст ролик без картинки.
if (video.template === 'story@1' && !fs.existsSync(path.join(proj, video.story.source))) {
  console.error(
    `ОШИБКА: нет projects/${slug}/${video.story.source} — сначала node scripts/prepare-source.mjs ${slug} <путь-к-исходнику>`,
  );
  process.exit(1);
}

// В бандл кладём только текущий ролик, а не всю папку projects (дефект I7).
preparePublic(engine, slug);

// Набор пропсов задаёт схема композиции, а не общий список: у story@1 нет ни
// музыки, ни настраиваемого акцента, и лишние ключи не прошли бы валидацию.
const props =
  video.template === 'story@1'
    ? { slug, bg: video.bg }
    : {
        slug,
        bg: video.bg,
        accent: video.accent,
        music: video.music,
        musicVolume: video.musicVolume,
      };

const rawFile = path.join(outDir, `${slug}.raw.mp4`);
const finalFile = path.join(outDir, `${slug}.mp4`);
// Нормализация пишется во временный файл рядом с финальным, а не прямо в него:
// на обрыве/нехватке диска на диске должен остаться либо старый валидный
// финальный файл, либо новый целый — никогда не битый файл под правильным именем.
const tmpFile = path.join(outDir, `${slug}.norm.tmp.mp4`);

// CRF задаётся явно. По умолчанию Remotion берёт 18 для h264 — приемлемо для
// превью, но это вторая ступень сжатия после прокси, и потери складываются.
// Правило автора от 12.08.2026: качество готового ролика не ниже исходника.
const CRF = process.argv.includes('--compact') ? '18' : '14';

execFileSync('npx', ['remotion', 'render', composition, rawFile,
  '--crf', CRF,
  '--props', JSON.stringify(props)], { cwd: engine, stdio: 'inherit' });

// Нормализация в два прохода, а не в один.
//
// Однопроходный loudnorm работает вслепую: он не знает громкости файла заранее
// и правит её на ходу, поэтому промахивается мимо цели тем сильнее, чем
// неровнее дорожка. На разговорном ролике с паузами промах доходил до 2.4 LU
// (замер mvp-palatka: -16.4 LUFS при цели -14) — и ловился уже postfactum,
// предупреждением после рендера.
//
// Первый проход только измеряет и ничего не пишет, второй получает замеры
// через measured_* и считает точное смещение.
const LOUDNORM = 'I=-14:TP=-1.5:LRA=11';

const measurePass = spawnSync('ffmpeg', ['-hide_banner','-i', rawFile,
  '-af', `loudnorm=${LOUDNORM}:print_format=json`, '-f','null','-'], { encoding: 'utf8' });

// ffmpeg печатает json замеров в stderr последним блоком в фигурных скобках.
const measuredJson = (() => {
  const err = measurePass.stderr || '';
  const start = err.lastIndexOf('{');
  const end = err.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(err.slice(start, end + 1)); } catch { return null; }
})();

// Замеры не прочитались — не тихий откат к однопроходу, а явное предупреждение:
// иначе разница в громкости между роликами выглядела бы случайной.
if (!measuredJson) {
  console.warn('ПРЕДУПРЕЖДЕНИЕ: не удалось измерить громкость до нормализации — нормализую в один проход, точность ниже.');
}

// Громкость поднимается ПОСТОЯННЫМ коэффициентом, а не фильтром loudnorm.
//
// Замер 11.08.2026: loudnorm вносит разрывы волны — 32 в один проход и 130 в
// готовом файле, при нуле в исходнике. Виноват его встроенный ограничитель
// пиков: он срабатывает мгновенно и рвёт форму волны на каждом пике речи.
// Флаг linear=true не помогает, разрывы остаются те же 32. Слышно это как
// щелчки, и услышал их автор, а не приёмка.
//
// Постоянный коэффициент физически не может внести разрыв: он умножает всю
// дорожку на одно число. Цена — громкость упирается в пики и не всегда
// дотягивает до −14 LUFS. Это честный размен: тихий ролик слушать можно,
// трещащий — нет.
const TARGET_I = -14;
const TARGET_TP = -1.5;

const gainDb = measuredJson
  ? Math.min(
      TARGET_I - parseFloat(measuredJson.input_i),
      // Потолок по истинному пику: выше поднимать нельзя, срежется.
      TARGET_TP - parseFloat(measuredJson.input_tp),
    )
  : 0;

const loudnormFilter = `volume=${gainDb.toFixed(2)}dB`;
if (measuredJson) {
  console.log(`Громкость: ${measuredJson.input_i} LUFS → ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(2)} dB `
    + `(упор ${TARGET_I - parseFloat(measuredJson.input_i) < TARGET_TP - parseFloat(measuredJson.input_tp) ? 'по громкости' : 'в пики'})`);
}

try {
  // Частота дискретизации приводится к 48 кГц явно.
  //
  // Исходник с айфона приходит в 96 кГц, и без этой строки она доезжала до
  // готового файла (замер mvp-palatka 11.08.2026: sample_rate=96000). Для видео
  // в вебе это нестандарт: часть плееров и загрузчиков соцсетей либо
  // перекодируют дорожку сами, либо спотыкаются на ней. Лишние 48 кГц не дают
  // ничего — речь укладывается в 48 кГц с запасом.
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-i', rawFile,
    '-af', loudnormFilter,'-c:v','copy','-c:a','aac','-b:a','256k',
    '-ar','48000','-ac','2',
    '-movflags','+faststart','-y', tmpFile], { stdio: 'inherit' });
} catch (err) {
  // Неуспех нормализации: временный файл удаляем, финальный (если был) не трогаем.
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  console.error('ОШИБКА: ffmpeg не смог нормализовать громкость. Прежний финальный файл (если был) не тронут.');
  throw err;
}

// Переименование в пределах одной файловой системы атомарно: после этой строки
// либо остался прежний финальный файл (если что-то упало выше), либо появился новый целый.
fs.renameSync(tmpFile, finalFile);

fs.unlinkSync(rawFile);

// ffmpeg пишет статистику loudnorm в stderr, а не в stdout — читаем именно stderr.
// spawnSync (не execFileSync) взят намеренно: он отдаёт stderr в результате
// независимо от кода возврата, ничего не нужно ловить через try/catch.
const measured = spawnSync('ffmpeg', ['-hide_banner','-i', finalFile,
  '-af','loudnorm=print_format=summary','-f','null','-'], { encoding: 'utf8' });
const summary = measured.stderr || '';

console.log('ГОТОВО:', finalFile);

const integratedMatch = summary.match(/Input Integrated:\s*(-?[\d.]+)\s*LUFS/);
const truePeakMatch = summary.match(/Input True Peak:\s*(-?[\d.]+)\s*dBTP/);

if (!integratedMatch || !truePeakMatch) {
  console.warn('ПРЕДУПРЕЖДЕНИЕ: не удалось измерить громкость готового файла (не нашёл строки loudnorm в выводе ffmpeg).');
} else {
  const integrated = parseFloat(integratedMatch[1]);
  const truePeak = parseFloat(truePeakMatch[1]);
  console.log(`Громкость готового файла: Integrated ${integrated} LUFS, True Peak ${truePeak} dBTP`);

  const target = -14;
  const deviation = Math.abs(integrated - target);
  if (deviation > 1) {
    // Недобор громкости при пиках у самого потолка — это не сбой, а физика:
    // у речи пики намного выше средней громкости, и поднять среднее, не
    // превысив предел true peak, нечем. Различать эти два случая важно, иначе
    // нормальный разговорный ролик каждый раз выглядит как поломка (замер
    // mvp-palatka 11.08.2026: -15.3 LUFS при true peak -1.2 dBTP).
    const cappedByPeak = integrated < target && truePeak > -2;
    if (cappedByPeak) {
      console.log(
        `Громкость ниже цели на ${deviation.toFixed(1)} LU, потому что пики уже у предела ` +
          `(${truePeak} dBTP). Поднять среднее можно только срезав пики лимитером, то есть изменив звук речи. ` +
          `Соцсети нормализуют громкость сами — на слух разница незаметна.`,
      );
    } else {
      console.warn(
        `ПРЕДУПРЕЖДЕНИЕ: интегральная громкость отличается от цели ${target} LUFS на ${deviation.toFixed(1)} LU ` +
          `(измерено ${integrated} LUFS). Файл сохранён, но нормализация могла отработать некорректно.`,
      );
    }
  }
}

// Приёмка запускается автоматически, а не по памяти исполнителя.
//
// Разбор 11.08.2026: ролик был объявлен принятым после просмотра кадров, при
// том что субтитры отставали от речи на всех стыках сцен. Приёмка, которую надо
// не забыть запустить, не запускается — поэтому она часть рендера. Ненулевой код
// возврата означает «файл собран, но принимать его нельзя»: файл остаётся на
// диске, решение за человеком.
const check = spawnSync('node', [path.join(engine, 'scripts', 'check.mjs'), slug], {
  cwd: engine,
  stdio: 'inherit',
});
if (check.status !== 0) {
  console.error('\nРолик собран, но машинная приёмка не пройдена — смотри список выше.');
  process.exit(check.status ?? 1);
}

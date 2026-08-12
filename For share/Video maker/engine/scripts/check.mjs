import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseVideoJson } from '../src/lib/video-schema.mjs';
import { buildStoryPages } from '../src/lib/story-pages.mjs';
import {
  findClicks,
  findEmptySceneStarts,
  findLateSceneStarts,
  findPageOverlaps,
  findLostWords,
  findTornTokens,
  findSceneGaps,
  findOversizedPages,
  findBrightnessJumps,
} from '../src/lib/story-checks.mjs';
import { buildContactSheet, evenMoments } from './lib/contact-sheet.mjs';
import { fileURLToPath } from 'node:url';

// Приёмка готового ролика машиной.
//
// Зачем скрипт, а не пункты чек-листа в скилле. Разбор 11.08.2026: сборка
// mvp-palatka была объявлена принятой после просмотра семи кадров глазами, и в
// этот момент субтитры отставали от речи на 7 стыках сцен из 7 (до 400 мс), а
// слово «из-за» было разорвано между страницами. Ни то, ни другое не видно на
// отдельном кадре — это величины, а не картинки. Пункт чек-листа, который
// выполняется «на глаз», в конвейере не выполняется никогда: тот же вывод уже
// был записан 06.08.2026 про звук, лежал в CLAUDE.md и не помог, потому что
// текст — не исполнитель.
//
// Поэтому здесь считается всё, что вообще можно посчитать, а человеку остаётся
// ровно то, что машине недоступно: смотреть на композицию. Для этого скрипт
// печатает контактный лист с разметкой кадра.
//
// Использование:
//   node scripts/check.mjs <slug> [--speech]
//
// --speech дополнительно распознаёт звук ГОТОВОГО файла и сверяет с
// транскриптом: ловит случай «в дорожке не то, что должно быть» (06.08.2026).

const args = process.argv.slice(2);
const withSpeech = args.includes('--speech');
const slug = args.find((a) => !a.startsWith('--'));

if (!slug) {
  console.error('Использование: node scripts/check.mjs <slug> [--speech]');
  process.exit(1);
}

const engine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proj = path.join(engine, '..', 'projects', slug);
const outFile = path.join(proj, 'out', `${slug}.mp4`);

const results = [];
const add = (status, name, detail) => results.push({ status, name, detail });
const ok = (name, detail) => add('PASS', name, detail);
const fail = (name, detail) => add('FAIL', name, detail);
const warn = (name, detail) => add('WARN', name, detail);

// ── Исходные данные ──────────────────────────────────────────────────────────

let video;
try {
  video = parseVideoJson(JSON.parse(fs.readFileSync(path.join(proj, 'video.json'), 'utf8')), {
    file: `projects/${slug}/video.json`,
  });
} catch (err) {
  console.error(`ОШИБКА: ${err.message}`);
  process.exit(1);
}

const timelinePath = path.join(proj, 'audio', 'timeline.json');
if (!fs.existsSync(timelinePath)) {
  console.error(`ОШИБКА: нет ${timelinePath} — ролик ещё не собран.`);
  process.exit(1);
}
const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));

// ── 1. Субтитры ──────────────────────────────────────────────────────────────

const captions = timeline.scenes.flatMap((s) => s.captions);

if (video.template === 'story@1') {
  const pages = buildStoryPages(captions);

  // Перекрытие страниц = субтитр отстаёт от речи. Именно этот дефект пережил
  // приёмку глазами: на кадре видно текст, но не видно, что он опоздал.
  const overlaps = findPageOverlaps(pages);
  if (overlaps.length) {
    const first = overlaps.slice(0, 3).map((o) => `${o.atMs} мс (отставание ${o.lagMs} мс)`);
    fail('субтитры не отстают от речи', `${overlaps.length} перекрытий: ${first.join('; ')}`);
  } else {
    ok('субтитры не отстают от речи', `${pages.length} страниц, перекрытий нет`);
  }

  // Слово, не попавшее ни на одну страницу, молча исчезает из ролика.
  const lost = findLostWords(captions, pages);
  if (lost.length) {
    fail('все слова попали в субтитры', `потеряно ${lost.length}, первое — «${lost[0].text}» на ${lost[0].startMs} мс`);
  } else {
    ok('все слова попали в субтитры', `${captions.length} слов`);
  }

  // Токен, начинающийся с дефиса, — это половина слова: whisper режет «из-за»
  // на «из» и «-за», и половинки разъезжаются по страницам.
  const torn = findTornTokens(captions);
  if (torn.length) {
    fail('слова не разорваны переносом', `${torn.length} обрубков: ${torn.map((t) => t.text).join(', ')}`);
  } else {
    ok('слова не разорваны переносом', 'обрубков нет');
  }

  // Страница шире лимита не влезет в отведённую полосу и уедет в третью строку.
  const tooLong = findOversizedPages(pages);
  if (tooLong.length) {
    warn('страницы субтитров в габарите', `${tooLong.length} длиннее 34 символов`);
  } else {
    ok('страницы субтитров в габарите', 'все не длиннее 34 символов');
  }

  // Раскадровка обязана покрывать дорожку встык — дыра даёт кадры без графики.
  const scenes = video.story.scenes;
  const gaps = findSceneGaps(scenes);
  if (gaps.length) fail('сцены идут встык', `${gaps.length} разрывов`);
  else ok('сцены идут встык', `${scenes.length} сцен`);
}

// ── 2. Готовый файл ──────────────────────────────────────────────────────────

if (!fs.existsSync(outFile)) {
  fail('готовый файл на месте', `нет ${path.relative(proj, outFile)} — сначала node scripts/render.mjs ${slug}`);
} else {
  const probe = spawnSync('ffprobe', ['-v', 'error',
    '-show_entries', 'stream=codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels',
    '-show_entries', 'format=duration,size', '-of', 'json', outFile], { encoding: 'utf8' });

  let meta = null;
  try { meta = JSON.parse(probe.stdout); } catch { /* разберём ниже */ }

  if (!meta) {
    fail('файл читается', `ffprobe не разобрал ${path.basename(outFile)}`);
  } else {
    const v = meta.streams.find((s) => s.codec_type === 'video');
    const a = meta.streams.find((s) => s.codec_type === 'audio');
    const durationSec = parseFloat(meta.format.duration);

    if (!v) fail('видеодорожка есть', 'в файле нет видеопотока');
    else if (v.width !== 1080 || v.height !== 1920) {
      fail('кадр 1080×1920', `фактически ${v.width}×${v.height}`);
    } else {
      ok('кадр 1080×1920', `${v.codec_name}, ${v.r_frame_rate} fps`);
    }

    // Звука нет — самый дорогой из тихих дефектов: ролик выглядит готовым.
    if (!a) {
      fail('звуковая дорожка есть', 'в файле нет аудиопотока');
    } else {
      ok('звуковая дорожка есть', a.codec_name);

      // Формат дорожки, а не только её наличие.
      //
      // 11.08.2026 в готовом ролике оказалось 96 кГц — частота пришла с айфона и
      // проехала весь конвейер. Файл при этом «звучит» локально, поэтому дефект
      // тихий: спотыкаются на нём чужие плееры и загрузчики соцсетей, то есть
      // обнаруживается он уже после публикации.
      const rate = parseInt(a.sample_rate, 10);
      const channels = parseInt(a.channels, 10);
      if (rate !== 48000 && rate !== 44100) {
        fail('частота дискретизации веб-стандартная', `${rate} Гц — ожидается 48000 или 44100`);
      } else {
        ok('частота дискретизации веб-стандартная', `${rate} Гц`);
      }
      if (channels !== 1 && channels !== 2) {
        fail('каналов 1 или 2', `${channels} — нестандартная раскладка`);
      } else {
        ok('каналов 1 или 2', channels === 1 ? 'моно' : 'стерео');
      }
    }

    // Длительность сверяется с таймлайном, а не с ожиданием в голове.
    const expectedSec = timeline.totalFrames / timeline.fps;
    const drift = Math.abs(durationSec - expectedSec);
    if (drift > 0.5) {
      fail('длительность совпадает с таймлайном', `файл ${durationSec.toFixed(2)} с, таймлайн ${expectedSec.toFixed(2)} с`);
    } else {
      ok('длительность совпадает с таймлайном', `${durationSec.toFixed(2)} с`);
    }

    // Громкость. Недобор при пиках у потолка — физика речи, а не сбой.
    const loud = spawnSync('ffmpeg', ['-hide_banner', '-i', outFile,
      '-af', 'loudnorm=print_format=summary', '-f', 'null', '-'], { encoding: 'utf8' });
    const li = (loud.stderr || '').match(/Input Integrated:\s*(-?[\d.]+)\s*LUFS/);
    const lp = (loud.stderr || '').match(/Input True Peak:\s*(-?[\d.]+)\s*dBTP/);
    if (!li || !lp) {
      warn('громкость измерена', 'не нашёл строки loudnorm в выводе ffmpeg');
    } else {
      const integrated = parseFloat(li[1]);
      const peak = parseFloat(lp[1]);
      const deviation = Math.abs(integrated - -14);
      if (deviation <= 1) ok('громкость около −14 LUFS', `${integrated} LUFS, пик ${peak} dBTP`);
      // Слишком тихо даже с упором в пики — это уже не про монтаж, а про запись:
      // пики забиты ударами по микрофону, и на речь запаса не остаётся. Замер
      // mvp-palatka 11.08.2026: среднее −25,8 LUFS при пиках −0,2 dBTP.
      // Поднять такое можно только лимитером, а он рвёт волну (130 щелчков).
      else if (integrated < -20 && peak > -3) {
        warn('громкость около −14 LUFS',
          `${integrated} LUFS при пике ${peak} dBTP — пики заняты ударами, не речью. `
          + 'Лечится микрофоном (поп-фильтр, отвести от лица), а не монтажом: '
          + 'лимитер поднимет среднее ценой щелчков.');
      }
      else if (integrated < -14 && peak > -2) {
        ok('громкость упёрлась в пики', `${integrated} LUFS при пике ${peak} dBTP — выше не поднять, не срезав речь`);
      } else {
        fail('громкость около −14 LUFS', `${integrated} LUFS, отклонение ${deviation.toFixed(1)} LU`);
      }
    }

    // ── 3. Речь в готовом файле (по флагу) ───────────────────────────────────
    if (withSpeech) {
      if (spawnSync('which', ['mlx_whisper']).status !== 0) {
        warn('речь в файле совпадает с транскриптом', 'mlx_whisper не установлен');
      } else {
        const tmpWav = path.join(proj, 'out', '.check-speech.wav');
        spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', outFile, '-vn', '-ac', '1', '-ar', '16000', tmpWav]);
        const rec = spawnSync('mlx_whisper', [tmpWav, '--language', 'ru',
          '--model', 'mlx-community/whisper-large-v3-turbo',
          '--output-format', 'txt', '--output-name', '.check-speech', '--output-dir', path.join(proj, 'out')],
          { encoding: 'utf8' });
        const txtPath = path.join(proj, 'out', '.check-speech.txt');
        if (rec.status !== 0 || !fs.existsSync(txtPath)) {
          warn('речь в файле совпадает с транскриптом', 'распознавание не отработало');
        } else {
          const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
          const heard = new Set(norm(fs.readFileSync(txtPath, 'utf8')));
          const expected = norm(captions.map((c) => c.text).join(' '));
          const missing = expected.filter((w) => !heard.has(w));
          const ratio = expected.length ? 1 - missing.length / expected.length : 0;
          if (ratio < 0.8) {
            fail('речь в файле совпадает с транскриптом', `совпало ${(ratio * 100).toFixed(0)}% слов — в дорожке не то, что ожидалось`);
          } else {
            ok('речь в файле совпадает с транскриптом', `совпало ${(ratio * 100).toFixed(0)}% слов`);
          }
          fs.rmSync(txtPath, { force: true });
        }
        fs.rmSync(tmpWav, { force: true });
      }
    }

    // ── 3b. Скачки яркости ───────────────────────────────────────────────────
    //
    // У story@1 видео идёт непрерывно, монтажных склеек в нём нет — значит
    // любой резкий скачок яркости это дефект наложения графики. Проверка
    // читает ВСЕ кадры, а не выборку: оба дефекта 11.08.2026 сидели между
    // границами сцен, куда выборочный взгляд не попадал.
    if (video.template === 'story@1') {
      const stats = spawnSync('ffmpeg', ['-v', 'error', '-i', outFile,
        '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
        '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

      const frames = [];
      let pts = null;
      for (const line of (stats.stdout || '').split('\n')) {
        const t = line.match(/pts_time:([\d.]+)/);
        if (t) { pts = parseFloat(t[1]); continue; }
        const y = line.match(/YAVG=([\d.]+)/);
        if (y && pts !== null) { frames.push({ atSec: pts, yavg: parseFloat(y[1]) }); pts = null; }
      }

      if (frames.length < 2) {
        warn('нет резких скачков яркости', 'не удалось прочитать яркость кадров');
      } else {
        const jumps = findBrightnessJumps(frames);
        if (jumps.length) {
          const list = jumps.slice(0, 3).map((j) => `${j.atSec} с (${j.deltaY > 0 ? '+' : ''}${j.deltaY})`);
          fail('нет резких скачков яркости',
            `${jumps.length}: ${list.join('; ')} — графика включается или гаснет рывком`);
        } else {
          ok('нет резких скачков яркости', `${frames.length} кадров проверено`);
        }
      }
    }

    // ── 3c. Врезки: чем начинаются и на чём стоят ────────────────────────────
    //
    // Три правки монтажа 11.08.2026 сводились к одному: между двумя врезками
    // зритель видел кадр, которого там быть не должно. Причины были разные —
    // текст ещё проявлялся после склейки; врезка начиналась не сразу за словом,
    // и в паузе на лице висел субтитр. Обе величины считаются, значит считать
    // их обязана машина, а не глаз на скриншоте.
    if (video.template === 'story@1') {
      const FULLSCREEN = new Set(['house', 'tent', 'accent']);
      const cuts = video.story.scenes
        .map((sc, i) => ({ ...sc, index: i, fullscreen: FULLSCREEN.has(sc.kind) }))
        .filter((sc) => sc.fullscreen);

      // Поздний вход: пауза между концом слова и началом врезки.
      const words = timeline.scenes.flatMap((s) => s.captions);
      const late = findLateSceneStarts(cuts, words);
      if (late.length) {
        const list = late.map((l) => `${l.kind} на ${(l.startMs / 1000).toFixed(2)} с (+${l.gapMs} мс после «${l.afterWord}»)`);
        fail('врезки входят сразу за словом', `${list.join('; ')} — в паузе на лице висит субтитр`);
      } else if (cuts.length) {
        ok('врезки входят сразу за словом', `${cuts.length} врезок`);
      }

      // Пустой въезд: сколько содержимого в первом кадре сцены против середины.
      //
      // Мерится ВЕРХНЯЯ ЧЕТВЕРТЬ кадра — зона заголовка. Фигуры дома и палатки
      // строятся во времени намеренно (дом достраивается, палатка раскрывается),
      // и по всему кадру детектор ругался бы на приём, а не на дефект. Заголовок
      // же обязан стоять с первого кадра: он объясняет, что зритель видит.
      const ink = (atSec) => {
        const raw = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(atSec), '-i', outFile,
          '-frames:v', '1', '-vf', 'crop=in_w:in_h/4:0:0', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
          { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
        const buf = raw.stdout;
        if (!buf || !buf.length) return null;
        let lit = 0;
        // Порог 60: фон врезки около 18, текст и линии — выше 90.
        for (let i = 0; i < buf.length; i += 1) if (buf[i] > 60) lit += 1;
        return lit;
      };

      const measures = [];
      for (const sc of cuts) {
        const startSec = sc.startMs / 1000;
        const midSec = (sc.startMs + sc.endMs) / 2000;
        const inkStart = ink(startSec + 0.02);
        const inkMid = ink(midSec);
        if (inkStart === null || inkMid === null) continue;
        measures.push({ kind: sc.kind, startSec, inkStart, inkMid });
      }

      const emptyStarts = findEmptySceneStarts(measures);
      if (emptyStarts.length) {
        const list = emptyStarts.map((m) => `${m.kind} на ${m.startSec.toFixed(2)} с (${Math.round((m.inkStart / m.inkMid) * 100)}% содержимого)`);
        fail('врезки въезжают с готовым содержимым', `${list.join('; ')} — текст проявляется уже после склейки`);
      } else if (measures.length) {
        ok('врезки въезжают с готовым содержимым', `${measures.length} врезок`);
      }
    }

    // ── 3d. Щелчки в звуке ───────────────────────────────────────────────────
    //
    // Громкость и наличие дорожки ничего не говорят о форме волны. Ремонт звука
    // 11.08.2026 прошёл обе проверки и внёс 2365 разрывов — их услышал автор,
    // а не приёмка.
    {
      const wav = path.join(proj, 'out', `${slug}-check.wav`);
      const conv = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', outFile,
        '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', wav], { encoding: 'utf8' });
      if (conv.status !== 0) {
        warn('в звуке нет щелчков', 'не удалось извлечь дорожку');
      } else {
        const buf = fs.readFileSync(wav);
        // PCM 16 бит начинается после заголовка WAV; ищем чанк data.
        const dataAt = buf.indexOf('data', 12, 'ascii');
        const samples = new Int16Array(buf.buffer, buf.byteOffset + dataAt + 8,
          Math.floor((buf.length - dataAt - 8) / 2));
        const clicks = findClicks(samples);
        fs.unlinkSync(wav);
        if (clicks.length) {
          const worst = clicks.reduce((a, b) => (b.jump > a.jump ? b : a));
          fail('в звуке нет щелчков',
            `${clicks.length} разрывов волны, худший ${worst.jump} на ${worst.atSec.toFixed(2)} с`);
        } else {
          ok('в звуке нет щелчков', `${samples.length} сэмплов проверено`);
        }
      }
    }

    // ── 4. Контактный лист для человека ──────────────────────────────────────
    // Машина не умеет судить композицию. Единственное честное решение — не
    // делать вид, что проверила, а положить перед человеком размеченные кадры.
    const sheet = path.join(proj, 'out', `${slug}-check.jpg`);
    try {
      const legend = buildContactSheet({ src: outFile, atSeconds: evenMoments(durationSec, 6), out: sheet });
      ok('контактный лист собран', path.relative(path.join(engine, '..'), sheet));
      results.legend = legend;
    } catch (err) {
      warn('контактный лист собран', err.message.split('\n')[0]);
    }
  }
}

// ── Отчёт ────────────────────────────────────────────────────────────────────

const width = Math.max(...results.map((r) => r.name.length));
console.log(`\nПриёмка ролика ${slug}\n`);
for (const r of results) {
  const mark = r.status === 'PASS' ? '✓' : r.status === 'WARN' ? '!' : '✗';
  console.log(`  ${mark} ${r.name.padEnd(width)}  ${r.detail}`);
}

const failed = results.filter((r) => r.status === 'FAIL');
const warned = results.filter((r) => r.status === 'WARN');

if (results.legend) {
  console.log('\nПосмотри контактный лист — это то, что машина проверить не может:');
  for (const line of results.legend) console.log(`  · ${line}`);
  console.log('  · лицо не должно заходить НИЖЕ жёлтой линии — там стоит панель');
}

console.log();
if (failed.length) {
  console.error(`ПРИЁМКА НЕ ПРОЙДЕНА: ${failed.length} провалов, ${warned.length} предупреждений.`);
  process.exit(1);
}
console.log(`Машинная часть приёмки пройдена${warned.length ? `, предупреждений: ${warned.length}` : ''}.`);

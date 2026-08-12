// Детекторы дефектов, которые не видно глазами на кадре.
//
// Вынесены из scripts/check.mjs отдельным модулем ровно для того, чтобы их
// можно было прогнать на СЛОМАННЫХ данных в тестах. Проверка, которую нельзя
// проверить, — это обещание, а не механизм: предохранитель L001 был признан
// рабочим после прогона на одной команде и обходился другим инструментом
// (см. ~/.claude/lessons/README.md, третье правило).
//
// Каждая функция возвращает список находок. Пусто — дефекта нет.

/**
 * Страницы субтитров, перекрывающие следующую.
 *
 * Перекрытие означает, что предыдущая страница ещё висит на экране, когда
 * следующая уже должна звучать, — субтитр отстаёт от речи. На отдельном кадре
 * это выглядит нормально (текст есть, он читается), поэтому приёмка глазами
 * пропускает дефект целиком. Замер 11.08.2026: 7 стыков сцен из 7, отставание
 * до 400 мс.
 */
export function findPageOverlaps(pages) {
  const out = [];
  for (let i = 1; i < pages.length; i += 1) {
    const lagMs = pages[i - 1].untilMs - pages[i].startMs;
    if (lagMs > 0) out.push({ atMs: pages[i].startMs, lagMs });
  }
  return out;
}

/** Слова, не попавшие ни на одну страницу: они молча исчезают из ролика. */
export function findLostWords(captions, pages) {
  const shown = new Set(pages.flatMap((p) => p.words.map((w) => `${w.startMs}|${w.text}`)));
  return captions.filter((c) => !shown.has(`${c.startMs}|${c.text}`));
}

/**
 * Обрубки слов.
 *
 * Whisper режет «из-за» на «из» и «-за». Половинки расходятся по разным
 * страницам, и зритель видит «продукта, из», а через секунду «-за этой
 * путаницы». Ловится по ведущему дефису.
 */
export function findTornTokens(captions) {
  return captions.filter((c) => /^[-–—]/.test(c.text));
}

/** Разрывы раскадровки: кадры, не покрытые ни одной сценой. */
export function findSceneGaps(scenes) {
  const out = [];
  for (let i = 1; i < scenes.length; i += 1) {
    if (scenes[i].startMs !== scenes[i - 1].endMs) {
      out.push({ index: i, expectedMs: scenes[i - 1].endMs, actualMs: scenes[i].startMs });
    }
  }
  return out;
}

/**
 * Резкие скачки средней яркости между соседними кадрами.
 *
 * У story@1 видеослой непрерывен и монтажных склеек в нём нет вовсе, поэтому
 * любой скачок яркости — это дефект наложения графики, а не приём. Два таких
 * нашлись на сборке 11.08.2026, и оба пережили приёмку:
 *   12,47 с  +33,8 — между двумя фулскрин-врезками мелькало живое видео;
 *   18,90 с  +37,4 — врезка обрывалась за один кадр.
 * Ни то, ни другое не видно на отдельном кадре: чтобы заметить, надо сравнить
 * СОСЕДНИЕ кадры, а глазами их никто не сравнивает.
 *
 * @param {{atSec:number, yavg:number}[]} frames
 */
export function findBrightnessJumps(frames, threshold = 0.35, { returnWithinSec = 0.5 } = {}) {
  const out = [];
  const baseline = (() => {
    const sorted = frames.map((f) => f.yavg).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  })();

  for (let i = 1; i < frames.length; i += 1) {
    const delta = frames[i].yavg - frames[i - 1].yavg;
    const scale = Math.max(Math.abs(frames[i].yavg), Math.abs(frames[i - 1].yavg), 1);

    // Скачки внутри тёмной врезки пропускаются: там намеренно меняется рисунок.
    if (scale < baseline * 0.5) continue;
    if (Math.abs(delta) / scale <= threshold) continue;

    // Дефект — это ВСПЫШКА, то есть скачок и возврат обратно за доли секунды.
    // Одиночный скачок без возврата — монтажная склейка: с 11.08.2026 врезки
    // входят и выходят резко, по решению автора, и считать это дефектом
    // нельзя. Отличие видно по тому, что происходит следом: при вспышке кадр
    // возвращается к прежнему уровню, при склейке остаётся на новом.
    const back = frames.findIndex((f, j) => j > i
      && f.atSec - frames[i].atSec <= returnWithinSec
      && Math.abs(f.yavg - frames[i - 1].yavg) / scale < threshold / 2);
    if (back === -1) continue;

    out.push({
      atSec: +frames[i].atSec.toFixed(2),
      deltaY: +delta.toFixed(1),
      fromY: +frames[i - 1].yavg.toFixed(1),
      toY: +frames[i].yavg.toFixed(1),
      returnedAtSec: +frames[back].atSec.toFixed(2),
    });
  }
  return out;
}

/** Страницы длиннее лимита: уедут в лишнюю строку и поднимут блок на лицо. */
export function findOversizedPages(pages, maxChars = 34) {
  return pages.filter((p) => {
    const chars = p.words.reduce((n, w) => n + w.text.length, 0) + p.words.length - 1;
    return chars > maxChars;
  });
}

/**
 * Не устарел ли собранный таймлайн относительно раскадровки.
 *
 * Тайминги сцен живут не в video.json, а в audio/timeline.json, который
 * собирает отдельный шаг. Правка раскадровки без пересборки таймлайна
 * рендерится молча и полностью успешно — просто по старым временам сцен.
 * Ровно это и случилось 11.08.2026: три правки монтажа «применились», прошли
 * приёмку и не изменили ни одного кадра.
 *
 * Возвращает null, если всё свежее, иначе строку с указанием, что запустить.
 */
export function findStaleTimeline({ videoMtimeMs, timelineMtimeMs, maker }) {
  if (timelineMtimeMs >= videoMtimeMs) return null;
  const lagSec = Math.round((videoMtimeMs - timelineMtimeMs) / 1000);
  return `video.json новее audio/timeline.json на ${lagSec} с — тайминги сцен не пересобраны. Запусти: node scripts/${maker} <slug>`;
}

/**
 * Разрывы звуковой волны — щелчки.
 *
 * Ищет скачок между соседними сэмплами. В речи при 48 кГц такого перепада не
 * бывает даже на взрывных согласных: за один сэмпл (21 мкс) волна физически не
 * успевает пройти половину шкалы. Зато его даёт любая склейка встык и любой
 * фильтр громкости с мгновенной границей.
 *
 * Повод: 11.08.2026 мой же ремонт звука внёс 2365 щелчков со скачком до 29162
 * при шкале 32767. Приёмка их не видела — она мерила громкость и наличие
 * дорожки, а не форму волны. Услышал автор: «второй ролик посмотрел, там оч
 * много ошибок со звуком».
 */
export function findClicks(samples, { sampleRate = 48000, jumpRatio = 0.5, fullScale = 32768 } = {}) {
  const limit = fullScale * jumpRatio;
  const hits = [];
  for (let i = 1; i < samples.length; i += 1) {
    const jump = Math.abs(samples[i] - samples[i - 1]);
    if (jump > limit) hits.push({ atSec: i / sampleRate, jump });
  }
  return hits;
}

/**
 * Врезки, которые въезжают пустыми.
 *
 * На входе замеры: сколько «чернил» (пикселей ярче фона) в первом кадре сцены и
 * сколько в её середине. Если в начале заметно меньше — содержимое проявляется
 * уже после склейки, и зритель первые кадры смотрит на пустой экран.
 *
 * Повод: 11.08.2026 переходы сделали резкими, а проявление текста осталось —
 * первым кадром акцента шёл чёрный экран без единой буквы. автор увидел это
 * как лишнюю склейку между врезками.
 */
export function findEmptySceneStarts(measures, { minRatio = 0.6 } = {}) {
  return measures.filter((m) => m.inkMid > 0 && m.inkStart / m.inkMid < minRatio);
}

/**
 * Врезки, начинающиеся не сразу за словом.
 *
 * Пауза между концом последнего слова и началом врезки — это кадры, где речи
 * уже нет, а на лице ещё висит субтитр предыдущего слова. Читается как лишний
 * кадр ни о чём.
 *
 * Повод: 11.08.2026 дом входил на 8,26 при том, что «плохо» кончается на 7,92,
 * и акцент на 25,62 при конце «выкинуть» на 25,50. автор отметил оба места
 * независимо друг от друга.
 */
export function findLateSceneStarts(scenes, words, { maxGapMs = 150 } = {}) {
  const late = [];
  for (const scene of scenes) {
    if (!scene.fullscreen) continue;
    const prev = words.filter((w) => w.endMs <= scene.startMs).pop();
    if (!prev) continue;
    const gapMs = scene.startMs - prev.endMs;
    if (gapMs > maxGapMs) late.push({ kind: scene.kind, startMs: scene.startMs, gapMs, afterWord: prev.text });
  }
  return late;
}

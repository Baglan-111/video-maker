// Сборка audio/timeline.json для шаблона story@1.
//
// Отличие от buildTimeline (scripts/lib/timeline.mjs) принципиальное, поэтому
// это отдельная функция, а не флаг в прежней. Там сцены СКЛАДЫВАЮТСЯ: каждая
// приносит свой wav, курсор едет вперёд, метки сдвигаются на позицию сцены.
// Здесь дорожка одна и уже смонтирована — сцены её РАЗМЕЧАЮТ. Метки слов
// абсолютны с самого начала, сдвигать их некуда, а границы сцен обязаны точно
// покрывать дорожку без дыр.
//
// Общим остаётся формат результата: тот же Timeline, что отдаёт tts.mjs, чтобы
// preparePublic, render.mjs и <Subtitles> не знали, откуда взялся звук.

const msToFrames = (ms, fps) => Math.round((ms / 1000) * fps);

/**
 * Плоский список слов из выдачи whisper. Пустые токены отбрасываются.
 *
 * Токен, начинающийся с дефиса, приклеивается к предыдущему слову. Whisper режет
 * «из-за» на «из» и «-за», и без склейки половинки разъезжаются по разным
 * страницам субтитров: зритель видит «продукта, из», а через секунду «-за этой
 * путаницы». Поймано на mvp-palatka, 4-я секунда.
 */
function flattenWords(whisper) {
  const out = [];
  for (const seg of whisper.segments ?? []) {
    for (const w of seg.words ?? []) {
      const text = (w.word ?? '').trim();
      if (!text) continue;
      if (/^[-–—]/.test(text) && out.length) {
        const prev = out[out.length - 1];
        prev.text += text;
        prev.endMs = Math.round(w.end * 1000);
        continue;
      }
      out.push({
        text,
        startMs: Math.round(w.start * 1000),
        endMs: Math.round(w.end * 1000),
        timestampMs: null,
        // probability whisper — не то же, что confidence в контракте Caption,
        // но шкала совпадает (0..1), а поле по контракту обязано быть.
        confidence: typeof w.probability === 'number' ? w.probability : null,
      });
    }
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}

/**
 * @param {object} p
 * @param {string} p.slug
 * @param {number} p.fps
 * @param {number} p.sourceMs фактическая длительность видеофайла (ffprobe, не метки)
 * @param {Array}  p.scenes   раскадровка из video.json → story.scenes
 * @param {object} p.whisper  выдача mlx_whisper с word-timestamps
 */
export function buildStoryTimeline({ slug, fps, sourceMs, scenes, whisper }) {
  if (!scenes?.length) throw new Error('раскадровка пуста — нечего размечать');

  const words = flattenWords(whisper);
  if (!words.length) {
    throw new Error(
      'в транскрипте нет ни одного слова с меткой времени — субтитров не будет. ' +
        'Проверь, что дорожка ролика содержит речь, и пересобери транскрипт с --force.',
    );
  }

  const lastEnd = scenes[scenes.length - 1].endMs;

  // Раскадровка длиннее файла — это кадры, которых нет: Remotion досчитает
  // композицию до конца, а видео закончится, и зритель увидит застывший
  // последний кадр под тишину. Ловим здесь, а не в готовом mp4.
  if (lastEnd > sourceMs + 40) {
    throw new Error(
      `раскадровка кончается на ${lastEnd} мс, а видео длится ${sourceMs} мс — ` +
        `последние ${lastEnd - sourceMs} мс покрывать нечем. Поправь endMs последней сцены в video.json.`,
    );
  }

  // Хвост видео, не покрытый раскадровкой, длиннее полусекунды — почти наверняка
  // забытый кусок речи, а не пауза на вдох. Предупреждаем, но не падаем: бывает
  // и намеренная обрезка.
  const warnings = [];
  if (sourceMs - lastEnd > 500) {
    warnings.push(
      `последние ${sourceMs - lastEnd} мс видео не покрыты раскадровкой — ролик оборвётся на ${lastEnd} мс. ` +
        `Если это не задумано, продли endMs последней сцены.`,
    );
  }

  // Слово попадает в сцену по своему НАЧАЛУ. Иначе слово, произнесённое на
  // стыке, попало бы сразу в две сцены и субтитр показал бы его дважды.
  const out = scenes.map((sc, index) => {
    const captions = words
      .filter((w) => w.startMs >= sc.startMs && w.startMs < sc.endMs)
      .map((w) => ({ ...w }));

    const startFrame = msToFrames(sc.startMs, fps);
    const endFrame = msToFrames(sc.endMs, fps);

    return {
      index,
      // display в story@1 не рисуется: текст на экране задаётся полями сцены
      // (kicker, title, lines…), а не одной универсальной строкой. Поле есть,
      // потому что формат Timeline общий; здесь оно служит подписью в отладке.
      display: sc.kind,
      // Звук идёт из видеослоя одной непрерывной дорожкой, отдельных wav нет.
      audioFile: null,
      startFrame,
      durationFrames: Math.max(1, endFrame - startFrame),
      captions,
    };
  });

  // Инвариант из timeline.mjs: следующая сцена начинается ровно там, где
  // кончилась предыдущая. После округления в кадры это может разъехаться на
  // кадр — тогда между <Sequence> появится непокрытый кадр (моргание).
  for (let i = 1; i < out.length; i += 1) {
    const prevEnd = out[i - 1].startFrame + out[i - 1].durationFrames;
    if (out[i].startFrame !== prevEnd) {
      throw new Error(
        `после округления в кадры сцена ${i} начинается с кадра ${out[i].startFrame}, ` +
          `а предыдущая кончается на ${prevEnd} — между ними щель. Сдвинь границу в video.json на 1–2 мс.`,
      );
    }
  }

  const lostWords = words.filter(
    (w) => !out.some((s) => s.captions.some((c) => c.startMs === w.startMs && c.text === w.text)),
  );
  if (lostWords.length) {
    warnings.push(
      `${lostWords.length} слов не попали ни в одну сцену и не появятся в субтитрах ` +
        `(первое — «${lostWords[0].text}» на ${lostWords[0].startMs} мс).`,
    );
  }

  for (const w of warnings) console.warn(`ПРЕДУПРЕЖДЕНИЕ: ${w}`);

  const last = out[out.length - 1];
  return {
    fps,
    totalFrames: last.startFrame + last.durationFrames,
    slug,
    // Голоса ElevenLabs здесь нет — речь снята. Поле в контракте Timeline
    // обязательное, поэтому заполняется явной пометкой, а не пустой строкой:
    // пустая читалась бы как «забыли заполнить».
    voiceId: 'recorded',
    scenes: out,
  };
}

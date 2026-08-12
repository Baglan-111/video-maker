import { createTikTokStyleCaptions } from '@remotion/captions';

// Разбивка субтитров на страницы (дефект C2).
//
// Раньше Kinetic отдавал в <Subtitles> все captions ролика сразу: на сорока
// секундах это ~110 слов одним блоком, он вылезал за кадр 1080×1920 и закрывал
// текст сцены. Теперь на экране одна страница — та, что звучит сейчас.
//
// Группировку делает createTikTokStyleCaptions из @remotion/captions, но ему
// нужна нормализация: он начинает новую страницу только на токене, чей текст
// начинается с ПРОБЕЛА (соглашение whisper). Слова от ElevenLabs приходят без
// пробелов, поэтому без этой правки библиотека возвращает ровно одну страницу
// на весь ролик — тот же дефект, только другими руками.
//
// Поверх библиотеки — жёсткий предел MAX_WORDS_PER_PAGE. Библиотека режет
// только по времени, поэтому быстрая речь даёт страницы на 7–8 слов, а это
// снова две-три строки и риск выхода за кадр. Предел по словам — гарантия
// размера, независимая от темпа речи.

export const MAX_WORDS_PER_PAGE = 4;
export const COMBINE_MS = 900;
export const TAIL_MS = 400;

export function buildPages(captions, opts = {}) {
  const maxWords = opts.maxWords ?? MAX_WORDS_PER_PAGE;
  const combineMs = opts.combineTokensWithinMilliseconds ?? COMBINE_MS;
  const tailMs = opts.tailMs ?? TAIL_MS;

  if (!captions || captions.length === 0) return [];

  const normalized = captions.map((c, i) => ({
    ...c,
    text: i === 0 ? c.text : ` ${c.text}`,
  }));

  const { pages } = createTikTokStyleCaptions({
    captions: normalized,
    combineTokensWithinMilliseconds: combineMs,
  });

  const out = [];
  for (const page of pages) {
    const tokens = page.tokens.filter((t) => t.text.trim() !== '');
    for (let i = 0; i < tokens.length; i += maxWords) {
      const chunk = tokens.slice(i, i + maxWords);
      out.push({
        startMs: chunk[0].fromMs,
        endMs: chunk[chunk.length - 1].toMs,
        untilMs: 0,
        words: chunk.map((t) => ({ text: t.text.trim(), startMs: t.fromMs, endMs: t.toMs })),
      });
    }
  }

  out.sort((a, b) => a.startMs - b.startMs);
  // Страница держится до начала следующей: иначе в паузе между словами субтитр
  // пропадает и мигает.
  out.forEach((p, i) => {
    p.untilMs = i + 1 < out.length ? out[i + 1].startMs : p.endMs + tailMs;
  });

  return out;
}

/**
 * Собирает страницы отдельно по каждой сцене и склеивает результат.
 *
 * Регрессия найдена на 1.2 с готового test-ok.mp4 (финальное ревью 06.08.2026):
 * Kinetic сплющивал captions ВСЕХ сцен в один плоский список (`scenes.flatMap`)
 * и отдавал buildPages() как единому транскрипту. combineTokensWithinMilliseconds
 * (900 мс) не знает о границах сцен — если пауза между концом речи сцены N и
 * началом речи сцены N+1 короче 900 мс (обычное дело при gapMs), их слова
 * попадают в один и тот же чанк по MAX_WORDS_PER_PAGE. На экране это выглядит
 * как заголовок ещё сцены 0, а под ним уже слово из сцены 1.
 *
 * Фикс — строить страницы для каждой сцены в её собственном вызове buildPages
 * (никакого combine через границу) и склеивать списки. Слова разных сцен в
 * одну страницу так физически не попадают.
 */
export function buildPagesForScenes(scenes, opts = {}) {
  return scenes.flatMap((s) => buildPages(s.captions, opts));
}

export function pageAt(pages, ms) {
  for (const p of pages) {
    if (ms >= p.startMs && ms < p.untilMs) return p;
  }
  return null;
}

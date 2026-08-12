// Разбивка субтитров на страницы для story@1.
//
// Почему не общий buildPages из pages.mjs. Тот режет поток механически: окно
// склейки по времени, затем жёсткий предел в 4 слова. На синтезированной речи
// это терпимо — там сцена короткая и совпадает с фразой. На снятом монологе
// получается мусор, проверено на этом же ролике:
//   «версия продукта, из» / «-за этой путаницы команды»  — слово разорвано
//   «не что выкинуть. Правильный»                        — конец одной фразы
//                                                          склеен с началом другой
// Читатель субтитров видит их долю секунды и боковым зрением; страница обязана
// быть законченным куском смысла, а не отрезком длиной в четыре токена.
//
// Правила границ, по убыванию силы:
//   1. Конец предложения (. ! ?) — граница всегда.
//   2. Пауза в речи длиннее PAUSE_MS — говорящий сам поставил границу.
//   3. Запятая, двоеточие, тире — граница, если страница уже не пустая.
//   4. Переполнение (по словам или символам) — граница вынужденная.
// И один запрет поверх всех: страница не заканчивается служебным словом.
// «продукта, из» обрывается ровно там, где предлог уже прозвучал, а то, к чему
// он относится, ещё нет.

// Главный ограничитель — символы, а не слова: «полностью» и «и» занимают
// разное место, и лимит в пять слов рвал «она меньше дома в 100 / раз,» ровно
// между числом и его существительным, хотя вся фраза — 26 символов и влезала
// целиком. Предел по словам оставлен страховкой от строки из односложных слов.
export const MAX_WORDS = 7;
export const MAX_CHARS = 30;
/** Страница короче этого склеивается с соседней, если та её вмещает. */
export const MIN_CHARS = 12;

/**
 * Режим «одно слово на экране».
 *
 * Разбор референсов 11.08.2026 показал, что во всех роликах, которые автору
 * нравятся, субтитр — ровно одно слово. Тогда вся логика границ, висячих
 * предлогов и склейки огрызков не нужна: границы совпадают со словами.
 *
 * Функция оставлена рядом с buildStoryPages, а не заменяет её: фразовый режим
 * ещё может понадобиться для роликов, которые смотрят без звука и читают.
 */
export function buildWordPages(words, opts = {}) {
  const tailMs = opts.tailMs ?? TAIL_MS;
  if (!words?.length) return [];

  const pages = words.map((w) => ({
    startMs: w.startMs,
    endMs: w.endMs,
    untilMs: 0,
    words: [{ text: w.text, startMs: w.startMs, endMs: w.endMs }],
  }));

  // Слово держится до следующего, а не до своего конца: иначе в паузах между
  // словами экран пустеет и субтитр мигает на каждом вдохе.
  pages.forEach((p, i) => {
    p.untilMs = i + 1 < pages.length ? pages[i + 1].startMs : p.endMs + tailMs;
  });

  return pages;
}
export const PAUSE_MS = 350;
export const TAIL_MS = 400;

// Предлоги, союзы и частицы, которые не могут стоять последними на странице:
// они синтаксически висят на следующем слове.
const DANGLING = new Set([
  'а', 'б', 'бы', 'в', 'во', 'да', 'для', 'до', 'ж', 'же', 'за', 'и', 'из', 'из-за', 'или', 'к',
  'ко', 'ли', 'на', 'над', 'не', 'ни', 'но', 'о', 'об', 'от', 'перед', 'по', 'под', 'при', 'про',
  'с', 'со', 'то', 'у', 'уже', 'что', 'чтобы', 'это',
]);

const clean = (text) => text.replace(/[^\p{L}\p{N}-]/gu, '').toLowerCase();

const endsSentence = (text) => /[.!?…]$/.test(text.trim());
const endsClause = (text) => /[,;:—–]$/.test(text.trim());

// Число в конце страницы висит так же, как предлог: «в 100» без «раз» — это
// половина меры. Ловится отдельно от списка, потому что чисел бесконечно много.
const isNumber = (text) => /^\d+$/.test(clean(text));

const isDangling = (word) => DANGLING.has(clean(word.text)) || isNumber(word.text);

const pageOf = (words) => ({
  startMs: words[0].startMs,
  endMs: words[words.length - 1].endMs,
  untilMs: 0,
  words: words.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs })),
});

const charLen = (words) => words.reduce((n, w) => n + w.text.length, 0) + words.length - 1;

/**
 * Собирает страницы субтитров из плоского списка слов с абсолютными метками.
 *
 * @param {{text:string,startMs:number,endMs:number}[]} words
 */
export function buildStoryPages(words, opts = {}) {
  const maxWords = opts.maxWords ?? MAX_WORDS;
  const maxChars = opts.maxChars ?? MAX_CHARS;
  const pauseMs = opts.pauseMs ?? PAUSE_MS;
  const tailMs = opts.tailMs ?? TAIL_MS;

  if (!words?.length) return [];

  const pages = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    // Висящие слова в конце страницы уезжают на следующую вместе со своим
    // словом — и снимаются цепочкой, а не по одному: «размера это не» оставляет
    // висеть сразу два («это» и «не»), и снятие только последнего давало
    // страницу «Дом в четверть размера это».
    const moved = [];
    while (current.length > 1 && isDangling(current[current.length - 1])) {
      moved.unshift(current.pop());
    }
    pages.push(pageOf(current));
    // Если страница осталась бы пустой, слова не забираем: одинокий предлог
    // лучше пустой страницы.
    current = moved;
  };

  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    const prev = words[i - 1];

    // Пауза в речи — граница до добавления слова, а не после: слово после
    // паузы открывает новую мысль.
    if (prev && w.startMs - prev.endMs >= pauseMs) flush();

    // Переполнение: закрываем страницу перед словом, которое в неё не влезло.
    const wouldOverflow =
      current.length >= maxWords || (current.length > 0 && charLen([...current, w]) > maxChars);
    if (wouldOverflow) flush();

    current.push(w);

    if (endsSentence(w.text)) flush();
    else if (endsClause(w.text) && current.length >= 2) flush();
  }

  flush();

  // Огрызки склеиваем с соседями.
  //
  // Смысловая граница иногда отрезает одно короткое слово: «полностью.» или
  // «раз,» отдельной страницей мигают на экране полсекунды и читаются как сбой,
  // а не как акцент. Присоединяем к предыдущей странице, если она вмещает, иначе
  // к следующей. Границу предложения при этом не нарушаем — склеиваем только с
  // той стороной, которая принадлежит той же фразе.
  const minChars = opts.minChars ?? MIN_CHARS;
  for (let i = pages.length - 1; i >= 0; i -= 1) {
    const p = pages[i];
    if (charLen(p.words) >= minChars || pages.length === 1) continue;

    const prev = pages[i - 1];
    const next = pages[i + 1];
    const fits = (other) => other && charLen([...other.words, ...p.words]) <= maxChars;

    // Склейка не имеет права переехать смысловую границу — иначе она вернёт
    // ровно тот дефект, от которого мы уходили. Защищены три вещи: конец
    // предложения, запятая и пауза в речи. Всё это границы, которые поставил
    // сам говорящий, а не переполнение строки.
    const lastOf = (page) => page.words[page.words.length - 1].text;
    const guarded = (left, right) =>
      endsSentence(lastOf(left)) ||
      endsClause(lastOf(left)) ||
      right.startMs - left.endMs >= pauseMs;

    if (prev && !guarded(prev, p) && fits(prev)) {
      prev.words.push(...p.words);
      prev.endMs = p.endMs;
      pages.splice(i, 1);
    } else if (next && !guarded(p, next) && fits(next)) {
      next.words.unshift(...p.words);
      next.startMs = p.startMs;
      pages.splice(i, 1);
    }
  }

  // Страница держится до начала следующей — иначе в паузе между словами субтитр
  // мигает. Хвост считается по всему ролику, а не внутри сцены: сцены здесь
  // нарезаны по монтажу, а речь идёт сквозь них непрерывно, и страница,
  // «додержанная» до конца своей сцены, перекрывала бы первую страницу
  // следующей (замер на mvp-palatka: отставание до 400 мс на 7 стыках из 7).
  pages.forEach((p, i) => {
    p.untilMs = i + 1 < pages.length ? pages[i + 1].startMs : p.endMs + tailMs;
  });

  return pages;
}

/**
 * Убирает знаки препинания из слова субтитра.
 *
 * Чистится ТОЛЬКО отображение, а не транскрипт: точки и запятые нужны разбивке
 * (они задают границы страниц) и детекторам приёмки. На экране же одиночное
 * слово с висящей запятой — «ПЛОХО,» — выглядит обрывком, потому что читать
 * там нечего: пунктуация служит фразе, а фразы на экране нет.
 *
 * Дефис внутри слова сохраняется: «ИЗ-ЗА» — одно слово, а не два со знаком.
 */
export function stripPunctuation(text) {
  return text
    .replace(/[.,!?;:…"«»„“”()[\]{}]/g, '')
    // Тире и длинные дефисы по краям — это остатки речи, а не часть слова.
    .replace(/^[-–—]+|[-–—]+$/g, '')
    .trim();
}

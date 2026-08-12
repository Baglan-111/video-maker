// Арифметика шаблона promo@1: какая сцена сейчас на экране, насколько элемент
// проявился или уже уходит, где находится курсор.
//
// Вынесено из компонентов в отдельный .mjs намеренно — по той же причине, что
// pages.mjs и timeline.mjs: чистые функции проверяются `node --test` без запуска
// Remotion. Компоненты остаются тонкими и только рисуют.
//
// Все функции возвращают ЛИНЕЙНЫЕ доли 0..1. Кривую накладывает компонент через
// remotion/interpolate + Easing — здесь нет ни одной кривой, чтобы тесты
// проверяли расписание, а не форму easing.

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Какая сцена таймлайна активна на кадре frame.
 * Возвращает null до первой сцены и после последней.
 */
export function sceneAt(scenes, frame) {
  for (const s of scenes) {
    if (frame >= s.startFrame && frame < s.startFrame + s.durationFrames) {
      return { index: s.index, localFrame: frame - s.startFrame, durationFrames: s.durationFrames, scene: s };
    }
  }
  return null;
}

/**
 * Доли появления и ухода внутри сцены.
 *
 * Если сцена короче, чем appear + disappear, окна сжимаются пропорционально:
 * иначе на короткой сцене элемент начинал бы уходить раньше, чем проявился, и
 * получалась бы вспышка. Сжатие сохраняет их соотношение.
 *
 * exit считается «сколько уже ушло», то есть 0 в начале ухода и 1 в конце.
 */
export function enterExit(localFrame, durationFrames, { enterFrames, exitFrames }) {
  const want = enterFrames + exitFrames;
  const room = Math.max(0, durationFrames);
  const k = want > room && want > 0 ? room / want : 1;
  const enterLen = enterFrames * k;
  const exitLen = exitFrames * k;

  const enter = enterLen <= 0 ? 1 : clamp01(localFrame / enterLen);
  const exitStart = room - exitLen;
  const exit = exitLen <= 0 ? 0 : clamp01((localFrame - exitStart) / exitLen);

  return { enter, exit };
}

/**
 * Фаза панели на кадре frame: появилась ли, уходит ли, сколько кадров прожила.
 * null означает «панели сейчас на экране нет».
 *
 * Окно панели начинается на enterFrames РАНЬШЕ её сцены. Это и есть отказ от
 * монтажных склеек: пока предыдущая панель доигрывает уход, следующая уже
 * проявляется, и на стыке нет ни одного кадра с пустым фоном. Если бы окно
 * совпадало со сценой, между уходом и появлением оставалась бы дыра — на 30 fps
 * это заметное моргание, ровно то, чего в эталоне нет.
 */
export function panelPhase(sceneStart, sceneDuration, frame, { enterFrames, exitFrames }) {
  const from = sceneStart - enterFrames;
  const total = sceneDuration + enterFrames;
  const localFrame = frame - from;
  if (localFrame < 0 || localFrame >= total) return null;
  return {
    ...enterExit(localFrame, total, { enterFrames, exitFrames }),
    localFrame,
    // Кадры от начала самой сцены (может быть отрицательным на опережающем
    // появлении) — по нему заводится хореография внутри панели, например курсор:
    // он должен пойти, когда сцена реально началась, а не пока панель проявляется.
    sceneFrame: frame - sceneStart,
  };
}

/**
 * Прозрачность панели с учётом того, чем она является: текстом или поверхностью.
 *
 * Найдено на стыке сцен готового ролика: карточка проявлялась прозрачностью
 * поверх уходящего заголовка, и текст заголовка просвечивал сквозь белую
 * карточку. Выглядит как сбой рендера, а не как переход.
 *
 * Причина не в длительностях, а в природе объекта. Текст проявляться
 * прозрачностью может — за ним ничего нет. Поверхность (карточка) — не может:
 * она обязана перекрывать то, что под ней, иначе перестаёт быть поверхностью.
 * Поэтому у solid-панелей прозрачность добирается до единицы за первые solidAt
 * долей окна появления, а остаток появления — это только движение.
 *
 * solidAt = 0 дало бы резкое возникновение белого прямоугольника, solidAt = 1 —
 * исходный дефект. Доля, а не кадры, чтобы поведение не зависело от того,
 * сколько кадров отвели на появление.
 */
export function surfaceOpacity(enter, exit, { solid = false, solidAt = 0.35 } = {}) {
  const appear = solid && solidAt > 0 ? Math.min(1, enter / solidAt) : enter;
  return clamp01(appear) * (1 - clamp01(exit));
}

/**
 * Сколько кадров занимает полный проход курсора по points.
 * Расписание: стоянка на первой точке, затем на каждую следующую —
 * переезд + стоянка.
 */
export function cursorTotalFrames(pointCount, { travelFrames, dwellFrames }) {
  if (pointCount <= 0) return 0;
  return dwellFrames + Math.max(0, pointCount - 1) * (travelFrames + dwellFrames);
}

/**
 * Где курсор на кадре localFrame.
 *
 * Возвращает отрезок {from, to, t}: компонент интерполирует между from и to по
 * доле t, наложив кривую замедления. Когда курсор стоит, from === to и t === 1 —
 * компоненту не нужно различать «едет» и «стоит».
 *
 * После прохода всех точек курсор остаётся на последней, а не прыгает в начало:
 * ролик заканчивается там, где закончился взгляд зрителя.
 */
export function cursorSegment(points, localFrame, { travelFrames, dwellFrames }) {
  if (!points || points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length === 1) return { from: first, to: first, t: 1 };

  let f = localFrame;
  if (f < dwellFrames) return { from: first, to: first, t: 1 };
  f -= dwellFrames;

  const cycle = travelFrames + dwellFrames;
  const i = Math.floor(f / cycle);
  if (i >= points.length - 1) return { from: last, to: last, t: 1 };

  const within = f - i * cycle;
  const from = points[i];
  const to = points[i + 1];
  if (within < travelFrames) {
    return { from, to, t: travelFrames <= 0 ? 1 : clamp01(within / travelFrames) };
  }
  return { from: to, to, t: 1 };
}

/**
 * Текст плашки-субтитра для сцены: произнесённая фраза целиком.
 *
 * Источник — метки слов из timeline.json, тот же, что у пословных субтитров
 * Kinetic. Пунктуация в метках сохраняется (charsToWords режет только по
 * пробелам), поэтому склейка через пробел восстанавливает исходную фразу.
 * Берём именно captions, а не display: плашка обязана показывать то, что
 * звучит, а display — это то, что нарисовано на экране, и совпадать они не должны.
 */
export function sceneSpeech(scene) {
  if (!scene || !scene.captions || scene.captions.length === 0) return '';
  return scene.captions.map((c) => c.text).join(' ');
}

/**
 * Разбор двухкрасочного заголовка.
 *
 * Первая часть нейтральная, вторая — акцентная. Разделитель «|» в поле display
 * ролика: отдельное поле в схеме заводить не стали, потому что это по-прежнему
 * один заголовок, просто с точкой смены краски.
 * Без разделителя весь заголовок нейтральный — так шаблон не ломается на
 * ролике, где двухцветность не нужна.
 */
export function splitTitle(display) {
  const raw = typeof display === 'string' ? display : '';
  const at = raw.indexOf('|');
  if (at === -1) return { lead: raw.trim(), accent: '' };
  return { lead: raw.slice(0, at).trim(), accent: raw.slice(at + 1).trim() };
}

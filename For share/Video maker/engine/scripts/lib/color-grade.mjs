import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// Цветокоррекция снятого кадра: баланс белого по нейтральному объекту плюс
// растяжение диапазона яркости.
//
// Замер mvp-palatka 11.08.2026 показал, что главная проблема кадра не в цвете:
// света доходили до 113 из 255, то есть больше половины диапазона пустовало, а
// средняя яркость держалась на 55 при норме около 110. Картинка читалась как
// вялая и мутная. Тёплый увод (R−B = +18) на этом фоне второстепенен.
//
// Коэффициенты НЕ зашиты в код. Они считаются по кадрам конкретной съёмки:
// другой свет — другие числа, а зашитые превратили бы шаг в лотерею.

/** Сколько кадров опрашивать при поиске нейтрали. */
const PROBE_FRAMES = 5;

/**
 * Ищет в кадре объект, который должен быть серым.
 *
 * Метод тот же, что у оператора с серой картой, только карту заменяет объект,
 * уже попавший в кадр: стена, дверь, техника. Признак — малый разброс между
 * каналами при средней яркости. Небо, лампы и лица отсекаются порогом яркости:
 * пересвет и кожа нейтралью не бывают.
 */
export function findNeutralPatch(rgb, width, height, { grid = 6, rows = 10 } = {}) {
  const px = (x, y) => {
    const i = (y * width + x) * 3;
    return [rgb[i], rgb[i + 1], rgb[i + 2]];
  };

  const candidates = [];
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      const x0 = Math.floor((gx * width) / grid);
      const y0 = Math.floor((gy * height) / rows);
      const x1 = Math.floor(((gx + 1) * width) / grid);
      const y1 = Math.floor(((gy + 1) * height) / rows);

      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let y = y0; y < y1; y += 8) {
        for (let x = x0; x < x1; x += 8) {
          const [pr, pg, pb] = px(x, y);
          r += pr; g += pg; b += pb; n += 1;
        }
      }
      if (!n) continue;
      r /= n; g /= n; b /= n;

      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      // Слишком тёмное шумит, слишком светлое может быть пересветом — в обоих
      // случаях замер цвета недостоверен.
      if (lum < 60 || lum > 190) continue;

      candidates.push({ spread: Math.max(r, g, b) - Math.min(r, g, b), r, g, b, lum, gx, gy });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b2) => a.spread - b2.spread);
  return candidates[0];
}

/**
 * Коэффициенты, приводящие найденную нейтраль к серому.
 *
 * Ограничены диапазоном 0,8–1,25: если замер попал на цветной объект, поправка
 * получится дикой, и лучше отказаться от коррекции, чем перекрасить кадр.
 */
export function whiteBalanceGains({ r, g, b }) {
  const target = (r + g + b) / 3;
  const clamp = (v) => Math.max(0.8, Math.min(1.25, v));
  return {
    rr: +clamp(target / r).toFixed(4),
    gg: +clamp(target / g).toFixed(4),
    bb: +clamp(target / b).toFixed(4),
  };
}

/** Медиана списка. Ноль на пустом входе — вызывающий это учитывает. */
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Читает кадр видео как сырой RGB. */
function readFrame(file, atSec, width, height) {
  const tmp = path.join(path.dirname(file), `.grade-probe-${atSec}.rgb`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(atSec), '-i', file,
    '-frames:v', '1', '-vf', `scale=${width}:${height}`, '-pix_fmt', 'rgb24',
    '-f', 'rawvideo', tmp], { stdio: 'inherit' });
  const buf = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  return buf;
}

/** Средняя яркость и уровень светов (99-й процентиль) по кадру. */
export function frameLevels(rgb) {
  const lums = [];
  // Насыщенность и яркость кожи собираются списками, а не суммами: среднее по
  // маске тянут выбросы. Замер mvp-palatka: среднее дало 38,5 % при реальных
  // 21 % — в маску попадают тени на границах лица и волос, где насыщенность
  // зашкаливает. Медиана к таким выбросам устойчива.
  const skinSats = [];
  const skinLums = [];
  for (let i = 0; i < rgb.length; i += 3) {
    const r = rgb[i]; const g = rgb[i + 1]; const b = rgb[i + 2];
    lums.push(0.299 * r + 0.587 * g + 0.114 * b);
    // Маска кожи. Одного условия «красный выше зелёного выше синего» мало:
    // деревянная стена в кадре даёт ровно такое же соотношение, и замер
    // насыщенности «кожи» показывал 24 % вместо реальных 20 %, из-за чего шаг
    // подъёма насыщенности не срабатывал вовсе.
    //
    // Кожа отличается от дерева пропорциями: разрыв красного и зелёного у неё
    // умеренный (дерево уходит в жёлтый сильнее), и оттенок держится в узком
    // коридоре 5–30°.
    const rg = r - g;
    const gb = g - b;
    const isSkin = r > g && g > b && r > 70 && r < 220
      && rg > 10 && rg < 55 && gb > 3 && gb < 35 && rg > gb;
    if (isSkin) {
      const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
      skinSats.push(mx === 0 ? 0 : ((mx - mn) / mx) * 100);
      skinLums.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  lums.sort((a, b) => a - b);
  const mean = lums.reduce((s, v) => s + v, 0) / lums.length;
  return {
    mean,
    high: lums[Math.floor(lums.length * 0.99)],
    black: lums[Math.floor(lums.length * 0.01)],
    skinSat: median(skinSats),
    skinLum: median(skinLums),
  };
}

/**
 * Считает параметры коррекции по нескольким кадрам ролика.
 *
 * Несколько, а не один: в одном кадре нейтральный объект может быть закрыт
 * рукой или уехать из кадра, и замер соскочит на кожу или на дерево.
 */
export function analyseVideo(file, { durationSec, width = 270, height = 480 } = {}) {
  const probes = [];
  for (let i = 1; i <= PROBE_FRAMES; i += 1) {
    const at = (durationSec * i) / (PROBE_FRAMES + 1);
    const rgb = readFrame(file, +at.toFixed(2), width, height);
    const patch = findNeutralPatch(rgb, width, height);
    const levels = frameLevels(rgb);
    if (patch) probes.push({ at, patch, levels });
  }
  if (!probes.length) return null;

  // Берём медианный по разбросу замер, а не лучший: самый «нейтральный» кадр
  // может оказаться случайным попаданием на однотонное пятно.
  probes.sort((a, b) => a.patch.spread - b.patch.spread);
  const chosen = probes[Math.floor(probes.length / 2)];
  const gains = whiteBalanceGains(chosen.patch);

  const avg = (f) => probes.reduce((s, p) => s + f(p.levels), 0) / probes.length;
  return {
    gains,
    patch: chosen.patch,
    meanHigh: avg((l) => l.high),
    meanLum: avg((l) => l.mean),
    blackPoint: avg((l) => l.black),
    skinSat: avg((l) => l.skinSat),
    skinLum: avg((l) => l.skinLum),
    probes: probes.length,
  };
}

/**
 * Собирает фильтр ffmpeg.
 *
 * Порядок и состав — результат разбора 11.08.2026, где первая версия коррекции
 * получила от меня же 5 из 10. Что было не так и чем лечится:
 *
 *   · Чёрной точки не было: самое тёмное в кадре — 14, картинка стояла на сером
 *     фундаменте и выглядела подёрнутой дымкой. Кривая теперь начинается не с
 *     нуля, а с реальной чёрной точки кадра.
 *   · Кривая была не S-образной: подъём одной середины делает светлее, но не
 *     добавляет объёма. Теперь три контрольные точки — тени, середина, света.
 *   · Субъект не отделялся от фона: разница яркостей кожи и стены была +4 при
 *     норме 25–40, взгляд не цеплялся за говорящего. Виньетка гасит края, где
 *     фон, и не трогает центр, где лицо: отделение стало +40.
 *   · Кожа была недонасыщена (18 % при норме 25–45) и уводила в красное (14° при
 *     эталонной линии кожи 20–35°). Подъём общей насыщенности вытянул её до
 *     26 % и 22°.
 *
 * Чего этот фильтр НЕ чинит: неравномерность освещения лица. Разброс между лбом
 * и левой щекой — 40 единиц, свет бьёт сверху-справа. Это правится на съёмке
 * (заполняющий свет слева), а не цветокоррекцией: любая программная попытка
 * требует маски лица и выдаёт себя ореолом.
 */
export function buildGradeFilter({ gains, blackPoint = 11, skinLum = 80 }) {
  const parts = [];

  const balanced = Math.abs(gains.rr - 1) > 0.01 || Math.abs(gains.bb - 1) > 0.01;
  if (balanced) {
    parts.push(`colorchannelmixer=rr=${gains.rr}:gg=${gains.gg}:bb=${gains.bb}`);
  }

  // Чёрная точка берётся из кадра: где реально начинается изображение, туда и
  // ставится ноль. Зашитое значение на другой съёмке либо не дотянет, либо
  // срежет детали в тенях.
  const black = Math.max(0, Math.min(0.12, blackPoint / 255));

  // Экспозиция ставится ПО КОЖЕ, а не по гистограмме кадра. Первая автоматика
  // целилась по светам (180 из 255) и выгнала кожу на 148 при норме 100–140 —
  // лицо стало блёклым и пересвеченным. Колорист выставляет экспозицию по лицу,
  // потому что зритель смотрит на него, а не на гистограмму. Цель — 110.
  const lift = Math.max(0, Math.min(0.22, (110 - skinLum) / 255));
  const mid = (0.42 + lift).toFixed(3);
  const high = (0.80 + lift * 0.4).toFixed(3);
  parts.push(`curves=all='${black.toFixed(3)}/0 0.3/${mid} 0.6/${high} 1/1'`);

  // Виньетки здесь нет, и это решение автора от 11.08.2026 после просмотра
  // четырёх вариантов силы.
  //
  // Она решала измеримую задачу: отделение лица от фона было +4 при норме
  // 25–40, и виньетка поднимала его до +49. Но это видимый приём, а не
  // техническая правка, и на кадре он читался как эффект. Я выбрал самый
  // сильный вариант, потому что он давал лучшую цифру, — оптимизировал метрику
  // вместо картинки.
  //
  // Отделение остаётся нерешённым и решается на съёмке: отодвинуться от стены
  // или добавить свет на говорящего. Программно без маски по лицу его честно не
  // сделать.

  // Насыщенность — константа, и это осознанный отказ от автоматики.
  //
  // Попытка вычислять её по коже провалилась: чтобы найти кожу без детекции
  // лица, маска строится по соотношению каналов, а под неё подходит и
  // деревянная стена. Замеры давали 38,5 % «кожи» при реальных 21 %, и ни
  // сужение маски, ни переход на медиану это не исправили. Подбирать маску
  // дальше вслепую дороже, чем взять проверенное значение.
  //
  // 1.15 замерено на mvp-palatka: кожа выходит на 26 % насыщенности и 22° по
  // оттенку — обе величины в норме (25–45 % и 20–35°). Выше 1.25 лицо начинает
  // выглядеть пластиковым.
  parts.push('eq=saturation=1.15');

  return parts.join(',');
}

/** Длительность файла в секундах. */
export function probeDurationSec(file) {
  const res = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8' });
  const v = parseFloat((res.stdout || '').trim());
  return Number.isFinite(v) ? v : 0;
}

import { spawnSync } from 'node:child_process';

// Измерение спектрального баланса речи и сравнение «до/после».
//
// Существует ради одной ловушки, найденной при выборе денойзера 11.08.2026:
// у ffmpeg-фильтра afftdn отношение сигнал/шум выросло на 11 дБ — цифра
// отличная — но при этом полосы 3–16 кГц просели на 3,4–3,9 дБ. Это «воздух»
// голоса; без него запись звучит глухо и по-телефонному. То есть по главной
// метрике обработка выглядела успешной, а голос она портила.
//
// Мораль та же, что в уроке L007: одна метрика, по которой оптимизируешь,
// умеет расти, пока результат ухудшается. Поэтому денойз принимается по двум
// числам сразу — сколько шума ушло И сколько речи осталось.

/** Полосы для оценки тембра. Верхние три — то, что денойзеры съедают первыми. */
export const BANDS = [
  [80, 300],
  [300, 1000],
  [1000, 3000],
  [3000, 6000],
  [6000, 10000],
  [10000, 16000],
];

/** Верх голоса: именно здесь живёт разборчивость согласных и «воздух». */
export const AIR_BANDS = [
  [3000, 6000],
  [6000, 10000],
  [10000, 16000],
];

/**
 * Полосы, по которым судят, не съедена ли речь.
 *
 * Низ 80–300 Гц намеренно исключён, и это не послабление. Там живут не только
 * основной тон голоса, но и весь низкочастотный мусор записи: гул вентиляции,
 * дыхание, удары по столу, попы на взрывных согласных. Денойзер обязан их
 * убирать, а проверка по этой полосе считала уборку порчей.
 *
 * Замер mvp-palatka 11.08.2026: на 25,5–25,8 с в записи два удара с пиком
 * 32047 (у самого клиппинга), апериодичных — не голос. Денойз их снял, полоса
 * 80–300 просела на 5,8 дБ, и прежняя проверка отвергала всю чистку из-за
 * этого. Разборчивость речи держится на формантах F1–F3, то есть от 300 Гц.
 */
export const INTELLIGIBILITY_BANDS = BANDS.filter(([lo]) => lo >= 300);

/**
 * RMS в полосе на заданном отрезке файла, дБ.
 * Возвращает null, если ffmpeg не отдал значения.
 */
export function bandRms(file, lowHz, highHz, { startSec = 0, durationSec = 3 } = {}) {
  const res = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-ss', String(startSec), '-t', String(durationSec), '-i', file,
      '-af', `highpass=f=${lowHz},lowpass=f=${highHz},astats=metadata=1,` +
             'ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
      '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const values = [...(res.stdout || '').matchAll(/RMS_level=(-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
  return values.length ? values[values.length - 1] : null;
}

/** Профиль по всем полосам. */
export function spectrumProfile(file, opts = {}) {
  return BANDS.map(([lo, hi]) => ({ lowHz: lo, highHz: hi, db: bandRms(file, lo, hi, opts) }));
}

/**
 * Сравнивает тембр по ВСЕМУ файлу, окнами.
 *
 * Одна проверка на одном участке обманывает. Замер mvp-palatka 11.08.2026:
 * на 5–8 секунде отклонение 1,4 дБ (чисто), на 12,4–13,6 — низ просел на
 * 6,5 дБ. Денойзер портит речь местами, и средний спектр по случайному куску
 * этого не видит.
 *
 * @returns {{ok:boolean, worstDropDb:number, atSec:number|null, windows:Array, reason:string|null}}
 */
export function compareSpectrumOverFile(beforeFile, afterFile, {
  durationSec,
  windowSec = 1.5,
  maxDropDb = 3,
} = {}) {
  const windows = [];
  let worst = { dropDb: 0, atSec: null, band: null };

  for (let t = 0; t + windowSec <= durationSec; t += windowSec) {
    for (const [lo, hi] of INTELLIGIBILITY_BANDS) {
      const b = bandRms(beforeFile, lo, hi, { startSec: t, durationSec: windowSec });
      const a = bandRms(afterFile, lo, hi, { startSec: t, durationSec: windowSec });
      if (b === null || a === null) continue;
      // Тихие окна пропускаем: в паузе денойзер обязан убирать почти всё, и
      // считать это порчей тембра нельзя.
      if (b < -55) continue;
      const drop = a - b;
      if (drop < worst.dropDb) worst = { dropDb: drop, atSec: +t.toFixed(2), band: `${lo}-${hi}` };
      windows.push({ atSec: +t.toFixed(2), band: `${lo}-${hi}`, deltaDb: +drop.toFixed(2) });
    }
  }

  const ok = worst.dropDb >= -maxDropDb;
  return {
    ok,
    worstDropDb: +worst.dropDb.toFixed(2),
    atSec: worst.atSec,
    band: worst.band,
    windows,
    reason: ok
      ? null
      : `на ${worst.atSec} с в полосе ${worst.band} Гц сигнал просел на ` +
        `${Math.abs(worst.dropDb).toFixed(1)} дБ при допуске ${maxDropDb} — обработка съедает речь`,
  };
}

/**
 * Сравнивает тембр до и после обработки на одном отрезке.
 *
 * Оставлена для точечных замеров. Для приёмки обработки использовать
 * compareSpectrumOverFile: одиночный отрезок уже пропускал дефект.
 *
 * @returns {{ok: boolean, worstDropDb: number, bands: Array, reason: string|null}}
 *   ok=false, если хоть одна полоса верха просела глубже maxDropDb.
 */
export function compareSpectrum(beforeFile, afterFile, { maxDropDb = 1, ...opts } = {}) {
  const bands = BANDS.map(([lo, hi]) => {
    const before = bandRms(beforeFile, lo, hi, opts);
    const after = bandRms(afterFile, lo, hi, opts);
    const delta = before !== null && after !== null ? +(after - before).toFixed(2) : null;
    const isAir = AIR_BANDS.some(([a, b]) => a === lo && b === hi);
    return { lowHz: lo, highHz: hi, beforeDb: before, afterDb: after, deltaDb: delta, isAir };
  });

  const airDrops = bands.filter((b) => b.isAir && b.deltaDb !== null).map((b) => b.deltaDb);
  // Самое глубокое падение среди верхних полос. Ноль, если верх не измерился —
  // тогда проверка не срабатывает, но и молчать об этом нельзя (см. reason).
  const worstDropDb = airDrops.length ? Math.min(...airDrops) : 0;

  if (!airDrops.length) {
    return { ok: true, worstDropDb: 0, bands, reason: 'верхние полосы не измерились — тембр не проверен' };
  }

  const ok = worstDropDb >= -maxDropDb;
  return {
    ok,
    worstDropDb,
    bands,
    reason: ok
      ? null
      : `верх голоса просел на ${Math.abs(worstDropDb).toFixed(1)} дБ при допуске ${maxDropDb} дБ — ` +
        `обработка съедает «воздух», голос станет глухим`,
  };
}

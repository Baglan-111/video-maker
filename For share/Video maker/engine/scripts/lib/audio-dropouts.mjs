import fs from 'node:fs';

// Поиск провалов, которые денойзер оставляет в речи.
//
// Найдено на mvp-palatka 11.08.2026. В исходной записи на слове «палатка» есть
// поп — взрывное «п» ударило в микрофон: апериодичный низкочастотный всплеск
// громче окружающей речи. DeepFilterNet опознал его как шум и вырезал, но забрал
// вместе с ним соседний звук: на 12,67–12,74 с осталось 19 % сигнала. Восемьдесят
// миллисекунд дырки посреди слова, и это слышно.
//
// Почему прежняя проверка тембра (audio-spectrum.mjs) это пропустила: она мерит
// ОДИН участок, 5–8 секунду. Там отклонение 1,4 дБ, всё чисто. Дефект был на
// 12-й секунде. Средний спектр по куску файла ничего не знает о том, что
// происходит в другом куске — тот же класс ошибки, что в уроке L007: выборка
// вместо полного прохода.
//
// Здесь проходится ВЕСЬ файл окнами по 10 мс и сравнивается пик до и после.

/** Читает моно-WAV PCM 16 бит. Формат наш собственный (его пишет ffmpeg), поэтому парсер минимальный. */
export function readWavMono(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${file}: не похоже на WAV`);
  }

  let pos = 12;
  let sampleRate = 0;
  let channels = 1;
  let bits = 16;
  let data = null;

  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      data = buf.subarray(body, body + size);
    }
    pos = body + size + (size % 2);
  }

  if (!data || !sampleRate) throw new Error(`${file}: не нашёл fmt или data`);
  if (bits !== 16) throw new Error(`${file}: ожидается 16 бит, а не ${bits}`);

  // Многоканальный вход сводим в моно средним: для поиска провалов достаточно.
  const total = Math.floor(data.length / 2 / channels);
  const out = new Int16Array(total);
  for (let i = 0; i < total; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += data.readInt16LE((i * channels + c) * 2);
    out[i] = Math.round(sum / channels);
  }
  return { samples: out, sampleRate };
}

/** Пик по модулю на отрезке. */
const peak = (samples, from, to) => {
  let max = 0;
  for (let i = from; i < to && i < samples.length; i += 1) {
    const v = samples[i] < 0 ? -samples[i] : samples[i];
    if (v > max) max = v;
  }
  return max;
};

/**
 * Окна, где обработка съела слишком много сигнала.
 *
 * @param {Int16Array} before
 * @param {Int16Array} after
 * @param {object} opts
 * @param {number} opts.sampleRate
 * @param {number} opts.windowMs   размер окна, мс
 * @param {number} opts.keepRatio  сколько сигнала обязано остаться (0.35 = 35 %)
 * @param {number} opts.floor      окна тише этого пика не считаются речью
 * @returns окна, слитые в непрерывные участки
 */
export function findDropouts(before, after, {
  sampleRate,
  windowMs = 10,
  keepRatio = 0.35,
  floor = 2000,
} = {}) {
  const win = Math.round((windowMs / 1000) * sampleRate);
  const hits = [];

  for (let i = 0; i + win <= before.length && i + win <= after.length; i += win) {
    const b = peak(before, i, i + win);
    // Тихие окна пропускаем: убрать 90 % от шороха — это работа денойзера, а не
    // дефект. Порог отсекает паузы и фон, оставляя только громкую речь.
    if (b < floor) continue;
    const a = peak(after, i, i + win);
    if (a < b * keepRatio) {
      hits.push({ atSec: i / sampleRate, beforePeak: b, afterPeak: a, kept: a / b });
    }
  }

  // Соседние окна одного события склеиваем: поп длиной 80 мс иначе выглядит как
  // восемь отдельных находок.
  const merged = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && h.atSec - (last.fromSec + last.durSec) <= windowMs / 1000 + 1e-6) {
      last.durSec = +(h.atSec + windowMs / 1000 - last.fromSec).toFixed(3);
      last.worstKept = Math.min(last.worstKept, h.kept);
      last.beforePeak = Math.max(last.beforePeak, h.beforePeak);
    } else {
      merged.push({
        fromSec: +h.atSec.toFixed(3),
        durSec: windowMs / 1000,
        worstKept: h.kept,
        beforePeak: h.beforePeak,
      });
    }
  }

  return merged.map((m) => ({ ...m, worstKept: +m.worstKept.toFixed(3) }));
}

/** Пишет моно-WAV PCM 16 бит. */
export function writeWavMono(file, samples, sampleRate) {
  const bytes = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + bytes.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);          // PCM
  header.writeUInt16LE(1, 22);          // моно
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(bytes.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, bytes]));
}

/**
 * Смешивает две дорожки в окнах провалов с косинусным кроссфейдом.
 *
 * Считается посемплово, а НЕ фильтром громкости ffmpeg. Первая версия ремонта
 * использовала `volume=enable='between(...)'`, и это оказалось мгновенным
 * переключением 0↔1 на каждой границе окна: замер готового файла показал 2365
 * щелчков со скачком до 29162 при полной шкале 32767, тогда как в исходнике и
 * в почищенной дорожке щелчков не было ни одного. Фильтр громкости не умеет
 * плавных краёв сам, а `afade` вешается на дорожку целиком, а не на каждое
 * окно.
 *
 * Косинус вместо линейного фейда: у него нулевая производная на концах, то есть
 * стык получается гладким и по амплитуде, и по её скорости.
 */
export function mixInWindows(base, patch, windows, { sampleRate, fadeMs = 30, padMs = 60 }) {
  const out = Int16Array.from(base);
  const fade = Math.round((fadeMs / 1000) * sampleRate);
  const pad = Math.round((padMs / 1000) * sampleRate);

  for (const w of windows) {
    const from = Math.max(0, Math.round(w.fromSec * sampleRate) - pad);
    const to = Math.min(out.length, patch.length, Math.round((w.fromSec + w.durSec) * sampleRate) + pad);
    for (let i = from; i < to; i += 1) {
      const dl = i - from;
      const dr = to - i;
      let k = 1;
      if (dl < fade) k = 0.5 - 0.5 * Math.cos((Math.PI * dl) / fade);
      else if (dr < fade) k = 0.5 - 0.5 * Math.cos((Math.PI * dr) / fade);
      out[i] = Math.round(base[i] * (1 - k) + patch[i] * k);
    }
  }
  return out;
}

/**
 * Ищет резкие удары: попы на взрывных согласных, стуки, щелчки по микрофону.
 *
 * Отличается от findDropouts принципиально. Тот ищет, что ИСПОРТИЛА обработка,
 * сравнивая две дорожки. Этот ищет дефект в самой записи, по одной дорожке —
 * потому что денойзер такой удар может и не тронуть, а слышно его всё равно
 * (замер mvp-palatka 11.08.2026: на 2,72 с пик 27531 при уровне речи 2500–8800,
 * денойз сохранил его на 86–93 %).
 *
 * Два признака вместе, поодиночке каждый ошибается:
 *   1. Пик заметно выше локального фона речи — просто громкий слог тоже бывает.
 *   2. Сигнал апериодичен: голосовые связки дают повторяющуюся волну, удар нет.
 * Ударный слог проходит по первому признаку и отсекается вторым.
 */
export function findTransients(samples, {
  sampleRate,
  windowMs = 30,
  contextSec = 1.5,
  peakRatio = 2.5,
  hardRatio = 5,
  maxPeriodicity = 0.32,
  floor = 6000,
} = {}) {
  const win = Math.round((windowMs / 1000) * sampleRate);
  const ctx = Math.round(contextSec * sampleRate);
  const hits = [];

  for (let i = 0; i + win <= samples.length; i += win) {
    const p = peak(samples, i, i + win);
    if (p < floor) continue;

    // Фон считается по окрестности, а не по всему файлу: громкость речи плавает,
    // и единый порог на 38 секунд ловил бы то всё подряд, то ничего.
    const from = Math.max(0, i - ctx);
    const to = Math.min(samples.length, i + ctx);
    const local = medianWindowPeak(samples, from, to, win);
    if (p < local * peakRatio) continue;

    // Разделение по условию: очень громкий выброс — удар без дополнительных
    // вопросов. Речь не выпрыгивает над своим же локальным уровнем в пять раз;
    // проверять её периодичность здесь незачем, а проверка как раз и промахивалась
    // (удар на 2,76 с с превышением 7,9× показывал периодичность 0,42 — окно
    // автокорреляции захватывало соседнюю речь и признавало удар голосом).
    if (p >= local * hardRatio) {
      hits.push({ atSec: i / sampleRate, peak: p, localPeak: local, ratio: +(p / local).toFixed(2) });
      continue;
    }

    // Периодичность считается на окне шире окна детекции. На 30 мс при частоте
    // голоса 70–350 Гц укладывается всего три периода, и автокорреляция даёт
    // ложно высокие значения: удар на 2,76 с показывал 0,42 вместо 0,27, то есть
    // выглядел как речь и проходил мимо детектора.
    const half = Math.round((0.04 * sampleRate));
    const pFrom = Math.max(0, i + win / 2 - half);
    const pTo = Math.min(samples.length, i + win / 2 + half);
    if (periodicity(samples, Math.round(pFrom), Math.round(pTo), sampleRate) > maxPeriodicity) continue;

    hits.push({ atSec: i / sampleRate, peak: p, localPeak: local, ratio: +(p / local).toFixed(2) });
  }

  // Соседние окна — один удар.
  const merged = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && h.atSec - (last.fromSec + last.durSec) <= windowMs / 1000 + 1e-6) {
      last.durSec = +(h.atSec + windowMs / 1000 - last.fromSec).toFixed(3);
      last.peak = Math.max(last.peak, h.peak);
      last.ratio = Math.max(last.ratio, h.ratio);
    } else {
      merged.push({ fromSec: +h.atSec.toFixed(3), durSec: windowMs / 1000, peak: h.peak, ratio: h.ratio });
    }
  }
  return merged;
}

/** Медианный пик по окнам на отрезке — устойчивая оценка «обычной» громкости речи. */
function medianWindowPeak(samples, from, to, win) {
  const peaks = [];
  for (let i = from; i + win <= to; i += win) {
    const p = peak(samples, i, i + win);
    if (p > 0) peaks.push(p);
  }
  if (!peaks.length) return 0;
  peaks.sort((a, b) => a - b);
  return peaks[Math.floor(peaks.length / 2)];
}

/** Нормированная автокорреляция в диапазоне голоса 70–350 Гц. Речь периодична, удар нет. */
function periodicity(samples, from, to, sampleRate) {
  const n = to - from;
  if (n < 64) return 0;
  let mean = 0;
  for (let i = from; i < to; i += 1) mean += samples[i];
  mean /= n;

  let energy = 0;
  for (let i = from; i < to; i += 1) energy += (samples[i] - mean) ** 2;
  if (energy === 0) return 0;

  let best = 0;
  const minLag = Math.floor(sampleRate / 350);
  const maxLag = Math.floor(sampleRate / 70);
  for (let lag = minLag; lag < maxLag && lag < n; lag += 1) {
    let sum = 0;
    // Шаг 3 вместо 1: вчетверо быстрее, на оценку периодичности не влияет.
    for (let i = from; i + lag < to; i += 3) sum += (samples[i] - mean) * (samples[i + lag] - mean);
    const norm = sum / (energy / 3);
    if (norm > best) best = norm;
  }
  return best;
}

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { compareSpectrumOverFile } from './audio-spectrum.mjs';
import { readWavMono, writeWavMono, findDropouts, findTransients, mixInWindows } from './audio-dropouts.mjs';

// Чистка голоса от шума — DeepFilterNet3.
//
// Выбран прогоном на реальной дорожке 11.08.2026, а не по описаниям. Сравнивались
// четыре варианта на записи автора (SNR исходника 31 дБ):
//
//   вариант            SNR      верх 3–16 кГц   речь (ASR)
//   ffmpeg afftdn      +11,3    −3,4…−3,9 дБ    97,4 %
//   ffmpeg arnndn      +5,7     −0,2…−0,5 дБ    100 %
//   DeepFilterNet3     +16,0    −0,2…−0,4 дБ    98,4 %
//
// afftdn отпал именно из-за третьей колонки: он даёт приличный SNR, срезая при
// этом «воздух» голоса на 4 дБ — запись становится глухой. DFN3 снимает втрое
// больше шума, чем RNNoise, и тембр не трогает. Работает на CPU Apple Silicon,
// 38-секундный ролик обрабатывается за 0,7 с.
//
// Почему шаг необязателен. На записи с SNR за 30 дБ разница слышна только в
// паузах между словами; обработка при этом необратима, а зависимость тяжёлая
// (torch). Ролик обязан собираться и без неё.

/** Где искать бинарь: переменная окружения, потом PATH. */
export function findDeepFilter() {
  const fromEnv = process.env.DEEPFILTER_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const which = spawnSync('which', ['deepFilter'], { encoding: 'utf8' });
  return which.status === 0 ? which.stdout.trim() : null;
}

export const INSTALL_HINT =
  'Установка: python3 -m venv ~/.venvs/audio && ~/.venvs/audio/bin/pip install deepfilternet soundfile, ' +
  'затем DEEPFILTER_BIN=~/.venvs/audio/bin/deepFilter. Брать системный python3: ' +
  'у brew-питона 3.14 сломан pyexpat, и установка падает.';

/** Длительность файла в секундах по ffprobe. */
function probeDurationSec(file) {
  const res = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8' });
  const v = parseFloat((res.stdout || '').trim());
  return Number.isFinite(v) ? v : 0;
}

/**
 * Заменяет провалы в почищенной дорожке оригиналом со срезанным низом.
 *
 * Срез низа двумя каскадами по 180 Гц гасит поп, оставляя форманты речи. Сам
 * микс считается посемплово (mixInWindows) — фильтр громкости ffmpeg давал
 * мгновенные переключения и 2365 щелчков в готовом файле.
 */
function repairDropouts(rawWav, cleanWav, outWav, dropouts, workDir) {
  const hpWav = path.join(workDir, '.denoise-hp.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', rawWav,
    '-af', 'highpass=f=180:poles=2,highpass=f=180:poles=2', hpWav], { stdio: 'inherit' });

  const base = readWavMono(cleanWav);
  const patch = readWavMono(hpWav);
  const mixed = mixInWindows(base.samples, patch.samples, dropouts, { sampleRate: base.sampleRate });
  writeWavMono(outWav, mixed, base.sampleRate);
  fs.rmSync(hpWav, { force: true });
}

/**
 * Чистит звуковую дорожку видеофайла на месте.
 *
 * Порядок намеренно такой: сначала считаем результат, потом сверяем тембр, и
 * только если сверка прошла — подменяем файл. Обработка необратима, поэтому
 * плохой результат не должен доезжать до диска.
 *
 * @returns {{applied: boolean, reason?: string, report?: object}}
 */
export function denoiseVideoAudio(videoFile, { workDir, maxDropDb = 1 } = {}) {
  const bin = findDeepFilter();
  if (!bin) {
    return { applied: false, reason: `не найден deepFilter. ${INSTALL_HINT}` };
  }

  fs.mkdirSync(workDir, { recursive: true });
  const rawWav = path.join(workDir, '.denoise-raw.wav');
  const outDir = path.join(workDir, '.denoise-out');
  const tmpVideo = path.join(workDir, '.denoise-tmp.mp4');

  const cleanup = () => {
    fs.rmSync(rawWav, { force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.rmSync(tmpVideo, { force: true });
  };

  try {
    // DeepFilterNet принимает только 48 кГц wav — это его требование, не наше.
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', videoFile,
      '-vn', '-ac', '1', '-ar', '48000', rawWav], { stdio: 'inherit' });

    fs.mkdirSync(outDir, { recursive: true });
    execFileSync(bin, [rawWav, '-o', outDir], { stdio: 'inherit' });

    const produced = fs.readdirSync(outDir).filter((f) => f.endsWith('.wav'));
    if (!produced.length) {
      cleanup();
      return { applied: false, reason: 'deepFilter отработал, но не создал файл' };
    }
    const cleanWav = path.join(outDir, produced[0]);

    // ── Ремонт и приёмка ДО записи на диск ───────────────────────────────────
    //
    // Порядок важен: сначала чиним известный дефект, потом судим результат.
    // Обратный порядок отвергал чистку целиком из-за провалов, которые мы умеем
    // лечить, — и ролик оставался с сырым звуком.

    // 1. Провалы: окна, где от громкой речи осталась пятая часть. Это не «стало
    //    тише», а дырка в звуке. Денойзер принимает за шум резкий звук — поп на
    //    взрывном согласном — и вырезает его вместе с соседним сигналом.
    //    Замер mvp-palatka 11.08.2026: 22 таких окна, худшее оставило 1 %.
    const before = readWavMono(rawWav);
    const after = readWavMono(cleanWav);
    const dropouts = findDropouts(before.samples, after.samples, { sampleRate: before.sampleRate });

    let repaired = false;
    if (dropouts.length) {
      // В окне провала берётся оригинал со срезанным низом: поп живёт ниже
      // 500 Гц (замер: превышает речь на 12–15 дБ в полосах до 250 Гц), а
      // разборчивость держится на формантах выше.
      const repairedWav = path.join(workDir, '.denoise-repaired.wav');
      repairDropouts(rawWav, cleanWav, repairedWav, dropouts, workDir);
      if (fs.existsSync(repairedWav)) {
        fs.rmSync(cleanWav, { force: true });
        fs.renameSync(repairedWav, cleanWav);
        repaired = true;
      }
    }

    // 2. Тембр — по ВСЕМУ файлу окнами, после ремонта провалов. Прежняя версия
    //    мерила один отрезок (5–8 с) и пропустила просадку низа на 6,5 дБ на
    //    12-й секунде: денойзер портит речь местами, средний спектр по
    //    случайному куску этого не видит.
    const durationSec = probeDurationSec(rawWav);
    const spectrum = compareSpectrumOverFile(rawWav, cleanWav, { durationSec, maxDropDb: 3 });
    if (!spectrum.ok) {
      cleanup();
      return { applied: false, reason: spectrum.reason, report: spectrum, dropouts };
    }

    // 3. Удары — ПОСЛЕ проверки тембра, и это важно. Гашение ударов намеренно
    //    снижает уровень в своих окнах, и проверка, поставленная после него,
    //    считала это порчей речи (падала на 12 с с просадкой 8,8 дБ). Тембр
    //    судит работу денойзера, а не нашу собственную правку.
    //
    //    Попы на взрывных согласных и стуки, которые денойзер НЕ трогает,
    //    а слышно их всё равно. Замер mvp-palatka: на 2,76 с пик 23656 при
    //    локальном уровне речи 3000 — в восемь раз громче.
    //
    //    Гасятся компрессией, но компрессия всей дорожки сжимает и речь. Решение
    //    по ТРИЗ, разделение во времени: удар занимает 30 мс из 38 секунд, значит
    //    и обработка не обязана быть постоянной. Сжатая копия подмешивается
    //    ТОЛЬКО в окна ударов (13,8 % дорожки), речь между ними остаётся
    //    нетронутой до сэмпла.
    const transients = findTransients(readWavMono(cleanWav).samples, { sampleRate: before.sampleRate });
    let tamed = 0;
    if (transients.length) {
      const compWav = path.join(workDir, '.denoise-comp.wav');
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', cleanWav,
        '-af', 'acompressor=threshold=0.05:ratio=6:attack=1:release=60:makeup=1',
        '-c:a', 'pcm_s16le', compWav], { stdio: 'inherit' });

      const base = readWavMono(cleanWav);
      const comp = readWavMono(compWav);
      const mixed = mixInWindows(base.samples, comp.samples, transients,
        { sampleRate: base.sampleRate, fadeMs: 25, padMs: 40 });
      writeWavMono(cleanWav, mixed, base.sampleRate);
      fs.rmSync(compWav, { force: true });
      tamed = transients.length;
    }

    // Видеопоток копируется без перекодирования: чистка звука не должна стоить
    // ещё одного поколения сжатия картинки.
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', videoFile, '-i', cleanWav,
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', tmpVideo], { stdio: 'inherit' });

    // Подмена одним движением: на обрыве останется либо старый целый файл, либо
    // новый целый — но не половина.
    fs.renameSync(tmpVideo, videoFile);
    cleanup();
    return { applied: true, report: spectrum, dropouts, repaired, tamed };
  } catch (err) {
    cleanup();
    return { applied: false, reason: err.message.split('\n')[0] };
  }
}

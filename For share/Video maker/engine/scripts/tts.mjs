import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadKey, mask } from './lib/env.mjs';
import { validateSay } from './lib/validate.mjs';
import { charsToWords } from './lib/words.mjs';
import { buildTimeline } from './lib/timeline.mjs';
import { parseVideoJson } from '../src/lib/video-schema.mjs';
import { assertMusicAllowed } from './lib/music.mjs';
import { probeDurationMs, probeAudioCodec, assertDurationMatchesCaptions } from './lib/audio.mjs';
import { fetchWithRetry } from './lib/fetch-retry.mjs';
import { fileURLToPath } from 'node:url';

const FPS = 30;
const MODEL = 'eleven_multilingual_v2';
// Порядок предпочтения форматов. Дизайн (5.2) требует pcm_44100, но ElevenLabs
// отдаёт его только с тарифа Pro; на Free приходит 403 output_format_not_allowed.
// Поэтому список: сначала желаемый pcm, дальше — CBR-mp3 128 кбит/с, который на
// Free доступен. В wav всё равно конвертируется честным декодированием, а
// расхождение длительности с метками ловит страж (см. verifyWav).
const OUTPUT_FORMATS = ['pcm_44100', 'mp3_44100_128'];
const slug = process.argv[2];
if (!slug) { console.error('Использование: node scripts/tts.mjs <slug>'); process.exit(1); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const engine = path.join(root, 'engine');
const proj = path.join(root, 'projects', slug);
const audioDir = path.join(proj, 'audio');

// 0. Схема video.json — до всего остального (дефект I8)
let video;
try {
  video = parseVideoJson(JSON.parse(fs.readFileSync(path.join(proj, 'video.json'), 'utf8')), {
    file: `projects/${slug}/video.json`,
  });
} catch (err) {
  console.error(`ОШИБКА: ${err.message}`);
  process.exit(1);
}
fs.mkdirSync(audioDir, { recursive: true });

// 1. Preflight — до единого обращения к API
const problems = [];
video.scenes.forEach((s, i) => {
  const r = validateSay(s.say ?? '');
  r.errors.forEach(e => problems.push(`сцена ${i}: [${e.code}] ${e.message}`));
  r.warnings.forEach(w => console.warn(`⚠️  сцена ${i}: ${w.message}`));
});
if (video.music) {
  // Реестр лицензий проверяем здесь же: незачем платить за озвучку ролика,
  // который потом не соберётся из-за неучтённого трека (дефект I6).
  try { assertMusicAllowed(engine, video.music); }
  catch (err) { problems.push(err.message); }
}
if (problems.length) {
  console.error('Синтез остановлен до траты кредитов:\n' + problems.join('\n'));
  process.exit(1);
}

// 2. Оценка стоимости
const chars = video.scenes.reduce((n, s) => n + (s.say ?? '').length, 0);
console.log(`К синтезу: ${video.scenes.length} сцен, ${chars} знаков (~$${(chars / 1000 * 0.10).toFixed(2)})`);

const key = loadKey();
console.log(`Ключ ElevenLabs: ${mask(key)}`); // диагностика — ключ в открытом виде не печатаем
const timelineScenes = [];

// Как разбирать то, что вернул API, зависит от формата: pcm — сырые сэмплы без
// заголовка (ffmpeg нужно объяснить частоту и разрядность), mp3 — контейнер,
// который ffmpeg разбирает сам. Ошибка в этой паре и есть дефект C1: mp3-байты,
// прочитанные как s16le, дают шум.
const formatSpec = (format) => {
  const [kind, rate] = format.split('_');
  if (kind === 'pcm') return { ext: 'pcm', raw: true, input: ['-f', 's16le', '-ar', rate, '-ac', '1'] };
  if (kind === 'mp3') return { ext: 'mp3', raw: false, input: [] };
  throw new Error(`Неизвестный output_format: ${format}`);
};

const toWav = (srcFile, wav, format) => {
  const { input } = formatSpec(format);
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error', ...input,
                          '-i', srcFile, '-ar','44100','-ac','1','-c:a','pcm_s16le','-y', wav]);
  fs.unlinkSync(srcFile); // удаляем сырьё только после успешной конвертации
};

// Страж C1: wav, собранный из «PCM», обязан совпадать по длительности с метками.
// Если ElevenLabs снова отдаст mp3 вместо pcm (например, при смене API), это
// вскроется здесь, а не в готовом ролике с шумом вместо речи.
const verifyWav = (wav, caps, label, say) => {
  const codec = probeAudioCodec(wav);
  if (codec !== 'pcm_s16le') {
    fs.unlinkSync(wav);
    throw new Error(`${label}: в ${wav} кодек ${codec}, ожидался pcm_s16le. Файл удалён.`);
  }
  const actualMs = probeDurationMs(wav);
  const captionsEndMs = caps.length ? Math.max(...caps.map(c => c.endMs)) : 0;
  try {
    assertDurationMatchesCaptions({ file: wav, actualMs, captionsEndMs, sceneLabel: label, say });
  } catch (err) {
    fs.unlinkSync(wav);
    throw err;
  }
  return actualMs;
};

// Формат согласуется с тарифом: pcm_44100 доступен только с Pro и выше, на Free
// API отвечает 403 output_format_not_allowed. Отказ по формату кредитов не стоит,
// поэтому пробуем по порядку и запоминаем первый принятый.
let negotiatedFormat = null;

const synthesize = async (text) => {
  const candidates = negotiatedFormat ? [negotiatedFormat] : OUTPUT_FORMATS;
  let lastRefusal = null;
  for (const format of candidates) {
    // output_format — ТОЛЬКО query-параметр (дефект C1). В теле JSON ElevenLabs
    // его молча игнорирует и отдаёт mp3_44100_128; эти байты, записанные как
    // сырой PCM, дают шум вместо речи.
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${video.voiceId}`
      + `/with-timestamps?output_format=${format}`;
    try {
      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: MODEL }),
      });
      if (!negotiatedFormat) {
        negotiatedFormat = format;
        console.log(`Формат аудио: ${format}`);
      }
      return { data: await res.json(), format };
    } catch (err) {
      if (/output_format_not_allowed|Output format/.test(err.message)) {
        console.warn(`Формат ${format} недоступен на этом тарифе, пробую следующий.`);
        lastRefusal = err;
        continue;
      }
      throw err;
    }
  }
  throw lastRefusal ?? new Error('Ни один формат аудио не принят API');
};

for (const [i, s] of video.scenes.entries()) {
  const nn = String(i).padStart(2, '0');
  const wav = path.join(audioDir, `scene-${nn}.wav`);
  const meta = path.join(audioDir, `scene-${nn}.json`);
  // Формат в хэш не входит: на выходе всегда wav pcm_s16le 44100, а честность
  // конвертации проверяет verifyWav, а не совпадение строк.
  const hash = crypto.createHash('sha256')
    .update(`${s.say}|${video.voiceId}|${MODEL}`).digest('hex');

  const metaData = fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta, 'utf8')) : null;
  const hashMatches = metaData?.hash === hash;
  const cachedFormat = metaData?.format ?? 'pcm_44100';
  const cachedRaw = path.join(audioDir, `scene-${nn}.${formatSpec(cachedFormat).ext}`);

  let caps;
  let audioMs = 0;
  if (!s.say) {
    caps = [];
  } else if (hashMatches && fs.existsSync(wav)) {
    // хэш совпал И wav реально есть — только тогда это честный кэш
    caps = metaData.captions;
    audioMs = verifyWav(wav, caps, `сцена ${nn} (кэш)`, s.say);
    console.log(`сцена ${nn}: из кэша`);
  } else if (hashMatches && fs.existsSync(cachedRaw)) {
    // API уже оплачен раньше (meta.json записан), но конвертация не успела
    // завершиться — дособираем wav из оплаченного сырья, к API не обращаемся
    caps = metaData.captions;
    toWav(cachedRaw, wav, cachedFormat);
    audioMs = verifyWav(wav, caps, `сцена ${nn}`, s.say);
    console.log(`сцена ${nn}: восстановлена из сырья без обращения к API (защита от повторной оплаты)`);
  } else {
    const { data, format } = await synthesize(s.say);
    const spec = formatSpec(format);
    const rawFile = path.join(audioDir, `scene-${nn}.${spec.ext}`);

    let bytes = Buffer.from(data.audio_base64, 'base64');
    // нечётный хвост ломает ffmpeg только у сырого pcm: там байты — сэмплы
    if (spec.raw && bytes.length % 2 === 1) bytes = bytes.subarray(0, bytes.length - 1);
    fs.writeFileSync(rawFile, bytes);

    caps = charsToWords(data.normalized_alignment);
    // Ответ уже оплачен — фиксируем captions в meta.json СРАЗУ, до ffmpeg.
    // Если конвертация упадёт, сырьё останется на диске и при следующем
    // запуске сцена дособерётся из него, а не оплатится повторно.
    fs.writeFileSync(meta, JSON.stringify({ hash, format, captions: caps }, null, 2));
    console.log(`сцена ${nn}: озвучена, ${caps.length} слов`);

    toWav(rawFile, wav, format);
    audioMs = verifyWav(wav, caps, `сцена ${nn}`, s.say);
  }

  timelineScenes.push({
    index: i,
    display: s.display,
    audioFile: s.say ? `audio/scene-${nn}.wav` : null,
    audioMs,          // фактическая длительность wav — чтобы хвост фразы не резался (I2)
    gapMs: s.gapMs,
    fallbackMs: s.fallbackMs,
    captions: caps,
  });
}

const timeline = buildTimeline({ scenes: timelineScenes, fps: FPS });
timeline.slug = slug;
timeline.voiceId = video.voiceId;
fs.writeFileSync(path.join(audioDir, 'timeline.json'), JSON.stringify(timeline, null, 2));
console.log(`timeline.json готов: ${timeline.totalFrames} кадров (${(timeline.totalFrames / FPS).toFixed(1)} с)`);

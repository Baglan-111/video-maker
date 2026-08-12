import { execFileSync } from 'node:child_process';

/** Фактическая длительность аудиофайла в миллисекундах (по ffprobe). */
export function probeDurationMs(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' },
  ).trim();
  const sec = parseFloat(out);
  if (!Number.isFinite(sec)) throw new Error(`ffprobe не смог измерить длительность ${file}`);
  return Math.round(sec * 1000);
}

/** Кодек первой аудиодорожки (для проверки, что в wav действительно PCM). */
export function probeAudioCodec(file) {
  return execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' },
  ).trim();
}

// Проверка асимметрична, потому что стороны расхождения означают разное.
// Аудио КОРОЧЕ меток — поломка: метки не могут указывать за пределы файла.
// Именно так выглядит дефект C1 (mp3 как сырой PCM): 1892 мс меток при файле
// в 398 мс. Допуск здесь узкий.
// Аудио ДЛИННЕЕ меток — норма: ElevenLabs оставляет тишину после последнего
// слова, обычно 200–300 мс. На короткой сцене это легко даёт 17% и роняло
// синтез ложным срабатыванием (поймано 06.08.2026 на первом реальном ролике).
// Поэтому сверху допуск и относительный, и абсолютный — что больше.
export const MAX_SHORTFALL = 0.05;
export const MAX_SHORTFALL_MS = 150;
export const MAX_EXCESS = 0.5;
export const MAX_EXCESS_MS = 1000;

/**
 * Страховка от дефекта C1: ElevenLabs молча отдаёт mp3, если output_format
 * передан не в query-строке. Байты mp3, записанные как сырой PCM, дают шум
 * и длительность в разы короче меток — расхождение видно сразу.
 *
 * Дыра, закрытая 06.08.2026: при captionsEndMs === 0 проверка молча выходила
 * ВСЕГДА — и для сцен без речи (say пустой, метки закономерно отсутствуют),
 * и для сцен, где say непустой, а ElevenLabs вернул пустой alignment. Второй
 * случай — ровно исходный дефект C1 (mp3 записан как сырой PCM): у такого
 * файла тоже может не быть меток, и страж его не ловил. Теперь captionsEndMs
 * === 0 разрешено только когда say сам по себе пуст; если say непустой,
 * пустые метки — явная ошибка, а не тихий пропуск.
 */
export function assertDurationMatchesCaptions({ file, actualMs, captionsEndMs, sceneLabel, say }) {
  if (!captionsEndMs) {
    if (say && say.trim()) {
      throw new Error(
        `${sceneLabel}: в сцене есть текст для озвучки ("${say.trim().slice(0, 60)}${say.trim().length > 60 ? '…' : ''}"), ` +
          `а метки времени (captions) пустые. Файл ${file} нельзя проверить на совпадение длительности — ` +
          `это тот же дефект, что и mp3, записанный как сырой PCM (пустой alignment от ElevenLabs). Повтори синтез.`,
      );
    }
    return;
  }
  const shortfallMs = captionsEndMs - actualMs;
  if (shortfallMs > Math.max(MAX_SHORTFALL_MS, captionsEndMs * MAX_SHORTFALL)) {
    throw new Error(
      `${sceneLabel}: аудио короче меток времени — так быть не может. ` +
        `Файл ${file} длится ${actualMs} мс, а последнее слово по меткам заканчивается на ${captionsEndMs} мс ` +
        `(не хватает ${shortfallMs} мс). Обычная причина — ответ ElevenLabs пришёл не в pcm_44100 ` +
        `(проверь, что output_format стоит в query-строке URL, в теле JSON он игнорируется), ` +
        `и mp3 записан как сырой PCM. Файл удалён, повтори синтез.`,
    );
  }

  const excessMs = actualMs - captionsEndMs;
  if (excessMs > Math.max(MAX_EXCESS_MS, captionsEndMs * MAX_EXCESS)) {
    throw new Error(
      `${sceneLabel}: в аудио слишком длинный хвост после последнего слова. ` +
        `Файл ${file} длится ${actualMs} мс при метках до ${captionsEndMs} мс (лишних ${excessMs} мс). ` +
        `Короткая тишина в конце — норма, но столько означает, что метки относятся не к этому файлу. ` +
        `Файл удалён, повтори синтез.`,
    );
  }
}

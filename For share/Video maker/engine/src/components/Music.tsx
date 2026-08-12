import { useMemo } from 'react';
import { staticFile } from 'remotion';
import { Audio } from '@remotion/media';
import type { Caption } from '../schema';
import { buildSpeechIntervals, volumeAtFrame } from '../lib/ducking.mjs';

// Ducking: музыка приглушается там, где по timeline.json идёт речь, и поднимается
// в паузах между фразами. Расписание речи известно заранее (метки слов от TTS),
// поэтому это точнее обычного сайдчейн-компрессора, который реагирует на громкость
// постфактум — здесь нет задержки реакции и ложных срабатываний на фоновый шум.
//
// Раунд 1 (по брифу) приглушал по каждому слову отдельно с FADE_MS=250 с каждой
// стороны — на реальных данных соседние слова идут теснее 2*250мс, поэтому окна
// сливались в один сплошной интервал и музыка была тихой весь ролик. Раунд 2:
// сначала слова склеиваются в интервалы речи (разрыв меньше MIN_GAP_MS — не пауза),
// и только между интервалами музыка поднимается; переход громкости — плавная рампа
// в RAMP_FRAMES кадров через interpolate, а не мгновенный скачок.
export const Music: React.FC<{
  src: string; captions: Caption[]; fps: number; base: number; duck?: number; rampFrames?: number;
}> = ({ src, captions, fps, base, duck, rampFrames }) => {
  const intervals = useMemo(() => buildSpeechIntervals(captions), [captions]);

  const volumeAt = (frame: number) => volumeAtFrame(intervals, frame, fps, base, { duck, rampFrames });

  return <Audio src={staticFile(src)} volume={volumeAt} />;
};

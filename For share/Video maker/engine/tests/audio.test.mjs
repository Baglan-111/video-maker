import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDurationMatchesCaptions } from '../scripts/lib/audio.mjs';

// Регрессия C1: ElevenLabs игнорирует output_format в теле JSON и отдаёт mp3.
// Записанный как сырой PCM, такой ответ даёт шум и длительность в разы короче
// меток. Реальные цифры дефекта: wav «длится» 398 мс, метки кончаются на 1892 мс.

test('mp3, записанный как PCM, ловится: аудио короче меток', () => {
  assert.throws(
    () => assertDurationMatchesCaptions({
      file: 'scene-00.wav', actualMs: 398, captionsEndMs: 1892, sceneLabel: 'сцена 00',
    }),
    /короче меток/,
  );
});

test('нормальный хвост фразы (244 мс сверх меток) ошибкой не считается', () => {
  assert.doesNotThrow(() => assertDurationMatchesCaptions({
    file: 'scene-00.wav', actualMs: 2136, captionsEndMs: 1892, sceneLabel: 'сцена 00',
  }));
});

// Регрессия 06.08.2026, поймано на первом реальном ролике: симметричный порог
// в 15% ронял синтез на короткой сцене. Хвост тишины после точки почти
// постоянен по длине (200–300 мс), поэтому в процентах он тем больше, чем
// короче фраза: 256 мс на сцене в 1509 мс — это 17%, и страж падал на норме.
test('короткая сцена с обычным хвостом тишины проходит', () => {
  assert.doesNotThrow(() => assertDurationMatchesCaptions({
    file: 'scene-01.wav', actualMs: 1765, captionsEndMs: 1509, sceneLabel: 'сцена 01',
  }));
});

test('аудио короче меток — ошибка даже при небольшом отрыве', () => {
  assert.throws(
    () => assertDurationMatchesCaptions({
      file: 'f.wav', actualMs: 1000, captionsEndMs: 1200, sceneLabel: 'сцена',
    }),
    /короче меток/,
  );
  assert.doesNotThrow(() => assertDurationMatchesCaptions({
    file: 'f.wav', actualMs: 1150, captionsEndMs: 1200, sceneLabel: 'сцена',
  }));
});

test('чрезмерный хвост означает чужие метки и ловится сверху', () => {
  assert.throws(
    () => assertDurationMatchesCaptions({
      file: 'f.wav', actualMs: 9000, captionsEndMs: 1500, sceneLabel: 'сцена',
    }),
    /слишком длинный хвост/,
  );
});

test('сцена без речи (say пустой) и без меток проверку пропускает', () => {
  assert.doesNotThrow(() => assertDurationMatchesCaptions({
    file: 'f.wav', actualMs: 500, captionsEndMs: 0, sceneLabel: 'сцена', say: '',
  }));
  assert.doesNotThrow(() => assertDurationMatchesCaptions({
    file: 'f.wav', actualMs: 500, captionsEndMs: 0, sceneLabel: 'сцена', say: undefined,
  }));
});

// Дыра, закрытая 06.08.2026: при say непустом пустые метки раньше проходили
// молча — то есть исходный дефект C1 (mp3 записан как сырой PCM, alignment
// пуст) мог повториться без единого сигнала.
test('сцена с непустым say и пустыми метками — это ошибка, а не тихий пропуск', () => {
  assert.throws(
    () => assertDurationMatchesCaptions({
      file: 'f.wav', actualMs: 500, captionsEndMs: 0, sceneLabel: 'сцена', say: 'Привет, мир',
    }),
    /метки времени.*пустые|пустые.*метки/i,
  );
});

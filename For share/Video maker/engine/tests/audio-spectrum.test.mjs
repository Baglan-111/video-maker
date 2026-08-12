import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compareSpectrum, bandRms, AIR_BANDS } from '../scripts/lib/audio-spectrum.mjs';

// Проверка защиты от «денойзер съел голос».
//
// Ловушка, ради которой всё это существует (замер 11.08.2026): ffmpeg-фильтр
// afftdn поднял отношение сигнал/шум на 11 дБ и одновременно срезал полосы
// 3–16 кГц на 3,4–3,9 дБ. По главной метрике обработка выглядела удачной, а
// голос она делала глухим. Одна метрика умеет расти, пока результат портится —
// поэтому тембр проверяется отдельным числом.
//
// Сигналы для тестов генерируются ffmpeg, а не берутся из проекта: тест не
// должен зависеть от того, лежит ли на машине конкретный ролик.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spectrum-'));

const makeNoise = (file, extraFilter = null) => {
  const filters = ['anoisesrc=color=white:amplitude=0.5:duration=6'];
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', filters[0]];
  if (extraFilter) args.push('-af', extraFilter);
  args.push('-ar', '48000', '-ac', '1', file);
  execFileSync('ffmpeg', args);
  return file;
};

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('bandRms измеряет полосу и отличает тихое от громкого', () => {
  const loud = makeNoise(path.join(tmp, 'loud.wav'));
  const quiet = makeNoise(path.join(tmp, 'quiet.wav'), 'volume=0.05');
  const a = bandRms(loud, 1000, 3000, { startSec: 1, durationSec: 2 });
  const b = bandRms(quiet, 1000, 3000, { startSec: 1, durationSec: 2 });
  assert.ok(a !== null && b !== null, 'обе полосы должны измериться');
  assert.ok(a > b + 15, `тихий сигнал обязан быть заметно тише: ${a} против ${b}`);
});

test('обработка без потери верха проходит проверку', () => {
  const before = makeNoise(path.join(tmp, 'b1.wav'));
  // Ослабляем ВЕСЬ сигнал одинаково: тембр не меняется, значит претензий нет.
  const after = makeNoise(path.join(tmp, 'a1.wav'), 'volume=0.9');
  const res = compareSpectrum(before, after, { startSec: 1, durationSec: 2 });
  assert.equal(res.ok, true, res.reason ?? '');
});

test('ловит срезанный верх — тот самый случай afftdn', () => {
  const before = makeNoise(path.join(tmp, 'b2.wav'));
  // lowpass 2,5 кГц имитирует денойзер, съевший «воздух»: низ на месте, верха нет.
  const after = makeNoise(path.join(tmp, 'a2.wav'), 'lowpass=f=2500');
  const res = compareSpectrum(before, after, { startSec: 1, durationSec: 2 });
  assert.equal(res.ok, false, 'срезанный верх обязан валить проверку');
  assert.ok(res.worstDropDb < -1, `падение должно быть больше допуска: ${res.worstDropDb}`);
  assert.match(res.reason, /воздух|глухим/);
});

test('порог настраивается — при щедром допуске та же обработка проходит', () => {
  const before = path.join(tmp, 'b2.wav');
  const after = path.join(tmp, 'a2.wav');
  const strict = compareSpectrum(before, after, { maxDropDb: 1, startSec: 1, durationSec: 2 });
  const loose = compareSpectrum(before, after, { maxDropDb: 60, startSec: 1, durationSec: 2 });
  assert.equal(strict.ok, false);
  assert.equal(loose.ok, true);
});

test('верхние полосы описаны и попадают в отчёт', () => {
  const before = path.join(tmp, 'b1.wav');
  const after = path.join(tmp, 'a1.wav');
  const res = compareSpectrum(before, after, { startSec: 1, durationSec: 2 });
  const air = res.bands.filter((b) => b.isAir);
  assert.equal(air.length, AIR_BANDS.length);
  for (const b of air) assert.ok(b.deltaDb !== null, `полоса ${b.lowHz}–${b.highHz} не измерилась`);
});

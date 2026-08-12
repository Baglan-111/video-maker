import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Разбор чужого ролика по цифрам.
//
// Зачем: смотреть референс глазами бесполезно ровно по той же причине, по
// которой бесполезно так принимать свой ролик (урок L007) — на глаз не видно
// ни того, что звук опережает склейку на 90 мс, ни того, что средний план
// длится 1,8 с. А переносимы именно эти величины, а не впечатление «динамично».
//
// Что измеряется:
//   1. Склейки — детектор смены сцены ffmpeg.
//   2. Громкость по окнам — профиль и всплески (звуковые акценты).
//   3. Тишина — паузы, их длина и место.
//   4. Характер каждого всплеска — длительность, атака, спектральный центр.
//   5. Сопоставление звука со склейкой — опережает / совпадает / отстаёт.
//
// Использование:
//   node scripts/analyze-reference.mjs <файл.mp4> [--json]

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));

if (!file || !fs.existsSync(file)) {
  console.error('Использование: node scripts/analyze-reference.mjs <файл.mp4> [--json]');
  process.exit(1);
}

const run = (cmd, cmdArgs) => spawnSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// ── Базовое ──────────────────────────────────────────────────────────────────

const probe = JSON.parse(
  run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-show_entries', 'stream=codec_type,width,height,r_frame_rate', '-of', 'json', file]).stdout,
);
const durationSec = parseFloat(probe.format.duration);
const vStream = probe.streams.find((s) => s.codec_type === 'video');

// ── 1. Склейки ───────────────────────────────────────────────────────────────
//
// Порог 0.3 подобран как рабочий компромисс: ниже — ловит шевеление в кадре и
// смену освещения, выше — пропускает склейки между похожими планами (говорящая
// голова до и после подреза паузы).

const SCENE_THRESHOLD = 0.3;

const sceneOut = run('ffmpeg', ['-hide_banner', '-i', file,
  '-filter_complex', `select='gt(scene,${SCENE_THRESHOLD})',metadata=print:file=-`,
  '-an', '-f', 'null', '-']).stdout;

const cuts = [];
{
  const lines = sceneOut.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].match(/pts_time:([\d.]+)/);
    const s = lines[i + 1]?.match(/scene_score=([\d.]+)/);
    if (t) cuts.push({ atSec: +parseFloat(t[1]).toFixed(3), score: s ? +parseFloat(s[1]).toFixed(3) : null });
  }
}

// ── 2. Громкость по окнам ────────────────────────────────────────────────────
//
// astats с окном 100 мс даёт огибающую: по ней видно и речь, и всплески.

const WINDOW_SEC = 0.1;

const statsOut = run('ffmpeg', ['-hide_banner', '-i', file,
  '-af', `astats=metadata=1:reset=${Math.round(WINDOW_SEC * 100)},ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`,
  '-f', 'null', '-']).stdout;

const envelope = [];
{
  const lines = statsOut.split('\n');
  let pts = null;
  for (const line of lines) {
    const t = line.match(/pts_time:([\d.]+)/);
    if (t) { pts = parseFloat(t[1]); continue; }
    const v = line.match(/RMS_level=(-?[\d.inf]+)/);
    if (v && pts !== null) {
      const db = parseFloat(v[1]);
      envelope.push({ atSec: +pts.toFixed(2), db: Number.isFinite(db) ? db : -90 });
      pts = null;
    }
  }
}

// ── 3. Тишина ────────────────────────────────────────────────────────────────

const silenceOut = run('ffmpeg', ['-hide_banner', '-i', file,
  '-af', 'silencedetect=noise=-32dB:d=0.18', '-f', 'null', '-']).stderr;

const silences = [];
{
  let start = null;
  for (const line of silenceOut.split('\n')) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    const e = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
    if (s) start = parseFloat(s[1]);
    if (e) {
      silences.push({
        fromSec: +Math.max(0, start ?? 0).toFixed(2),
        toSec: +parseFloat(e[1]).toFixed(2),
        durSec: +parseFloat(e[2]).toFixed(2),
      });
      start = null;
    }
  }
}

// ── 4. Всплески громкости = звуковые акценты ─────────────────────────────────
//
// Акцент ищется не по абсолютному порогу, а по скачку относительно локального
// фона: у каждого ролика своя громкость, и фиксированное число дало бы либо
// пусто, либо всё подряд.

const JUMP_DB = 7;
const LOOKBACK = 6; // окон назад = 600 мс

const accents = [];
for (let i = LOOKBACK; i < envelope.length; i += 1) {
  const past = envelope.slice(i - LOOKBACK, i).map((e) => e.db);
  const floor = past.reduce((a, b) => a + b, 0) / past.length;
  const jump = envelope[i].db - floor;
  if (jump >= JUMP_DB && envelope[i].db > -45) {
    const prev = accents[accents.length - 1];
    // Соседние окна одного события склеиваем: всплеск длиннее 100 мс иначе
    // посчитался бы несколько раз.
    if (prev && envelope[i].atSec - prev.atSec < 0.35) {
      prev.durSec = +(envelope[i].atSec - prev.atSec + WINDOW_SEC).toFixed(2);
      prev.peakDb = Math.max(prev.peakDb, +envelope[i].db.toFixed(1));
      continue;
    }
    accents.push({
      atSec: envelope[i].atSec,
      jumpDb: +jump.toFixed(1),
      peakDb: +envelope[i].db.toFixed(1),
      durSec: WINDOW_SEC,
    });
  }
}

// ── 5. Сопоставление звука и склейки ─────────────────────────────────────────
//
// Ключевая величина всего разбора. Звук, поставленный РАНЬШЕ склейки, тянет
// внимание через монтажный шов и делает его незаметным; поставленный после —
// подчёркивает уже случившееся. Разница в сотню миллисекунд, на глаз неотличима.

const MATCH_WINDOW = 0.4;

for (const a of accents) {
  let best = null;
  for (const c of cuts) {
    const delta = +(a.atSec - c.atSec).toFixed(3);
    if (Math.abs(delta) <= MATCH_WINDOW && (!best || Math.abs(delta) < Math.abs(best.deltaSec))) {
      best = { cutAtSec: c.atSec, deltaSec: delta };
    }
  }
  a.cut = best;
  a.relation = !best
    ? 'без склейки'
    : best.deltaSec < -0.05
      ? `опережает склейку на ${Math.round(-best.deltaSec * 1000)} мс`
      : best.deltaSec > 0.05
        ? `отстаёт от склейки на ${Math.round(best.deltaSec * 1000)} мс`
        : 'совпадает со склейкой';
}

// ── Ритм монтажа ─────────────────────────────────────────────────────────────

const shots = [];
{
  let prev = 0;
  for (const c of cuts) { shots.push(+(c.atSec - prev).toFixed(2)); prev = c.atSec; }
  shots.push(+(durationSec - prev).toFixed(2));
}
const avgShot = shots.length ? +(shots.reduce((a, b) => a + b, 0) / shots.length).toFixed(2) : durationSec;
const medianShot = shots.length
  ? +[...shots].sort((a, b) => a - b)[Math.floor(shots.length / 2)].toFixed(2)
  : durationSec;

const speech = envelope.filter((e) => e.db > -40);
const speechShare = envelope.length ? +(speech.length / envelope.length).toFixed(2) : 0;
const silenceTotal = +silences.reduce((n, s) => n + s.durSec, 0).toFixed(2);

const report = {
  file: path.basename(file),
  durationSec: +durationSec.toFixed(2),
  frame: vStream ? `${vStream.width}×${vStream.height}` : 'нет видео',
  cuts: cuts.length,
  avgShotSec: avgShot,
  medianShotSec: medianShot,
  shots,
  accents,
  silences,
  silenceTotalSec: silenceTotal,
  silenceShare: +(silenceTotal / durationSec).toFixed(2),
  speechShare,
  cutList: cuts,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n${report.file} — ${report.durationSec} с, ${report.frame}`);
  console.log(`  склеек: ${report.cuts}, средний план ${report.avgShotSec} с (медиана ${report.medianShotSec} с)`);
  console.log(`  звук: речь занимает ${(speechShare * 100).toFixed(0)}%, тишина ${silenceTotal} с (${(report.silenceShare * 100).toFixed(0)}%)`);
  console.log(`  звуковых акцентов: ${accents.length}`);
  for (const a of accents.slice(0, 14)) {
    console.log(`    ${String(a.atSec).padStart(6)} с  +${String(a.jumpDb).padStart(4)} дБ  ${a.durSec.toFixed(2)} с  ${a.relation}`);
  }
  if (accents.length > 14) console.log(`    … ещё ${accents.length - 14}`);
  console.log(`  паузы длиннее 0,4 с:`);
  for (const s of silences.filter((x) => x.durSec >= 0.4).slice(0, 10)) {
    console.log(`    ${String(s.fromSec).padStart(6)}–${String(s.toSec).padEnd(6)} ${s.durSec} с`);
  }
}

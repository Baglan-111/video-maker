import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sceneAt,
  enterExit,
  panelPhase,
  cursorTotalFrames,
  cursorSegment,
  sceneSpeech,
  splitTitle,
  surfaceOpacity,
} from '../src/lib/promo-motion.mjs';

const scenes = [
  { index: 0, startFrame: 0, durationFrames: 60 },
  { index: 1, startFrame: 60, durationFrames: 90 },
];

// ── sceneAt ──────────────────────────────────────────────────────────────────

test('sceneAt находит сцену и локальный кадр', () => {
  assert.equal(sceneAt(scenes, 0).index, 0);
  assert.equal(sceneAt(scenes, 59).index, 0);
  assert.equal(sceneAt(scenes, 60).index, 1);
  assert.equal(sceneAt(scenes, 75).localFrame, 15);
});

test('sceneAt за пределами таймлайна возвращает null', () => {
  assert.equal(sceneAt(scenes, -1), null);
  assert.equal(sceneAt(scenes, 150), null);
});

// ── enterExit ────────────────────────────────────────────────────────────────

test('enterExit: появление в начале, уход в конце', () => {
  const o = { enterFrames: 10, exitFrames: 5 };
  assert.deepEqual(enterExit(0, 100, o), { enter: 0, exit: 0 });
  assert.deepEqual(enterExit(5, 100, o), { enter: 0.5, exit: 0 });
  assert.deepEqual(enterExit(10, 100, o), { enter: 1, exit: 0 });
  assert.deepEqual(enterExit(50, 100, o), { enter: 1, exit: 0 });
  assert.deepEqual(enterExit(95, 100, o), { enter: 1, exit: 0 });
  assert.deepEqual(enterExit(100, 100, o), { enter: 1, exit: 1 });
});

test('enterExit: на короткой сцене окна сжимаются, а не накладываются', () => {
  // сцена 10 кадров при желании 20 → сжатие вдвое: появление 6, уход 4
  const r = enterExit(6, 10, { enterFrames: 12, exitFrames: 8 });
  assert.equal(r.enter, 1, 'к шестому кадру появление завершено');
  assert.equal(r.exit, 0, 'уход ещё не начался — вспышки нет');
  assert.equal(enterExit(8, 10, { enterFrames: 12, exitFrames: 8 }).exit, 0.5);
});

// ── panelPhase ───────────────────────────────────────────────────────────────

test('panelPhase: панель начинает появляться ДО своей сцены (нет склейки)', () => {
  const o = { enterFrames: 9, exitFrames: 6 };
  // сцена 1 начинается на кадре 60; окно панели открывается на 51-м
  assert.equal(panelPhase(60, 90, 50, o), null);
  const early = panelPhase(60, 90, 51, o);
  assert.equal(early.enter, 0);
  assert.equal(early.sceneFrame, -9, 'сцена ещё не началась');
  assert.equal(panelPhase(60, 90, 60, o).enter, 1, 'к началу сцены панель проявилась полностью');
});

test('panelPhase: предыдущая панель ещё уходит, когда следующая уже появляется', () => {
  const o = { enterFrames: 9, exitFrames: 6 };
  // на кадре 56 сцена 0 (0..60) в фазе ухода, а панель сцены 1 уже проявляется
  const leaving = panelPhase(0, 60, 56, o);
  const arriving = panelPhase(60, 90, 56, o);
  assert.ok(leaving.exit > 0 && leaving.exit < 1, 'предыдущая ещё видна и уже уходит');
  assert.ok(arriving !== null && arriving.enter > 0, 'следующая уже проявляется');
});

test('panelPhase: за окном панели — null', () => {
  const o = { enterFrames: 9, exitFrames: 6 };
  assert.equal(panelPhase(0, 60, 60, o), null);
});

// ── surfaceOpacity ───────────────────────────────────────────────────────────

test('текстовая панель проявляется прозрачностью линейно', () => {
  assert.equal(surfaceOpacity(0, 0), 0);
  assert.equal(surfaceOpacity(0.5, 0), 0.5);
  assert.equal(surfaceOpacity(1, 0), 1);
  assert.equal(surfaceOpacity(1, 0.25), 0.75);
});

test('поверхность становится непрозрачной задолго до конца появления', () => {
  // регрессия: уходящий заголовок просвечивал сквозь въезжающую белую карточку
  assert.equal(surfaceOpacity(0.35, 0, { solid: true }), 1, 'к 35% появления карточка уже глухая');
  assert.equal(surfaceOpacity(0.5, 0, { solid: true }), 1);
  assert.equal(surfaceOpacity(1, 0, { solid: true }), 1);
});

test('поверхность всё же не возникает мгновенно — начало появления прозрачно', () => {
  assert.equal(surfaceOpacity(0, 0, { solid: true }), 0);
  assert.ok(surfaceOpacity(0.1, 0, { solid: true }) < 0.4, 'на первых кадрах карточка ещё полупрозрачна');
});

test('уход гасит и поверхность тоже — в конце ролика за ней ничего нет', () => {
  assert.equal(surfaceOpacity(1, 1, { solid: true }), 0);
  assert.equal(surfaceOpacity(1, 0.5, { solid: true }), 0.5);
});

// ── курсор ───────────────────────────────────────────────────────────────────

const CO = { travelFrames: 12, dwellFrames: 10 };
const pts = [
  { x: 0, y: 0 },
  { x: 100, y: 100 },
  { x: 200, y: 200 },
];

test('cursorTotalFrames считает стоянки и переезды', () => {
  assert.equal(cursorTotalFrames(0, CO), 0);
  assert.equal(cursorTotalFrames(1, CO), 10);
  assert.equal(cursorTotalFrames(3, CO), 10 + 2 * 22);
});

test('cursorSegment: стоит на первой точке, потом едет, потом стоит', () => {
  assert.deepEqual(cursorSegment(pts, 0, CO), { from: pts[0], to: pts[0], t: 1 });
  assert.deepEqual(cursorSegment(pts, 9, CO), { from: pts[0], to: pts[0], t: 1 });

  const mid = cursorSegment(pts, 16, CO); // 10 стоянка + 6 из 12 кадров переезда
  assert.deepEqual({ from: mid.from, to: mid.to }, { from: pts[0], to: pts[1] });
  assert.equal(mid.t, 0.5);

  const parked = cursorSegment(pts, 26, CO); // 10 + 12 переезд + 4 стоянки
  assert.deepEqual(parked, { from: pts[1], to: pts[1], t: 1 });
});

test('cursorSegment: после последней точки курсор остаётся на ней, не прыгает в начало', () => {
  const end = cursorSegment(pts, 1000, CO);
  assert.deepEqual(end, { from: pts[2], to: pts[2], t: 1 });
});

test('cursorSegment на пустом списке точек — null, а не падение', () => {
  assert.equal(cursorSegment([], 5, CO), null);
  assert.equal(cursorSegment(null, 5, CO), null);
});

test('cursorSegment: единственная точка — курсор просто стоит', () => {
  assert.deepEqual(cursorSegment([pts[0]], 999, CO), { from: pts[0], to: pts[0], t: 1 });
});

// ── тексты ───────────────────────────────────────────────────────────────────

test('sceneSpeech собирает произнесённую фразу из меток, сохраняя пунктуацию', () => {
  const scene = {
    captions: [
      { text: 'Заметки' },
      { text: 'копятся.' },
      { text: 'Читать' },
      { text: 'их' },
      { text: 'некогда.' },
    ],
  };
  assert.equal(sceneSpeech(scene), 'Заметки копятся. Читать их некогда.');
});

test('sceneSpeech на молчаливой сцене — пустая строка (плашка не рисуется)', () => {
  assert.equal(sceneSpeech({ captions: [] }), '');
  assert.equal(sceneSpeech(null), '');
});

test('splitTitle делит заголовок на нейтральную и акцентную части', () => {
  assert.deepEqual(splitTitle('Заметки копятся.|Читать их некогда.'), {
    lead: 'Заметки копятся.',
    accent: 'Читать их некогда.',
  });
});

test('splitTitle без разделителя оставляет весь заголовок нейтральным', () => {
  assert.deepEqual(splitTitle('Просто заголовок'), { lead: 'Просто заголовок', accent: '' });
  assert.deepEqual(splitTitle(undefined), { lead: '', accent: '' });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoJson, RENDER_DEFAULTS, DEFAULT_GAP_MS, TEMPLATES, COMPOSITION_BY_TEMPLATE } from '../src/lib/video-schema.mjs';

const base = { template: 'kinetic@1', voiceId: 'JBFqnCBsd6RMkjVDRZzb' };

test('минимальный video.json проходит и получает значения по умолчанию', () => {
  const v = parseVideoJson({ ...base, scenes: [{ say: 'Привет' }] });
  assert.equal(v.bg, RENDER_DEFAULTS.bg);
  assert.equal(v.accent, RENDER_DEFAULTS.accent);
  assert.equal(v.music, null);
  assert.equal(v.musicVolume, RENDER_DEFAULTS.musicVolume);
  assert.equal(v.scenes[0].gapMs, DEFAULT_GAP_MS);
  assert.equal(v.scenes[0].display, 'Привет');   // display по умолчанию = say
});

test('цвета и музыка ролика читаются из файла (регрессия I4)', () => {
  const v = parseVideoJson({
    ...base, bg: '#101010', accent: '#FF0066', music: 'test-tone.wav', musicVolume: 0.2,
    scenes: [{ say: 'Привет', display: 'Хай' }],
  });
  assert.deepEqual(
    { bg: v.bg, accent: v.accent, music: v.music, musicVolume: v.musicVolume },
    { bg: '#101010', accent: '#FF0066', music: 'test-tone.wav', musicVolume: 0.2 },
  );
  assert.equal(v.scenes[0].display, 'Хай');
});

test('сцена без say и без fallbackMs — ошибка (регрессия I8)', () => {
  assert.throws(() => parseVideoJson({ ...base, scenes: [{ display: 'Тишина' }] }), /fallbackMs/);
});

test('сцена без say, но с fallbackMs — допустима', () => {
  const v = parseVideoJson({ ...base, scenes: [{ display: 'Тишина', fallbackMs: 1500 }] });
  assert.equal(v.scenes[0].say, '');
  assert.equal(v.scenes[0].fallbackMs, 1500);
});

test('опечатка в имени поля не проходит молча', () => {
  assert.throws(() => parseVideoJson({ ...base, scenes: [{ say: 'а', gapMS: 100 }] }), /gapMS|Unrecognized/i);
});

test('неизвестный шаблон и пустой voiceId ловятся', () => {
  assert.throws(() => parseVideoJson({ ...base, template: 'kinetic@9', scenes: [{ say: 'а' }] }));
  assert.throws(() => parseVideoJson({ ...base, voiceId: '', scenes: [{ say: 'а' }] }), /voiceId/);
});

test('пустой список сцен — ошибка', () => {
  assert.throws(() => parseVideoJson({ ...base, scenes: [] }), /хотя бы одна сцена/);
});

test('громкость музыки вне диапазона 0..1 — ошибка', () => {
  assert.throws(() => parseVideoJson({ ...base, musicVolume: 1.5, scenes: [{ say: 'а' }] }));
});

// ── Секция diagram (шаблон scheme@1, движок Motion Canvas) ────────────────────
// Главное требование при её появлении: ролики, у которых схемы нет, должны
// проходить валидацию ровно как прежде.

const diagram = {
  nodes: [
    { id: 'a', label: 'Пациент оставляет заявку' },
    { id: 'b', label: 'Проверяем полис' },
  ],
  edges: [{ from: 'a', to: 'b' }],
};

test('старый ролик без diagram валиден и получает diagram: null', () => {
  const v = parseVideoJson({ ...base, scenes: [{ say: 'Привет' }] });
  assert.equal(v.diagram, null);
});

test('diagram разбирается и получает значения по умолчанию', () => {
  const v = parseVideoJson({ ...base, template: 'scheme@1', diagram, scenes: [{ say: 'а' }] });
  assert.equal(v.diagram.layout, 'vertical');
  assert.equal(v.diagram.title, '');
  assert.deepEqual(v.diagram.nodes.map((n) => n.scene), [0, 1]); // шаг N ← сцена N
  assert.equal(v.diagram.edges[0].label, '');
});

test('явный scene у узла переопределяет привязку по порядку', () => {
  const v = parseVideoJson({
    ...base, template: 'scheme@1', scenes: [{ say: 'а' }],
    diagram: { ...diagram, nodes: [{ id: 'a', label: 'А', scene: 2 }, { id: 'b', label: 'Б' }] },
  });
  assert.deepEqual(v.diagram.nodes.map((n) => n.scene), [2, 1]);
});

test('шаблон scheme@1 без diagram — ошибка', () => {
  assert.throws(() => parseVideoJson({ ...base, template: 'scheme@1', scenes: [{ say: 'а' }] }), /diagram/);
});

test('стрелка в несуществующий узел ловится', () => {
  assert.throws(
    () => parseVideoJson({
      ...base, template: 'scheme@1', scenes: [{ say: 'а' }],
      diagram: { ...diagram, edges: [{ from: 'a', to: 'zzz' }] },
    }),
    /несуществующий узел/,
  );
});

test('повторяющийся id узла ловится', () => {
  assert.throws(
    () => parseVideoJson({
      ...base, template: 'scheme@1', scenes: [{ say: 'а' }],
      diagram: { ...diagram, nodes: [{ id: 'a', label: 'А' }, { id: 'a', label: 'Б' }] },
    }),
    /повторяется/,
  );
});

test('один узел в схеме и опечатка в поле узла не проходят', () => {
  assert.throws(() => parseVideoJson({
    ...base, template: 'scheme@1', scenes: [{ say: 'а' }],
    diagram: { nodes: [{ id: 'a', label: 'А' }], edges: [{ from: 'a', to: 'a' }] },
  }), /два узла/);
  assert.throws(() => parseVideoJson({
    ...base, template: 'scheme@1', scenes: [{ say: 'а' }],
    diagram: { ...diagram, nodes: [{ id: 'a', label: 'А', Scene: 1 }, { id: 'b', label: 'Б' }] },
  }), /Scene|Unrecognized/i);
});

// ── Секция promo (шаблон promo@1, композиция Remotion 1920×1080) ──────────────
// Требование то же, что и при появлении diagram: ролики без секции обязаны
// валидироваться ровно как прежде.

const promo = {
  panels: [
    { kind: 'title' },
    {
      kind: 'card',
      title: 'КАРТОТЕКА ПРОДАКТА',
      rows: ['Первая', 'Вторая', 'Третья'],
      counter: { value: '7', label: 'карточек' },
    },
  ],
};

test('старый ролик без promo валиден и получает promo: null', () => {
  const v = parseVideoJson({ ...base, scenes: [{ say: 'Привет' }] });
  assert.equal(v.promo, null);
});

test('promo разбирается, панель N привязывается к сцене N', () => {
  const v = parseVideoJson({ ...base, template: 'promo@1', promo, scenes: [{ say: 'а' }, { say: 'б' }] });
  assert.deepEqual(v.promo.panels.map((p) => p.scene), [0, 1]);
  assert.equal(v.promo.panels[1].counter.value, '7');
});

test('явный scene у панели переопределяет привязку по порядку', () => {
  const v = parseVideoJson({
    ...base, template: 'promo@1', scenes: [{ say: 'а' }, { say: 'б' }],
    promo: { panels: [{ kind: 'title', scene: 1 }] },
  });
  assert.equal(v.promo.panels[0].scene, 1);
});

test('панель без счётчика допустима, counter становится null', () => {
  const v = parseVideoJson({
    ...base, template: 'promo@1', scenes: [{ say: 'а' }],
    promo: { panels: [{ kind: 'card', title: 'Т', rows: ['Раз'] }] },
  });
  assert.equal(v.promo.panels[0].counter, null);
});

test('шаблон promo@1 без секции promo — ошибка', () => {
  assert.throws(() => parseVideoJson({ ...base, template: 'promo@1', scenes: [{ say: 'а' }] }), /promo/);
});

test('панель, привязанная к несуществующей сцене, ловится', () => {
  assert.throws(
    () => parseVideoJson({
      ...base, template: 'promo@1', scenes: [{ say: 'а' }],
      promo: { panels: [{ kind: 'title' }, { kind: 'title' }] },
    }),
    /сцен всего 1/,
  );
});

test('больше четырёх строк в карточке не проходит — они наползли бы на плашку', () => {
  assert.throws(
    () => parseVideoJson({
      ...base, template: 'promo@1', scenes: [{ say: 'а' }],
      promo: { panels: [{ kind: 'card', title: 'Т', rows: ['1', '2', '3', '4', '5'] }] },
    }),
    /четырёх строк/,
  );
});

test('карточка без строк и счётчик без подписи не проходят', () => {
  assert.throws(() => parseVideoJson({
    ...base, template: 'promo@1', scenes: [{ say: 'а' }],
    promo: { panels: [{ kind: 'card', title: 'Т', rows: [] }] },
  }), /хотя бы одна строка/);
  assert.throws(() => parseVideoJson({
    ...base, template: 'promo@1', scenes: [{ say: 'а' }],
    promo: { panels: [{ kind: 'card', title: 'Т', rows: ['Раз'], counter: { value: '7' } }] },
  }), /подпись|label|Invalid/i);
});

test('неизвестный вид панели и опечатка в поле не проходят молча', () => {
  assert.throws(() => parseVideoJson({
    ...base, template: 'promo@1', scenes: [{ say: 'а' }],
    promo: { panels: [{ kind: 'chart' }] },
  }));
  assert.throws(() => parseVideoJson({
    ...base, template: 'promo@1', scenes: [{ say: 'а' }],
    promo: { panels: [{ kind: 'card', title: 'Т', rows: ['Раз'], Counter: { value: '7', label: 'шт' } }] },
  }), /Counter|Unrecognized/i);
});

test('COMPOSITION_BY_TEMPLATE покрывает все шаблоны из TEMPLATES', () => {
  for (const t of TEMPLATES) {
    assert.ok(t in COMPOSITION_BY_TEMPLATE, `шаблон ${t} не описан в COMPOSITION_BY_TEMPLATE`);
  }
  assert.equal(COMPOSITION_BY_TEMPLATE['kinetic@1'], 'Kinetic');
  assert.equal(COMPOSITION_BY_TEMPLATE['promo@1'], 'Promo');
  assert.equal(COMPOSITION_BY_TEMPLATE['scheme@1'], null, 'scheme@1 рисует не Remotion');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseLicenses, assertMusicAllowed } from '../scripts/lib/music.mjs';
import { fileURLToPath } from 'node:url';

const engine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('из реестра читаются имена файлов, шапка и разделитель — нет', () => {
  const md = `| Файл | Источник | Лицензия | Дата |\n|---|---|---|---|\n| a.wav | x | CC0 | 2026-01-01 |\n| b.mp3 | y | куплен | 2026-02-02 |`;
  assert.deepEqual([...parseLicenses(md)], ['a.wav', 'b.mp3']);
});

test('строка без источника или лицензии не считается разрешением', () => {
  const md = `| Файл | Источник | Лицензия | Дата |\n|---|---|---|---|\n| a.wav |  |  |  |`;
  assert.equal(parseLicenses(md).size, 0);
});

test('трека нет в реестре — явная ошибка (регрессия I6)', () => {
  assert.throws(() => assertMusicAllowed(engine, 'piratskiy-hit.mp3'), /LICENSES\.md/);
});

test('трек из реестра проходит и файл лежит на диске', () => {
  const file = assertMusicAllowed(engine, 'test-tone.wav');
  assert.match(file, /assets\/music\/test-tone\.wav$/);
});

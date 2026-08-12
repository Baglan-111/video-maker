import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry, backoffMs } from '../scripts/lib/fetch-retry.mjs';

const resp = (status, body = '') => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  headers: { get: () => null },
});

const harness = (statuses) => {
  const calls = [];
  const delays = [];
  const fetchImpl = async () => {
    calls.push(1);
    const s = statuses.shift();
    if (s instanceof Error) throw s;
    return resp(s);
  };
  return {
    calls,
    delays,
    opts: { fetchImpl, sleep: async (ms) => { delays.push(ms); }, log: () => {} },
  };
};

test('429 повторяется и на второй попытке проходит', async () => {
  const h = harness([429, 200]);
  const res = await fetchWithRetry('u', {}, h.opts);
  assert.equal(res.status, 200);
  assert.equal(h.calls.length, 2);
});

test('пауза растёт экспоненциально: 1с, 2с', async () => {
  const h = harness([500, 503, 200]);
  await fetchWithRetry('u', {}, { ...h.opts, maxAttempts: 3 });
  assert.deepEqual(h.delays, [1000, 2000]);
});

test('после трёх попыток сдаётся с понятной ошибкой', async () => {
  const h = harness([500, 502, 503]);
  await assert.rejects(() => fetchWithRetry('u', {}, h.opts), /за 3 попытки/);
  assert.equal(h.calls.length, 3);
});

test('401 не повторяется — ключ повтором не починишь', async () => {
  const h = harness([401, 200]);
  await assert.rejects(() => fetchWithRetry('u', {}, h.opts), /401/);
  assert.equal(h.calls.length, 1);
});

test('обрыв сети тоже повторяется', async () => {
  const h = harness([new Error('ECONNRESET'), 200]);
  const res = await fetchWithRetry('u', {}, h.opts);
  assert.equal(res.status, 200);
  assert.equal(h.calls.length, 2);
});

test('Retry-After уважается', () => {
  assert.equal(backoffMs(1, '7'), 7000);
  assert.equal(backoffMs(1, null), 1000);
  assert.equal(backoffMs(3, null), 4000);
});

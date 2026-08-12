// Ретраи на 429 и 5xx (дефект I3, дизайн 5.8).
// Один сбой сети или лимит частоты не должен ронять прогон многосценного
// ролика после того, как половина сцен уже оплачена.

export const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
export const MAX_ATTEMPTS = 3;
export const BASE_DELAY_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Пауза перед попыткой n (1-based): 1с, 2с, 4с. Учитывает Retry-After. */
export function backoffMs(attempt, retryAfterHeader, baseDelayMs = BASE_DELAY_MS) {
  const fromHeader = Number(retryAfterHeader);
  if (Number.isFinite(fromHeader) && fromHeader > 0) return Math.min(fromHeader * 1000, 30000);
  return baseDelayMs * 2 ** (attempt - 1);
}

/**
 * fetch с ретраями. Возвращает успешный Response; на неретраибельной ошибке
 * или после MAX_ATTEMPTS бросает Error с текстом ответа.
 */
export async function fetchWithRetry(url, init, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? BASE_DELAY_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const wait = opts.sleep ?? sleep;
  const log = opts.log ?? ((m) => console.warn(m));

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res = null;
    try {
      res = await fetchImpl(url, init);
    } catch (err) {
      lastError = err; // сеть не ответила — это тоже повод повторить
    }

    if (res && res.ok) return res;

    if (res && !RETRY_STATUSES.has(res.status)) {
      throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    }

    if (res) lastError = new Error(`ElevenLabs ${res.status}: ${await res.text()}`);

    if (attempt === maxAttempts) break;
    const delay = backoffMs(attempt, res?.headers?.get?.('retry-after'), baseDelayMs);
    log(`Попытка ${attempt} из ${maxAttempts} не удалась (${lastError.message}). Повтор через ${delay} мс.`);
    await wait(delay);
  }
  throw new Error(`Не удалось получить ответ за ${maxAttempts} попытки. Последняя ошибка: ${lastError?.message}`);
}

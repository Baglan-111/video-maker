const msToFrames = (ms, fps) => Math.round((ms / 1000) * fps);

/**
 * Собирает таймлайн из сцен.
 *
 * Контракт длительности сцены (изменён 06.08.2026, дефекты I1/I2):
 *   durationFrames покрывает РЕЧЬ + ПАУЗУ gapMs, а не только речь.
 *
 * Почему так:
 *   I1 — раньше gapMs двигал курсор, но не входил в durationFrames, поэтому
 *        кадры на стыке сцен не покрывались ни одной <Sequence> и зритель
 *        видел пустой фон (на 12 сценах — 11 морганий).
 *   I2 — длительность считалась по max(endMs) меток, а реальный wav длиннее
 *        (хвост фразы после последнего слова). <Audio> внутри <Sequence>
 *        обрезался по границе. Поэтому берётся max(метки, фактическая
 *        длительность аудиофайла audioMs).
 *
 * Границы кадров считаются от накопленного курсора, а не как сумма округлённых
 * длительностей: иначе округление на стыке даёт лишний или недостающий кадр и
 * щель возвращается. Инвариант: startFrame следующей сцены равен
 * startFrame + durationFrames предыдущей.
 */
export function buildTimeline({ scenes, fps }) {
  let cursorMs = 0;
  const out = [];

  for (const s of scenes) {
    const spokenMs = s.captions.length ? Math.max(...s.captions.map((c) => c.endMs)) : 0;
    const audioMs = s.audioMs ?? 0;
    const fallbackMs = s.fallbackMs ?? 0;
    const contentMs = Math.max(spokenMs, audioMs, fallbackMs);

    if (contentMs <= 0) {
      throw new Error(
        `Сцена ${s.index}: нулевая длительность — нет ни речи, ни явной длительности. ` +
          `Добавь этой сцене в video.json поле "say" (что произнести) или "fallbackMs" (сколько миллисекунд держать кадр молча).`,
      );
    }

    const gapMs = s.gapMs ?? 0;
    const startFrame = msToFrames(cursorMs, fps);
    const endFrame = msToFrames(cursorMs + contentMs + gapMs, fps);

    out.push({
      index: s.index,
      display: s.display,
      audioFile: s.audioFile,
      startFrame,
      durationFrames: Math.max(1, endFrame - startFrame),
      captions: s.captions.map((c) => ({
        ...c,
        startMs: c.startMs + cursorMs,
        endMs: c.endMs + cursorMs,
        timestampMs: c.timestampMs === null ? null : c.timestampMs + cursorMs,
      })),
    });

    cursorMs += contentMs + gapMs;
  }

  const last = out[out.length - 1];
  const totalFrames = last ? last.startFrame + last.durationFrames : 0;
  return { fps, totalFrames, scenes: out };
}

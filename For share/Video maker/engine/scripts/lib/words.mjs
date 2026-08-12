const isNumeric = (s) => /^\d+$/.test(s);

export function charsToWords(alignment) {
  const { characters: ch, character_start_times_seconds: cs, character_end_times_seconds: ce } = alignment;
  const raw = [];
  let text = '', start = null, end = null;

  for (let i = 0; i < ch.length; i++) {
    if (ch[i] === ' ') {
      if (text) { raw.push({ text, start, end }); text = ''; start = null; }
      continue;
    }
    if (!text) start = cs[i];
    text += ch[i];
    end = ce[i];
  }
  if (text) raw.push({ text, start, end });

  // склейка соседних числовых токенов: «5» + «000» → «5 000»
  const merged = [];
  for (const w of raw) {
    const prev = merged[merged.length - 1];
    if (prev && isNumeric(prev.text.replace(/\s/g, '')) && isNumeric(w.text)) {
      prev.text += ' ' + w.text;
      prev.end = w.end;
    } else {
      merged.push({ ...w });
    }
  }

  return merged.map((w) => ({
    text: w.text,
    startMs: Math.round(w.start * 1000),
    endMs: Math.round(w.end * 1000),
    timestampMs: Math.round(w.start * 1000),
    confidence: null,
  }));
}

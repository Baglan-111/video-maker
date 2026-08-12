const RULES = [
  { code: 'SYMBOL', re: /[₸$€%№§]/,
    message: 'Замени символ словом: «тенге», «долларов», «процентов», «номер».' },
  { code: 'ABBREV', re: /(?<![\p{L}\p{N}])(т\.\s?д\.|т\.\s?п\.|др\.|руб\.|г\.)/iu,
    message: 'Разверни сокращение полностью: «и так далее», «и тому подобное».' },
  { code: 'SPACED_NUMBER', re: /\d\s+\d/,
    message: 'Пиши число слитно («5000»): пробел внутри числа разваливает субтитр.' },
];

const LATIN = /[A-Za-z]{2,}/;

export function validateSay(text) {
  const errors = RULES.filter(r => r.re.test(text)).map(r => ({ code: r.code, message: r.message }));
  const warnings = LATIN.test(text)
    ? [{ code: 'LATIN', message: 'Латиница в русской фразе — проверь, как модель это произнесёт.' }]
    : [];
  return { ok: errors.length === 0, errors, warnings };
}

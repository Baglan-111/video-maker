import { z } from 'zod';

// Формальная схема video.json (дефект I8).
//
// До этого zod описывал только пропсы рендера, а сам video.json не проверялся
// ничем: сцена без say и без fallbackMs давала ноль кадров и молча схлопывалась,
// опечатка в имени поля игнорировалась.
//
// Файл лежит в src/lib и написан на .mjs намеренно: его импортируют и
// node-скрипты (tts.mjs, render.mjs), и бандл Remotion (calculateMetadata).
// Одна схема на оба мира — иначе они разъезжаются.

// kinetic@1 и promo@1 рисует Remotion (engine), scheme@1 — Motion Canvas (canvas).
// Все три читают один и тот же video.json и один и тот же audio/timeline.json:
// звуковой конвейер (tts.mjs) общий, разный только рисующий слой.
// story@1 отличается от остальных источником звука: речь не синтезируется, а
// приходит из снятого видео. Поэтому у него нет voiceId и нет scenes[].say —
// сцены задаются отрезками времени внутри одной непрерывной дорожки, а не
// склейкой отдельных wav. Общее с остальными — тот же audio/timeline.json и та
// же разбивка субтитров на страницы.
export const TEMPLATES = ['kinetic@1', 'promo@1', 'scheme@1', 'story@1'];

// Какую композицию Remotion рендерить под шаблон. Раньше render.mjs звал
// 'Kinetic' строкой, то есть любой шаблон рисовался кинетическим текстом —
// scheme@1 молча, promo@1 не смог бы появиться вовсе. null означает «этот
// шаблон рисует не Remotion»; render.mjs на таком останавливается с объяснением.
export const COMPOSITION_BY_TEMPLATE = {
  'kinetic@1': 'Kinetic',
  'promo@1': 'Promo',
  'scheme@1': null,
  'story@1': 'Story',
};

export const RENDER_DEFAULTS = {
  bg: '#0E1116',
  accent: '#4F8DFD',
  music: null,
  musicVolume: 0.35,
};

export const DEFAULT_GAP_MS = 180;

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'цвет задаётся в hex, например #0E1116');

const sceneSchema = z
  .object({
    say: z.string().optional(),
    display: z.string().optional(),
    gapMs: z.number().int().min(0).max(10000).optional(),
    fallbackMs: z.number().int().positive().max(60000).optional(),
  })
  .strict()
  .refine((s) => (s.say && s.say.trim() !== '') || s.fallbackMs !== undefined, {
    message:
      'сцена без речи должна иметь явную длительность: добавь "say" (что произнести) либо "fallbackMs" (сколько миллисекунд держать кадр молча)',
  });

// Секция diagram — данные схемы для шаблона scheme@1 (движок Motion Canvas).
// Необязательная: ролики без неё (все kinetic@1) валидируются ровно как раньше.
//
// Связь с таймлайном: узел N рисуется и подсвечивается на сцене N из
// audio/timeline.json. Явное поле scene позволяет отвязаться от порядка — тогда
// шаг привязывается к указанной сцене, а не к своему индексу.
const diagramNodeSchema = z
  .object({
    id: z.string().min(1, 'у узла схемы нужен непустой id'),
    label: z.string().min(1, 'у узла схемы нужна подпись'),
    scene: z.number().int().min(0).optional(),
  })
  .strict();

const diagramEdgeSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().optional(),
  })
  .strict();

const diagramSchema = z
  .object({
    title: z.string().optional(),
    layout: z.enum(['vertical', 'horizontal']).optional(),
    nodes: z.array(diagramNodeSchema).min(2, 'в схеме нужно минимум два узла'),
    edges: z.array(diagramEdgeSchema).min(1, 'в схеме нужна минимум одна стрелка'),
  })
  .strict()
  .superRefine((d, ctx) => {
    const ids = new Set();
    d.nodes.forEach((n, i) => {
      if (ids.has(n.id)) {
        ctx.addIssue({ code: 'custom', path: ['nodes', i, 'id'], message: `id "${n.id}" повторяется` });
      }
      ids.add(n.id);
    });
    d.edges.forEach((e, i) => {
      for (const end of ['from', 'to']) {
        if (!ids.has(e[end])) {
          ctx.addIssue({
            code: 'custom',
            path: ['edges', i, end],
            message: `стрелка ведёт в несуществующий узел "${e[end]}"`,
          });
        }
      }
    });
  });

// Секция promo — что нарисовано на экране в шаблоне promo@1.
//
// Зачем отдельная секция, а не «шаблон сам знает». Содержимое карточки —
// заголовок, строки списка, счётчик — это данные ролика, ровно как узлы схемы
// для scheme@1. Захардкоженные в компоненте, они превращают шаблон в один
// конкретный ролик. Секция повторяет устройство diagram: панель N рисуется на
// сцене N таймлайна, поле scene позволяет отвязаться от порядка.
//
// Панелей два вида, и оба выбраны по надобности этого ролика, а не «на вырост»:
// title — заголовок в две краски, card — карточка интерфейса со списком.
const promoPanelBase = { scene: z.number().int().min(0).optional() };

const promoTitlePanelSchema = z.object({ kind: z.literal('title'), ...promoPanelBase }).strict();

const promoCardPanelSchema = z
  .object({
    kind: z.literal('card'),
    ...promoPanelBase,
    title: z.string().min(1, 'у карточки нужен заголовок'),
    // Верхняя граница не декоративная: высота карточки считается как
    // headerHeight + rows × rowHeight, и на пяти строках карточка доезжает до
    // плашки-субтитра. Лучше отказ на валидации, чем наползание в готовом mp4.
    rows: z
      .array(z.string().min(1, 'пустая строка списка ничего не показывает'))
      .min(1, 'в карточке нужна хотя бы одна строка')
      .max(4, 'больше четырёх строк не помещается над плашкой-субтитром'),
    counter: z
      .object({
        value: z.string().min(1, 'у счётчика нужно значение'),
        label: z.string().min(1, 'у счётчика нужна подпись — голая цифра ничего не значит'),
      })
      .strict()
      .optional(),
  })
  .strict();

const promoSchema = z
  .object({
    panels: z
      .array(z.discriminatedUnion('kind', [promoTitlePanelSchema, promoCardPanelSchema]))
      .min(1, 'в секции promo нужна хотя бы одна панель'),
  })
  .strict();

// Секция story — раскадровка поверх снятого видео (шаблон story@1).
//
// Устройство отличается от diagram/promo намеренно. Там панель привязана к
// индексу сцены таймлайна, потому что таймлайн задан синтезом: сколько наговорил
// ElevenLabs, столько и сцена. Здесь наоборот — дорожка одна и непрерывная,
// монтажа нет вовсе, поэтому сцена задаётся отрезком времени внутри неё. Границы
// ставятся по фактическим паузам в речи, их даёт транскрипт исходника.
//
// kind решает, что нарисовано поверх кадра. Видеослой при этом идёт всегда:
// фулскрин-сцены его закрывают непрозрачной графикой, но звук не прерывается —
// иначе на врезке пропадал бы голос.
const storyRange = {
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
};

const storyTalkingHead = z
  .object({
    kind: z.literal('talkingHead'),
    ...storyRange,
    // Кикер необязателен: сцена без него — чистое лицо с одними субтитрами, это
    // рабочее состояние, а не недоделка.
    kicker: z.string().min(1).optional(),
  })
  .strict();

// Обе метафоры описываются одной формой: заголовок и пояснение под ним. Рисуются
// разной графикой (недострой против палатки), но данных им нужно одинаково.
const storyMetaphor = z
  .object({
    kind: z.enum(['house', 'tent']),
    ...storyRange,
    title: z.string().min(1, 'у сцены-метафоры нужен заголовок'),
    note: z.string().min(1, 'без пояснения метафора не читается'),
  })
  .strict();

// Врезки-доказательства: галочка, которую перечёркивает крест, и строки
// документа под проверкой. Форма одна на обе — заголовок обязателен, пояснение
// нет: у финальной врезки под фигурой стоит вывод, у промежуточной хватает
// одной строки.
const storyProof = z
  .object({
    kind: z.enum(['checkCross', 'scan']),
    ...storyRange,
    title: z.string().min(1, 'у врезки нужен заголовок'),
    note: z.string().min(1).optional(),
  })
  .strict();

// Видеовставка: отдельный клип поверх основного слоя.
//
// Звук у неё всегда выключен — речь идёт непрерывным дублем под низом, и
// вторая дорожка её перебила бы. Длительность сцены задаётся startMs/endMs,
// клип обязан быть не короче: недостающие кадры Remotion добьёт последним,
// и вставка «замёрзнет».
const storyInsert = z
  .object({
    kind: z.literal('insert'),
    ...storyRange,
    clip: z.string().min(1, 'у вставки нужно имя файла в assets'),
  })
  .strict();

// Лупа: под увеличением в строке видно слово, которое врёт.
const storyLens = z
  .object({
    kind: z.literal('lens'),
    ...storyRange,
    title: z.string().min(1, 'у врезки нужен вывод в заголовке'),
    // Длина ограничена шириной холста фигуры: строка рисуется в одну линию,
    // перенос не предусмотрен — на трёх секундах читать две строки некогда.
    text: z.string().min(1).max(26, 'строка не влезает в одну линию'),
    flaw: z.string().min(1).max(14, 'слово-дефект длиннее 14 знаков не помещается под стекло'),
  })
  .strict();

// Акцент — короткая фраза во весь экран.
//
// Появился 11.08.2026 после разбора ритма: между 18,9 и 34,7 с ролик шёл
// 15,8 секунды без единого визуального события, втрое дольше любой паузы в
// первой половине. Отличается от statement тем, что закрывает кадр целиком, а
// не лежит панелью поверх лица: панель на 3 секунды читается как мигание, а
// фулскрин — как акцент.
const storyAccent = z
  .object({
    kind: z.literal('accent'),
    ...storyRange,
    text: z.string().min(1, 'у акцента нужен текст'),
  })
  .strict();

const storyStatement = z
  .object({
    kind: z.literal('statement'),
    ...storyRange,
    // Две строки — не стилистика, а замер. Панель стоит над субтитрами, а её
    // потолок задан положением подбородка говорящего: 200 px, то есть две
    // строки кегля 56. Третья строка садится на рот. Отказ на валидации дешевле
    // рендера, который придётся переделывать после просмотра.
    lines: z.array(z.string().min(1)).min(1).max(2, 'больше двух строк не помещается: панель садится говорящему на рот'),
    // Ряд значков нейросетей над строками. Поднимает панель примерно на 100 px,
    // поэтому годится только там, где подбородок выше 1300 — проверяется по
    // замеру кадра, а не на глаз.
    glyphs: z.boolean().optional(),
  })
  .strict();

const storyQuestions = z
  .object({
    kind: z.literal('questions'),
    ...storyRange,
    wrong: z.string().min(1, 'нужен неверный вопрос — он зачёркивается'),
    right: z.string().min(1, 'нужен верный вопрос'),
  })
  .strict();

const storyCompare = z
  .object({
    kind: z.literal('compare'),
    ...storyRange,
    badLabel: z.string().min(1),
    goodLabel: z.string().min(1),
  })
  .strict();

const storyCta = z
  .object({
    kind: z.literal('cta'),
    ...storyRange,
    text: z.string().min(1, 'у CTA нужен текст действия'),
  })
  .strict();

const storySchema = z
  .object({
    // Путь к видеофайлу относительно папки ролика. Это подготовленный прокси
    // (1080×1920, 30 fps), а не исходник с камеры: оригинал 1728×3072@60 весит
    // сотни мегабайт и тормозит и Studio, и рендер. Готовит его
    // scripts/prepare-source.mjs.
    source: z.string().min(1, 'нужен путь к видеофайлу ролика'),
    scenes: z
      .array(
        z.discriminatedUnion('kind', [
          storyTalkingHead,
          storyMetaphor,
          storyProof,
          storyInsert,
          storyLens,
          storyAccent,
          storyStatement,
          storyQuestions,
          storyCompare,
          storyCta,
        ]),
      )
      .min(1, 'в раскадровке нужна хотя бы одна сцена'),
  })
  .strict()
  .superRefine((s, ctx) => {
    // Дыра между сценами — это кадры, которые не покрыты ничем: зритель видит
    // голое видео там, где ожидался следующий блок. Наложение — две графики
    // друг на друге. И то и другое ловится здесь, а не глазами в готовом mp4.
    s.scenes.forEach((sc, i) => {
      if (sc.endMs <= sc.startMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenes', i, 'endMs'],
          message: `сцена ${i} кончается раньше, чем начинается (${sc.startMs} → ${sc.endMs})`,
        });
      }
      if (i > 0 && sc.startMs !== s.scenes[i - 1].endMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenes', i, 'startMs'],
          message:
            `сцена ${i} начинается на ${sc.startMs} мс, а предыдущая кончилась на ${s.scenes[i - 1].endMs} мс — ` +
            `сцены идут встык, без дыр и наложений`,
        });
      }
    });
  });

export const videoSchema = z
  .object({
    template: z.enum(TEMPLATES),
    // У story@1 речь снята, а не синтезирована — голоса ElevenLabs нет вовсе.
    // Требовать voiceId с такого ролика значит заставлять писать в файл
    // неправду. Для остальных шаблонов поле остаётся обязательным (refine ниже).
    voiceId: z.string().min(1, 'voiceId обязателен — это id голоса ElevenLabs').optional(),
    bg: hexColor.optional(),
    accent: hexColor.optional(),
    music: z.string().min(1).nullable().optional(),
    musicVolume: z.number().min(0).max(1).optional(),
    diagram: diagramSchema.optional(),
    promo: promoSchema.optional(),
    story: storySchema.optional(),
    // Сцены синтеза не нужны story@1: там дорожка снята целиком, а раскадровка
    // живёт в секции story. Обязательность для остальных шаблонов восстановлена
    // проверкой ниже.
    scenes: z.array(sceneSchema).min(1, 'нужна хотя бы одна сцена').optional(),
  })
  .strict()
  .refine((v) => v.template === 'story@1' || v.voiceId !== undefined, {
    path: ['voiceId'],
    message: 'voiceId обязателен — это id голоса ElevenLabs',
  })
  .refine((v) => v.template === 'story@1' || v.scenes !== undefined, {
    path: ['scenes'],
    message: 'нужна хотя бы одна сцена',
  })
  .refine((v) => v.template !== 'story@1' || v.story !== undefined, {
    path: ['story'],
    message: 'шаблон story@1 рисует раскадровку поверх снятого видео — без секции "story" рисовать нечего',
  })
  .refine((v) => v.template !== 'story@1' || v.scenes === undefined, {
    path: ['scenes'],
    message: 'у story@1 речь снята, а не синтезирована — секция "scenes" здесь не используется, раскадровка лежит в "story.scenes"',
  })
  .refine((v) => v.template !== 'scheme@1' || v.diagram !== undefined, {
    path: ['diagram'],
    message: 'шаблон scheme@1 рисует схему — без секции "diagram" рисовать нечего',
  })
  .refine((v) => v.template !== 'promo@1' || v.promo !== undefined, {
    path: ['promo'],
    message: 'шаблон promo@1 рисует интерфейс — без секции "promo" рисовать нечего',
  })
  .superRefine((v, ctx) => {
    // Панель, привязанная к несуществующей сцене, не появится на экране никогда.
    // Молча это выглядит как «шаблон не работает», поэтому ловим на валидации.
    v.promo?.panels.forEach((p, i) => {
      const scene = p.scene ?? i;
      if (scene >= (v.scenes?.length ?? 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['promo', 'panels', i, 'scene'],
          message: `панель привязана к сцене ${scene}, а сцен всего ${v.scenes.length}`,
        });
      }
    });
  });

const formatIssue = (issue) => {
  const where = issue.path.length ? issue.path.join('.') : 'корень файла';
  return `  • ${where}: ${issue.message}`;
};

/** Разбирает и нормализует video.json. Бросает Error с читаемым текстом. */
export function parseVideoJson(raw, { file = 'video.json' } = {}) {
  const res = videoSchema.safeParse(raw);
  if (!res.success) {
    throw new Error(
      `Файл ${file} не проходит проверку:\n${res.error.issues.map(formatIssue).join('\n')}\n` +
        `Поддерживаемые поля: template, voiceId, bg, accent, music, musicVolume, scenes[].say, scenes[].display, scenes[].gapMs, scenes[].fallbackMs, ` +
        `diagram.title, diagram.layout, diagram.nodes[].{id,label,scene}, diagram.edges[].{from,to,label}, ` +
        `promo.panels[].{kind,scene} + для kind:"card" — title, rows[], counter.{value,label}, ` +
        `story.source, story.scenes[].{kind,startMs,endMs} + по kind: talkingHead — kicker; house/tent — title, note; ` +
        `accent — text; statement — lines[]; questions — wrong, right; compare — badLabel, goodLabel; cta — text.`,
    );
  }
  const v = res.data;
  return {
    template: v.template,
    // Пустая строка, а не undefined: потребители (tts.mjs) читают поле напрямую,
    // и у них шаблон всегда синтезируемый — до story@1 они не доходят.
    voiceId: v.voiceId ?? '',
    bg: v.bg ?? RENDER_DEFAULTS.bg,
    accent: v.accent ?? RENDER_DEFAULTS.accent,
    music: v.music ?? RENDER_DEFAULTS.music,
    musicVolume: v.musicVolume ?? RENDER_DEFAULTS.musicVolume,
    // Ролик без схемы получает diagram: null — потребителю не нужно различать
    // «поля не было» и «схемы нет».
    diagram: v.diagram
      ? {
          title: v.diagram.title ?? '',
          layout: v.diagram.layout ?? 'vertical',
          nodes: v.diagram.nodes.map((n, i) => ({ id: n.id, label: n.label, scene: n.scene ?? i })),
          edges: v.diagram.edges.map((e) => ({ from: e.from, to: e.to, label: e.label ?? '' })),
        }
      : null,
    // Как и diagram: ролик без секции получает promo: null, потребителю не нужно
    // различать «поля не было» и «панелей нет». Привязка к сцене нормализуется
    // здесь, чтобы шаблон не думал про «а если scene не задан».
    promo: v.promo
      ? {
          panels: v.promo.panels.map((p, i) =>
            p.kind === 'card'
              ? {
                  kind: 'card',
                  scene: p.scene ?? i,
                  title: p.title,
                  rows: [...p.rows],
                  counter: p.counter ? { value: p.counter.value, label: p.counter.label } : null,
                }
              : { kind: 'title', scene: p.scene ?? i },
          ),
        }
      : null,
    // Как diagram и promo: ролик без раскадровки получает story: null.
    story: v.story ? { source: v.story.source, scenes: v.story.scenes.map((s) => ({ ...s })) } : null,
    scenes: (v.scenes ?? []).map((s) => ({
      say: s.say ?? '',
      display: s.display ?? s.say ?? '',
      gapMs: s.gapMs ?? DEFAULT_GAP_MS,
      fallbackMs: s.fallbackMs,
    })),
  };
}

import { z } from 'zod';
import { zColor } from '@remotion/zod-types';

export const kineticSchema = z.object({
  slug: z.string(),
  bg: zColor(),
  accent: zColor(),
  music: z.string().nullable(),
  musicVolume: z.number().min(0).max(1),
});

export type KineticProps = z.infer<typeof kineticSchema>;

// У promo@1 набор настраиваемых в Studio полей тот же: slug, цвета, музыка.
// Содержимое панелей в схему пропсов не входит намеренно — это не настройка
// рендера, а данные ролика, и правится оно в video.json, а не мышкой в форме.
export const promoSchema = kineticSchema;

export type PromoProps = z.infer<typeof promoSchema>;

// У story@1 набор настраиваемых полей уже: музыки нет вовсе (ролик разговорный,
// подложка спорит с плотной речью), accent живёт в токенах шаблона — палитра
// метафор осмысленная, а не декоративная: тёплый цвет означает «решает задачу»,
// холодный — «стройка». Менять его мышкой в Studio значит ломать этот смысл.
export const storySchema = z.object({
  slug: z.string(),
  bg: zColor(),
});

export type StoryProps = z.infer<typeof storySchema>;

export type Caption = {
  text: string; startMs: number; endMs: number;
  timestampMs: number | null; confidence: number | null;
};

export type Timeline = {
  fps: number;
  totalFrames: number;
  slug?: string;
  voiceId: string;
  scenes: {
    index: number; display: string; audioFile: string | null;
    startFrame: number; durationFrames: number; captions: Caption[];
  }[];
};

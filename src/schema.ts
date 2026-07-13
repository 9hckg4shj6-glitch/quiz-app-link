import { z } from "zod";

export const cardSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().nullable(),
  builtIn: z.boolean(),
  kind: z.enum(["basic", "multiple-choice", "term"]),
  deckId: z.string().min(1),
  front: z.string().trim().min(1),
  back: z.string(),
  choices: z.array(z.string()),
  correctChoiceIndex: z.number().int().nonnegative().nullable(),
  explanation: z.string(),
  field: z.string(),
  source: z.string(),
  tags: z.array(z.string()),
  image: z.string().nullable(),
  imageAlt: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
}).superRefine((card, ctx) => {
  if (card.kind === "multiple-choice") {
    if (card.choices.length < 2) {
      ctx.addIssue({ code: "custom", path: ["choices"], message: "選択問題には2個以上の選択肢が必要です" });
    }
    if (card.correctChoiceIndex === null || card.correctChoiceIndex >= card.choices.length) {
      ctx.addIssue({ code: "custom", path: ["correctChoiceIndex"], message: "正解の選択肢を指定してください" });
    }
  }
});

export const importBundleSchema = z.object({
  app: z.literal("metabolism-study"),
  schemaVersion: z.literal(2),
  exportedAt: z.string().datetime(),
  cards: z.array(cardSchema),
  decks: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    order: z.number(),
  })),
  reviewEvents: z.array(z.object({
    id: z.string(),
    cardId: z.string(),
    deviceId: z.string(),
    rating: z.number().int().min(1).max(4),
    reviewedAt: z.string().datetime(),
    durationMs: z.number().nullable(),
  })),
});

export type ImportBundle = z.infer<typeof importBundleSchema>;

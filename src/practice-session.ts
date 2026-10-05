import { z } from "zod";
import { db } from "./db";

const index = z.number().int().nonnegative();
const rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable();
const partAnswer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("short-text"), text: z.string() }),
  z.object({ kind: z.literal("long-text"), text: z.string() }),
  z.object({ kind: z.literal("numeric"), rawValue: z.string(), normalizedValue: z.number().nullable(), unit: z.string() }),
  z.object({ kind: z.literal("drawing"), mode: z.enum(["canvas", "paper"]), strokes: z.array(z.object({
    tool: z.enum(["pen", "eraser"]), color: z.string(), width: z.number(),
    points: z.array(z.object({ x: z.number(), y: z.number(), pressure: z.number().optional() })),
  })) }),
]);

export const practiceSessionSchema = z.object({
  version: z.literal(1), id: z.string().min(1), subjectId: z.string().min(1),
  label: z.string(), updatedAt: z.string(), startedAt: z.number(),
  batch: z.boolean(), pageIndex: index, xpGained: index,
  correct: index, streak: index, maxStreak: index, leveledUp: index,
  entries: z.array(z.object({
    questionId: z.string(), fingerprint: z.string(), type: z.enum(["choice", "constructed"]),
    choiceOrder: z.array(index), picks: z.array(index), revealed: z.boolean(), graded: z.boolean(),
    rating, feedback: z.object({ isCorrect: z.boolean(), gainXP: index, mult: z.number() }).nullable(),
    written: z.object({
      answers: z.record(z.string(), partAnswer), submitted: z.boolean(), finalized: z.boolean(),
      selected: z.array(z.string()), giveUp: z.boolean(), durationMs: z.number(),
      startedAt: z.number(), rating, gainXP: index, mult: z.number(),
    }).nullable(),
  })).min(1),
  pages: z.array(z.object({ questionIds: z.array(z.string()).min(1), deferred: z.boolean() })).min(1),
  wrongList: z.array(z.object({ questionId: z.string(), chosen: z.string() })),
});

export type PracticeSessionSnapshot = z.infer<typeof practiceSessionSchema>;

/** A single serialized queue prevents an older save from overtaking a later save or deletion. */
let pending: Promise<unknown> = Promise.resolve();
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = pending.catch(() => undefined).then(operation);
  pending = next;
  return next;
}

export function savePracticeSession(input: unknown): Promise<void> {
  const snapshot = practiceSessionSchema.parse(input);
  return enqueue(async () => { await db.practiceSessions.put(snapshot); });
}

export async function getPracticeSession(subjectId: string): Promise<PracticeSessionSnapshot | null> {
  await pending.catch(() => undefined);
  const row = await db.practiceSessions.get(subjectId);
  if (!row) return null;
  const parsed = practiceSessionSchema.safeParse(row);
  if (!parsed.success) throw new Error("保存データが壊れているため再開できません。破棄して新しく開始してください。");
  return parsed.data;
}

export function deletePracticeSession(subjectId: string): Promise<void> {
  return enqueue(() => db.practiceSessions.delete(subjectId));
}

export function clearPracticeSessions(): Promise<void> {
  return enqueue(() => db.practiceSessions.clear());
}

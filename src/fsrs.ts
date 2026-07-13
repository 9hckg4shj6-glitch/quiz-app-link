import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";
import { db, enqueue, getDeviceId, nowIso, uuid } from "./db";
import type { LegacyProgress, ReviewEvent, ReviewRating, StoredSchedule } from "./types";

const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
});

export function legacyToFsrs(progress: LegacyProgress, now = new Date()): FsrsCard {
  const stored = progress.fsrs;
  if (stored) return storedToCard(stored);

  const reps = Math.max(0, progress.reps ?? 0);
  if (!reps && !progress.lastReviewed) return createEmptyCard(now);

  const interval = Math.max(1, progress.interval ?? 1);
  const ease = Math.max(1.3, Math.min(2.8, progress.ease ?? 2.5));
  const due = progress.due ? new Date(`${progress.due}T12:00:00`) : new Date(now.getTime() + interval * 86_400_000);
  const lastReview = progress.lastReviewed
    ? new Date(`${progress.lastReviewed}T12:00:00`)
    : new Date(due.getTime() - interval * 86_400_000);

  return {
    due,
    stability: interval,
    difficulty: Math.max(1, Math.min(10, 11 - ease * 2.6)),
    elapsed_days: interval,
    scheduled_days: interval,
    learning_steps: 0,
    reps,
    lapses: Math.max(0, progress.wrong ?? 0),
    state: State.Review,
    last_review: lastReview,
  };
}

export function cardToStored(cardId: string, card: FsrsCard): StoredSchedule {
  return {
    cardId,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review?.toISOString() ?? null,
    updatedAt: nowIso(),
  };
}

export function storedToCard(card: StoredSchedule): FsrsCard {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.lastReview ? new Date(card.lastReview) : undefined,
  };
}

function toDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function scheduleReview(
  cardId: string,
  progress: LegacyProgress,
  rating: ReviewRating,
  reviewedAt = new Date(),
  durationMs: number | null = null,
): LegacyProgress {
  const result = scheduler.next(legacyToFsrs(progress, reviewedAt), reviewedAt, rating as Grade);
  const stored = cardToStored(cardId, result.card);
  progress.reps = result.card.reps;
  progress.interval = Math.max(0, result.card.scheduled_days);
  progress.due = toDateOnly(result.card.due);
  progress.lastReviewed = toDateOnly(reviewedAt);
  progress.fsrs = stored;
  void persistReview(cardId, rating, stored, reviewedAt, durationMs);
  return progress;
}

async function persistReview(
  cardId: string,
  rating: ReviewRating,
  schedule: StoredSchedule,
  reviewedAt: Date,
  durationMs: number | null,
): Promise<void> {
  const event: ReviewEvent = {
    id: uuid(),
    ownerId: null,
    cardId,
    deviceId: await getDeviceId(),
    rating,
    reviewedAt: reviewedAt.toISOString(),
    durationMs,
    syncedAt: null,
  };
  await db.transaction("rw", db.reviewEvents, db.schedules, db.outbox, async () => {
    await db.reviewEvents.add(event);
    await db.schedules.put(schedule);
    await enqueue("review_events", event.id, "upsert", event as unknown as Record<string, unknown>);
  });
  window.dispatchEvent(new CustomEvent("study:review-saved", { detail: event }));
}

export async function rebuildScheduleFromEvents(cardId: string): Promise<StoredSchedule> {
  const events = await db.reviewEvents.where("cardId").equals(cardId).sortBy("reviewedAt");
  const ordered = events.sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.id.localeCompare(b.id));
  let card = createEmptyCard(new Date(ordered[0]?.reviewedAt ?? Date.now()));
  for (const event of ordered) card = scheduler.next(card, new Date(event.reviewedAt), event.rating as Grade).card;
  const stored = cardToStored(cardId, card);
  await db.schedules.put(stored);
  return stored;
}

export async function undoLastReview(cardId: string): Promise<StoredSchedule | null> {
  const events = await db.reviewEvents.where("cardId").equals(cardId).sortBy("reviewedAt");
  const latest = events.at(-1);
  if (!latest) return null;
  await db.reviewEvents.delete(latest.id);
  const queued = await db.outbox.where("recordId").equals(latest.id).toArray();
  await db.outbox.bulkDelete(queued.flatMap((item) => item.seq == null ? [] : [item.seq]));
  if (latest.syncedAt || latest.ownerId) {
    await enqueue("review_events", latest.id, "delete", latest as unknown as Record<string, unknown>);
  }
  return rebuildScheduleFromEvents(cardId);
}

export const ratingLabels: Record<ReviewRating, string> = {
  [Rating.Again]: "もう一度",
  [Rating.Hard]: "難しい",
  [Rating.Good]: "できた",
  [Rating.Easy]: "簡単",
};

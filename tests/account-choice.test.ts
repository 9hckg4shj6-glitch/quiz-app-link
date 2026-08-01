import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_ENTRY_CHOICE_KEY,
  getAccountEntryChoice,
  saveAccountEntryChoice,
} from "../src/account-choice";

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  });
});

describe("account entry choice", () => {
  it("未選択の端末では選択画面の対象になる", () => {
    expect(getAccountEntryChoice()).toBeNull();
  });

  it.each(["login", "guest"] as const)("%sを選ぶと同じ端末では再表示しない", (choice) => {
    saveAccountEntryChoice(choice);
    expect(localStorage.setItem).toHaveBeenCalledWith(ACCOUNT_ENTRY_CHOICE_KEY, choice);
    expect(getAccountEntryChoice()).toBe(choice);
  });

  it("不明な値は未選択として扱う", () => {
    values.set(ACCOUNT_ENTRY_CHOICE_KEY, "unknown");
    expect(getAccountEntryChoice()).toBeNull();
  });
});

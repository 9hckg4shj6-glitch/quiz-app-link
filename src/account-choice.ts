export type AccountEntryChoice = "login" | "guest";

export const ACCOUNT_ENTRY_CHOICE_KEY = "account_entry_choice_v1";

export function getAccountEntryChoice(): AccountEntryChoice | null {
  try {
    const value = localStorage.getItem(ACCOUNT_ENTRY_CHOICE_KEY);
    return value === "login" || value === "guest" ? value : null;
  } catch {
    return null;
  }
}

export function saveAccountEntryChoice(choice: AccountEntryChoice): void {
  try { localStorage.setItem(ACCOUNT_ENTRY_CHOICE_KEY, choice); } catch { /* noop */ }
}

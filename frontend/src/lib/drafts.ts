// Unsent answers are kept in this browser, so a reload never loses typing.
// Storage can be unavailable (private mode, blocked site data), so every
// access is guarded and the app works without it.

const key = (questionId: string) => `interact:draft:${questionId}`

export function loadDraft(questionId: string): string {
  try {
    return localStorage.getItem(key(questionId)) ?? ''
  } catch {
    return ''
  }
}

export function saveDraft(questionId: string, text: string): void {
  try {
    if (text) localStorage.setItem(key(questionId), text)
    else localStorage.removeItem(key(questionId))
  } catch {
    // Not saved; the answer still lives in the page.
  }
}

export function clearDraft(questionId: string): void {
  saveDraft(questionId, '')
}

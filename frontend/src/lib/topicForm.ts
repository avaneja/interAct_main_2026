import type { Difficulty } from '../api/types'

export const MAX_TEXT = 200
const MAX_SUBTOPICS = 20

export interface Draft {
  topic: string
  goal: string
  level: Difficulty | ''
  subtopics: string
}

export const EMPTY: Draft = { topic: '', goal: '', level: '', subtopics: '' }

export function parseSubtopics(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function validateDraft(draft: Draft): Partial<Record<keyof Draft, string>> {
  const errors: Partial<Record<keyof Draft, string>> = {}
  const topic = draft.topic.trim()
  if (!topic) errors.topic = 'Enter a topic to practise.'
  else if (topic.length > MAX_TEXT) errors.topic = `Keep the topic under ${MAX_TEXT} characters.`
  if (draft.goal.trim().length > MAX_TEXT) errors.goal = `Keep the goal under ${MAX_TEXT} characters.`
  const subtopics = parseSubtopics(draft.subtopics)
  const lowered = subtopics.map((s) => s.toLowerCase())
  if (subtopics.length > MAX_SUBTOPICS) errors.subtopics = `Use at most ${MAX_SUBTOPICS} subtopics.`
  else if (subtopics.some((s) => s.length > MAX_TEXT)) errors.subtopics = `Keep each subtopic under ${MAX_TEXT} characters.`
  else if (new Set(lowered).size !== lowered.length) errors.subtopics = 'Each subtopic should appear only once.'
  return errors
}

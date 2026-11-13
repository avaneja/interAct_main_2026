import type { Difficulty, QuestionCount, QuestionType, SessionState } from '../api/types'

export const QUESTION_STYLES: { value: QuestionType; label: string; description: string; example: string }[] = [
  { value: 'DIRECT', label: 'Direct', description: 'Definitions and facts.', example: 'Define overfitting.' },
  {
    value: 'CONCEPTUAL',
    label: 'Conceptual',
    description: 'Why and how things work.',
    example: 'Why can cross-validation beat one train/test split?',
  },
  {
    value: 'CASE_BASED',
    label: 'Case-based',
    description: 'Diagnose a concrete case.',
    example: 'A model has 98% accuracy on an imbalanced dataset. Diagnose the result.',
  },
  {
    value: 'SCENARIO_BASED',
    label: 'Scenario-based',
    description: 'Decide what you would do in a situation.',
    example: 'Your deployed model starts underperforming. What do you investigate?',
  },
  {
    value: 'APPLICATION',
    label: 'Application',
    description: 'Design a solution or plan.',
    example: 'Design an evaluation strategy for an imbalanced classifier.',
  },
  {
    value: 'MIXED',
    label: 'Mixed',
    description: 'Every style equally, from recall to application.',
    example: 'Direct, conceptual, case, scenario, then application.',
  },
]

export const styleLabel = (type: QuestionType) => QUESTION_STYLES.find((s) => s.value === type)?.label ?? type

export const DIFFICULTIES: { value: Difficulty; label: string; description: string }[] = [
  { value: 'beginner', label: 'Beginner', description: 'Core ideas, no edge cases.' },
  { value: 'intermediate', label: 'Intermediate', description: 'Applying ideas and comparing options.' },
  { value: 'advanced', label: 'Advanced', description: 'Edge cases and subtle trade-offs.' },
]

export const difficultyLabel = (value: Difficulty) => DIFFICULTIES.find((d) => d.value === value)?.label ?? value

export const QUESTION_COUNTS: QuestionCount[] = [5, 10, 15]

export const STATE_LABELS: Record<SessionState, string> = {
  PREPARING: 'Setting up',
  CONFIGURING: 'Choosing settings',
  READY: 'Ready to start',
  IN_PROGRESS: 'In progress',
  EVALUATING: 'Scoring interrupted',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
}

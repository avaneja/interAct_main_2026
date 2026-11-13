// Shapes of the backend's /api/v1 requests and responses (backend/app/schemas).

export type InputModel = 'TOPIC' | 'DOCUMENT'

export type SessionState =
  | 'PREPARING'
  | 'CONFIGURING'
  | 'READY'
  | 'IN_PROGRESS'
  | 'EVALUATING'
  | 'PAUSED'
  | 'COMPLETED'

export type QuestionType =
  | 'DIRECT'
  | 'CONCEPTUAL'
  | 'CASE_BASED'
  | 'SCENARIO_BASED'
  | 'APPLICATION'
  | 'MIXED'

export type Difficulty = 'beginner' | 'intermediate' | 'advanced'

export type QuestionCount = 5 | 10 | 15

export interface InterviewContext {
  input_model: InputModel
  topic: string
  goal?: string | null
  level?: Difficulty | null
  subtopics: string[]
  document_id?: string | null
  selected_topic_ids?: string[]
}

export interface InterviewConfig {
  question_type: QuestionType
  difficulty: Difficulty
  question_count: QuestionCount
  adaptive: boolean
  feedback_timing: 'END'
  avatar_key?: string | null
}

export interface PlannedQuestion {
  sequence: number
  question_type: Exclude<QuestionType, 'MIXED'>
  competency: string
}

export interface SessionView {
  id: string
  input_model: InputModel
  state: SessionState
  context: InterviewContext | null
  config: InterviewConfig | null
  questions_asked: number
  questions_answered: number
  plan: PlannedQuestion[] | null
  created_at: string
  updated_at: string
}

export interface QuestionView {
  id: string
  sequence: number
  type: Exclude<QuestionType, 'MIXED'>
  competency: string
  difficulty: Difficulty
  prompt: string
  source_chunk_ids: string[]
  grounding_status: 'VERIFIED' | 'FLAGGED' | 'NOT_APPLICABLE'
}

export interface AnswerResult {
  state: SessionState
  next_question: QuestionView | null
  completed: boolean
}

export interface CriterionResult {
  name: string
  score: number
  max_score: number
  evidence_quote: string | null
  reason: string
}

export interface QuestionReport {
  sequence: number
  type: Exclude<QuestionType, 'MIXED'>
  competency: string
  difficulty: Difficulty
  prompt: string
  answer: string | null
  evaluation: {
    score: number
    max_score: number
    percent: number | null
    criteria: CriterionResult[]
    missing_concepts: string[]
    insufficient_evidence: boolean
    insufficient_reason: string | null
  } | null
  better_answer_outline: string[]
  answer_key: { key_points: string[] } | null
}

export interface CompetencyScore {
  score: number
  max_score: number
  questions: number
  percent: number | null
}

export interface ReportSummary {
  label: string
  score: number
  max_score: number
  percent: number | null
  planned_questions: number | null
  answered_questions: number
  ended_early: boolean
  duration_seconds: number
  configuration: InterviewConfig
  topic: string | null
  competencies: Record<string, CompetencyScore>
  coverage: { planned: string[]; covered: string[]; not_covered: string[]; percent: number | null }
  missing_concepts: string[]
  areas_to_revise: string[]
  notices: string[]
  questions: QuestionReport[]
}

export interface ReportView {
  session_id: string
  generated_at: string
  summary: ReportSummary
}

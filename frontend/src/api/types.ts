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
  /** 0 for a planned question, 1 or more for the interviewer's follow-ups to it. */
  follow_up: number
  /** What the interviewer says just before the question: a reaction and a transition. */
  lead_in: string | null
  type: Exclude<QuestionType, 'MIXED'>
  competency: string
  difficulty: Difficulty
  prompt: string
  source_chunk_ids: string[]
  grounding_status: 'VERIFIED' | 'FLAGGED' | 'NOT_APPLICABLE'
}

export interface AnswerResult {
  state: SessionState
  /** Null after the last planned question: the wrap-up, until the interview is finished. */
  next_question: QuestionView | null
  completed: boolean
  /** What the interviewer says about the answer (also the start of the next question's lead_in). */
  reaction: string | null
}

/** How an answer was given, measured in the browser. Numbers only; never part of the score. */
export interface DeliverySignals {
  answer_seconds: number
  spoken: boolean
  tab_switches?: number
  seconds_away?: number
  fullscreen_exits?: number
  camera?: {
    looking_away_ratio: number
    look_aways: number
    face_missing_ratio: number
    multiple_faces_ratio: number
  }
}

export type ChatStage = 'warm_up' | 'closing'

/** The candidate's request, reply or skip; the planner's question or scope summary. */
export type PreparationKind = 'request' | 'reply' | 'skip' | 'question' | 'summary'

export interface PreparationMessage {
  role: 'user' | 'assistant'
  kind: PreparationKind
  content: string
}

/** The Model A clarification chat and the draft scope it has produced so far. */
export interface PreparationView {
  messages: PreparationMessage[]
  /** The draft scope; not confirmed until it is saved with setContext. */
  context: InterviewContext | null
  /** The planner's question waiting for a reply, if any. */
  question: string | null
  /** The scope has been summarised. */
  done: boolean
  questions_asked: number
  max_questions: number
}

/** The candidate's next turn: a reply, skipping the question, or asking for no more questions. */
export interface PrepareTurn {
  text?: string
  skip?: boolean
  enough?: boolean
}

export interface ChatReply {
  reply: string
  /** True when the closing conversation is over. */
  done: boolean
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
  /** The interviewer's follow-up questions and the candidate's replies, scored with the answer. */
  follow_ups: { prompt: string; answer: string | null }[]
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
  /** How the answers were given; null when nothing was measured. Never part of the score. */
  delivery: DeliverySummary | null
}

export interface DeliverySummary {
  answers_measured: number
  speaking_seconds: number
  words_per_minute: number | null
  filler_words: number
  fillers_per_100_words: number | null
  tab_switches: number
  seconds_away: number
  fullscreen_exits: number
  camera: {
    answers: number
    looking_away_ratio: number | null
    look_aways: number
    face_missing_ratio: number | null
    multiple_faces_ratio: number | null
  } | null
  note: string
}

export interface ReportView {
  session_id: string
  generated_at: string
  summary: ReportSummary
}

export type SignInProvider = 'google' | 'github'

export interface Me {
  id: string
  provider: SignInProvider | 'dev'
  email: string | null
  display_name: string | null
  default_avatar_key: string | null
}

export interface SignInOptions {
  providers: SignInProvider[]
  dev_login: boolean
}

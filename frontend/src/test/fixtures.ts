import type { QuestionView, ReportView, SessionView } from '../api/types'

export function makeSession(overrides: Partial<SessionView> = {}): SessionView {
  return {
    id: 's-1',
    input_model: 'TOPIC',
    state: 'IN_PROGRESS',
    context: { input_model: 'TOPIC', topic: 'Operating systems', goal: 'internship', level: 'beginner', subtopics: ['processes', 'memory'] },
    config: { question_type: 'MIXED', difficulty: 'intermediate', question_count: 5, adaptive: true, feedback_timing: 'END' },
    questions_asked: 1,
    questions_answered: 0,
    created_at: '2026-11-13T10:00:00Z',
    updated_at: '2026-11-13T10:05:00Z',
    ...overrides,
  }
}

export function makeQuestion(overrides: Partial<QuestionView> = {}): QuestionView {
  return {
    id: 'q-1',
    sequence: 1,
    type: 'DIRECT',
    competency: 'processes',
    difficulty: 'intermediate',
    prompt: 'What is a process?',
    source_chunk_ids: [],
    grounding_status: 'NOT_APPLICABLE',
    ...overrides,
  }
}

export function makeReport(): ReportView {
  return {
    session_id: 's-1',
    generated_at: '2026-11-13T10:20:00Z',
    summary: {
      label: 'Rubric-based practice estimate',
      score: 12,
      max_score: 20,
      percent: 60,
      planned_questions: 5,
      answered_questions: 2,
      ended_early: true,
      duration_seconds: 600,
      configuration: { question_type: 'MIXED', difficulty: 'intermediate', question_count: 5, adaptive: true, feedback_timing: 'END' },
      topic: 'Operating systems',
      competencies: {
        processes: { score: 9, max_score: 10, questions: 1, percent: 90 },
        memory: { score: 3, max_score: 10, questions: 1, percent: 30 },
      },
      coverage: { planned: ['processes', 'memory', 'scheduling'], covered: ['processes', 'memory'], not_covered: ['scheduling'], percent: 67 },
      missing_concepts: ['paging'],
      areas_to_revise: ['memory', 'scheduling'],
      notices: ['The interview was ended early, so some planned questions were not asked.'],
      questions: [
        {
          sequence: 1,
          type: 'DIRECT',
          competency: 'processes',
          difficulty: 'intermediate',
          prompt: 'What is a process?',
          answer: 'A running program with its own memory.',
          evaluation: {
            score: 9,
            max_score: 10,
            percent: 90,
            criteria: [{ name: 'correctness', score: 3, max_score: 3, evidence_quote: 'its own memory', reason: 'Accurate.' }],
            missing_concepts: [],
            insufficient_evidence: false,
            insufficient_reason: null,
          },
          better_answer_outline: ['Mention the process control block.'],
          answer_key: null,
        },
        {
          sequence: 2,
          type: 'CONCEPTUAL',
          competency: 'memory',
          difficulty: 'intermediate',
          prompt: 'Why does paging help?',
          answer: 'I like pizza.',
          evaluation: {
            score: 3,
            max_score: 10,
            percent: 30,
            criteria: [{ name: 'correctness', score: 0, max_score: 3, evidence_quote: null, reason: 'Off topic.' }],
            missing_concepts: ['paging'],
            insufficient_evidence: true,
            insufficient_reason: 'the answer does not address the question or its topic',
          },
          better_answer_outline: [],
          answer_key: null,
        },
        {
          sequence: 3,
          type: 'CASE_BASED',
          competency: 'scheduling',
          difficulty: 'intermediate',
          prompt: 'Diagnose this scheduler.',
          answer: null,
          evaluation: null,
          better_answer_outline: [],
          answer_key: null,
        },
      ],
    },
  }
}

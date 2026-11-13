import type {
  AnswerResult,
  InputModel,
  InterviewConfig,
  InterviewContext,
  QuestionView,
  ReportView,
  SessionView,
} from './types'

// Empty in development (Vite proxies /api to the backend); set
// VITE_API_BASE_URL when the frontend and backend are hosted apart.
const BASE_URL = `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1`

/** An error the backend reported, or a failure to reach it (status 0). */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }

  /** The model failed and nothing was saved as a score; the same request can be retried. */
  get isRetryable(): boolean {
    return this.status === 503 || this.status === 0
  }
}

interface ValidationIssue {
  loc?: (string | number)[]
  msg: string
}

function describe(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    // FastAPI validation errors: [{ loc: ["body", "topic"], msg: "..." }]
    return (detail as ValidationIssue[])
      .map((issue) => {
        const field = issue.loc?.filter((part) => part !== 'body').join('.')
        return field ? `${field}: ${issue.msg}` : issue.msg
      })
      .join('; ')
  }
  return fallback
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'Cannot reach the InterAct server. Check that the backend is running, then try again.')
  }

  if (!response.ok) {
    let detail: unknown
    try {
      detail = (await response.json()).detail
    } catch {
      detail = undefined
    }
    throw new ApiError(response.status, describe(detail, `The server answered with an error (HTTP ${response.status}).`))
  }
  return (await response.json()) as T
}

const session = (id: string, action = '') => `/sessions/${encodeURIComponent(id)}${action ? `/${action}` : ''}`

export const api = {
  createSession: (inputModel: InputModel) => request<SessionView>('POST', '/sessions', { input_model: inputModel }),
  listSessions: (signal?: AbortSignal) => request<SessionView[]>('GET', '/sessions', undefined, signal),
  getSession: (id: string, signal?: AbortSignal) => request<SessionView>('GET', session(id), undefined, signal),
  setContext: (id: string, context: InterviewContext) => request<SessionView>('PUT', session(id, 'context'), context),
  setConfig: (id: string, config: InterviewConfig) => request<SessionView>('PUT', session(id, 'config'), config),
  confirmPlan: (id: string) => request<SessionView>('POST', session(id, 'confirm')),
  start: (id: string) => request<QuestionView>('POST', session(id, 'start')),
  currentQuestion: (id: string, signal?: AbortSignal) =>
    request<QuestionView>('GET', session(id, 'current-question'), undefined, signal),
  submitAnswer: (id: string, questionId: string, text: string) =>
    request<AnswerResult>('POST', session(id, 'answers'), { question_id: questionId, text }),
  retry: (id: string) => request<AnswerResult>('POST', session(id, 'retry')),
  pause: (id: string) => request<SessionView>('POST', session(id, 'pause')),
  resume: (id: string) => request<SessionView>('POST', session(id, 'resume')),
  finish: (id: string) => request<SessionView>('POST', session(id, 'finish')),
  report: (id: string, signal?: AbortSignal) => request<ReportView>('GET', session(id, 'report'), undefined, signal),
}

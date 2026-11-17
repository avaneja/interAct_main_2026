import type {
  AnswerResult,
  ChatReply,
  ChatStage,
  DeliverySignals,
  InputModel,
  InterviewConfig,
  InterviewContext,
  Me,
  QuestionView,
  ReportView,
  SessionView,
  SignInOptions,
  SignInProvider,
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

type Listener = () => void
const signedOutListeners = new Set<Listener>()

/**
 * Call `listener` whenever the server answers 401, which means the user is
 * signed out (for example their session cookie expired). Returns an unsubscribe.
 */
export function onSignedOut(listener: Listener): () => void {
  signedOutListeners.add(listener)
  return () => signedOutListeners.delete(listener)
}

export function notifySignedOut() {
  signedOutListeners.forEach((listener) => listener())
}

/** Where the browser goes to sign in with a provider; a full page load, not a fetch. */
export function signInUrl(provider: SignInProvider, next: string): string {
  return `${BASE_URL}/auth/${provider}/login?${new URLSearchParams({ next })}`
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
    if (response.status === 401) notifySignedOut()
    let detail: unknown
    try {
      detail = (await response.json()).detail
    } catch {
      detail = undefined
    }
    throw new ApiError(response.status, describe(detail, `The server answered with an error (HTTP ${response.status}).`))
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

const session = (id: string, action = '') => `/sessions/${encodeURIComponent(id)}${action ? `/${action}` : ''}`

export const api = {
  me: (signal?: AbortSignal) => request<Me>('GET', '/auth/me', undefined, signal),
  signInOptions: (signal?: AbortSignal) => request<SignInOptions>('GET', '/auth/providers', undefined, signal),
  devSignIn: () => request<void>('POST', '/auth/dev/login'),
  signOut: () => request<void>('POST', '/auth/logout'),
  createSession: (inputModel: InputModel) => request<SessionView>('POST', '/sessions', { input_model: inputModel }),
  listSessions: (signal?: AbortSignal) => request<SessionView[]>('GET', '/sessions', undefined, signal),
  getSession: (id: string, signal?: AbortSignal) => request<SessionView>('GET', session(id), undefined, signal),
  setContext: (id: string, context: InterviewContext) => request<SessionView>('PUT', session(id, 'context'), context),
  setConfig: (id: string, config: InterviewConfig) => request<SessionView>('PUT', session(id, 'config'), config),
  confirmPlan: (id: string) => request<SessionView>('POST', session(id, 'confirm')),
  start: (id: string) => request<QuestionView>('POST', session(id, 'start')),
  currentQuestion: (id: string, signal?: AbortSignal) =>
    request<QuestionView>('GET', session(id, 'current-question'), undefined, signal),
  submitAnswer: (id: string, questionId: string, text: string, delivery?: DeliverySignals) =>
    request<AnswerResult>('POST', session(id, 'answers'), { question_id: questionId, text, delivery }),
  retry: (id: string) => request<AnswerResult>('POST', session(id, 'retry')),
  chat: (id: string, stage: ChatStage, text: string) => request<ChatReply>('POST', session(id, 'chat'), { stage, text }),
  pause: (id: string) => request<SessionView>('POST', session(id, 'pause')),
  resume: (id: string) => request<SessionView>('POST', session(id, 'resume')),
  finish: (id: string) => request<SessionView>('POST', session(id, 'finish')),
  report: (id: string, signal?: AbortSignal) => request<ReportView>('GET', session(id, 'report'), undefined, signal),
}

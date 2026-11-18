import type { InputModel, SessionState } from '../api/types'

/** The page where a session in this state continues. */
export function pathForSession(id: string, state: SessionState, inputModel: InputModel = 'TOPIC'): string {
  switch (state) {
    case 'PREPARING':
      return inputModel === 'DOCUMENT' ? `/sessions/${id}/document` : `/sessions/${id}/prepare`
    case 'CONFIGURING':
      return `/sessions/${id}/configure`
    case 'READY':
      return `/sessions/${id}/plan`
    case 'IN_PROGRESS':
    case 'EVALUATING':
    case 'PAUSED':
      return `/sessions/${id}/interview`
    case 'COMPLETED':
      return `/sessions/${id}/report`
  }
}

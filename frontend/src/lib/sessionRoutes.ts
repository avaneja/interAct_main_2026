import type { SessionState } from '../api/types'

/** The page where a session in this state continues. */
export function pathForSession(id: string, state: SessionState): string {
  switch (state) {
    case 'PREPARING':
      return `/sessions/${id}/topic`
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

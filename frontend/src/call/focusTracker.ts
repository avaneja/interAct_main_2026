/**
 * Counts, while the candidate answers, how often they leave the interview:
 * switching tab or window, and leaving full screen. Numbers only; nothing
 * about other tabs or windows is read.
 */
export interface FocusCounts {
  tab_switches: number
  seconds_away: number
  fullscreen_exits: number
}

export interface FocusTracker {
  /** Start counting for a new answer, from zero. */
  reset: () => void
  /** The counts since the last reset. */
  read: () => FocusCounts
  stop: () => void
}

export function startFocusTracker(doc: Document = document, now: () => number = () => Date.now()): FocusTracker {
  let tabSwitches = 0
  let fullscreenExits = 0
  let awayMs = 0
  let awaySince: number | null = doc.hidden ? now() : null
  let wasFullScreen = doc.fullscreenElement != null

  const leave = () => {
    if (awaySince !== null) return
    awaySince = now()
    tabSwitches++
  }
  const comeBack = () => {
    if (awaySince === null) return
    awayMs += now() - awaySince
    awaySince = null
  }
  const onVisibility = () => (doc.hidden ? leave() : comeBack())
  const onFullScreen = () => {
    const isFullScreen = doc.fullscreenElement != null
    if (wasFullScreen && !isFullScreen) fullscreenExits++
    wasFullScreen = isFullScreen
  }
  const view = doc.defaultView
  doc.addEventListener('visibilitychange', onVisibility)
  doc.addEventListener('fullscreenchange', onFullScreen)
  view?.addEventListener('blur', leave)
  view?.addEventListener('focus', comeBack)

  return {
    reset() {
      tabSwitches = 0
      fullscreenExits = 0
      awayMs = 0
      awaySince = doc.hidden ? now() : null
    },
    read() {
      const ongoing = awaySince === null ? 0 : now() - awaySince
      return {
        tab_switches: tabSwitches,
        seconds_away: Math.round((awayMs + ongoing) / 100) / 10,
        fullscreen_exits: fullscreenExits,
      }
    },
    stop() {
      doc.removeEventListener('visibilitychange', onVisibility)
      doc.removeEventListener('fullscreenchange', onFullScreen)
      view?.removeEventListener('blur', leave)
      view?.removeEventListener('focus', comeBack)
    },
  }
}

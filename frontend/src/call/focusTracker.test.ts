import { describe, expect, it } from 'vitest'
import { startFocusTracker } from './focusTracker'

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

function setFullScreen(on: boolean) {
  Object.defineProperty(document, 'fullscreenElement', { value: on ? document.body : null, configurable: true })
  document.dispatchEvent(new Event('fullscreenchange'))
}

describe('the focus tracker', () => {
  it('counts tab switches and the time away', () => {
    let time = 0
    const tracker = startFocusTracker(document, () => time)

    setHidden(true)
    time = 4000
    setHidden(false)
    window.dispatchEvent(new Event('blur'))
    time = 5500
    window.dispatchEvent(new Event('focus'))

    expect(tracker.read()).toEqual({ tab_switches: 2, seconds_away: 5.5, fullscreen_exits: 0 })
    tracker.stop()
  })

  it('counts a hidden tab and a lost window focus at the same moment once', () => {
    let time = 0
    const tracker = startFocusTracker(document, () => time)

    setHidden(true)
    window.dispatchEvent(new Event('blur'))
    time = 2000
    window.dispatchEvent(new Event('focus'))
    setHidden(false)

    expect(tracker.read().tab_switches).toBe(1)
    expect(tracker.read().seconds_away).toBe(2)
    tracker.stop()
  })

  it('includes time away that is still going on', () => {
    let time = 0
    const tracker = startFocusTracker(document, () => time)
    setHidden(true)
    time = 3000

    expect(tracker.read().seconds_away).toBe(3)
    setHidden(false)
    tracker.stop()
  })

  it('counts leaving full screen, not entering it', () => {
    const tracker = startFocusTracker()

    setFullScreen(true)
    setFullScreen(false)
    setFullScreen(true)

    expect(tracker.read().fullscreen_exits).toBe(1)
    setFullScreen(false)
    tracker.stop()
  })

  it('starts each answer from zero', () => {
    let time = 0
    const tracker = startFocusTracker(document, () => time)
    setHidden(true)
    time = 1000
    setHidden(false)

    tracker.reset()

    expect(tracker.read()).toEqual({ tab_switches: 0, seconds_away: 0, fullscreen_exits: 0 })
    tracker.stop()
  })

  it('stops counting once stopped', () => {
    const tracker = startFocusTracker()
    tracker.stop()

    setHidden(true)
    setHidden(false)

    expect(tracker.read().tab_switches).toBe(0)
  })
})

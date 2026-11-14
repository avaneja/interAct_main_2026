import { useEffect, useState, type RefObject } from 'react'

/** Follow whether `target` is shown full screen, and switch it on or off. */
export function useFullScreen(target: RefObject<HTMLElement | null>) {
  const [fullScreen, setFullScreen] = useState(false)

  useEffect(() => {
    const update = () => setFullScreen(document.fullscreenElement !== null && document.fullscreenElement === target.current)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [target])

  const enter = async () => {
    try {
      await target.current?.requestFullscreen?.()
    } catch {
      // Full screen is a nicety: the call works without it.
    }
  }
  const exit = async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
  }
  return { fullScreen, enter, exit, toggle: () => (fullScreen ? exit() : enter()) }
}

/**
 * The page to return to after signing in. Only paths inside InterAct are
 * allowed, so a crafted link cannot send someone to another site; the backend
 * applies the same rule.
 */
export function safeNext(path: string | null): string {
  if (path && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') && !path.startsWith('/sign-in')) {
    return path
  }
  return '/'
}

/** The sign-in page, remembering where to go afterwards. */
export function signInPath(next: string): string {
  const target = safeNext(next)
  return target === '/' ? '/sign-in' : `/sign-in?${new URLSearchParams({ next: target })}`
}

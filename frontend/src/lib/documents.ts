/** Helpers for Model B: uploading notes and showing their pages. */

export const MAX_UPLOAD_MB = 20
export const POLL_MS = 1000
const ACCEPTED = ['.pdf', '.txt']

/** "Lecture 5.pdf" → "Lecture 5": the interview's topic. */
export const titleOf = (filename: string) => filename.replace(/\.[^.]+$/, '').trim() || filename

export function pagesLabel(pages: number[]): string {
  if (pages.length === 0) return ''
  const first = pages[0]
  const last = pages[pages.length - 1]
  return first === last ? `Page ${first}` : `Pages ${first}–${last}`
}

/** Why a file cannot be uploaded, checked before sending it; the server checks again. */
export function fileProblem(file: File): string | null {
  const name = file.name.toLowerCase()
  if (!ACCEPTED.some((extension) => name.endsWith(extension))) {
    return 'Choose a PDF or TXT file. Other formats, such as DOCX and PPTX, are not supported yet.'
  }
  if (file.size === 0) return 'The file is empty.'
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `The file is larger than ${MAX_UPLOAD_MB} MB.`
  return null
}

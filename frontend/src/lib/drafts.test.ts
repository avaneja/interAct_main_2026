import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearDraft, loadDraft, saveDraft } from './drafts'

afterEach(() => vi.restoreAllMocks())

describe('answer drafts', () => {
  it('saves, loads and clears a draft per question', () => {
    saveDraft('q-1', 'first')
    saveDraft('q-2', 'second')

    expect(loadDraft('q-1')).toBe('first')
    clearDraft('q-1')
    expect(loadDraft('q-1')).toBe('')
    expect(loadDraft('q-2')).toBe('second')
  })

  it('keeps working when the browser blocks storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })

    expect(() => saveDraft('q-1', 'text')).not.toThrow()
    expect(loadDraft('q-1')).toBe('')
  })
})

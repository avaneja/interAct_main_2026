import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import type { DocumentSummary, DocumentView } from '../api/types'
import { fileProblem, pagesLabel } from '../lib/documents'
import { makeSession } from '../test/fixtures'
import type { MockedApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

vi.mock('../api/client', async (importOriginal) =>
  (await import('../test/mockApi')).mockApiModule(importOriginal))

const mockedApi = api as unknown as MockedApi

function documentView(overrides: Partial<DocumentView> = {}): DocumentView {
  return {
    id: 'd-1',
    filename: 'Lecture 5.pdf',
    status: 'READY',
    summary: { summary: 'Notes on evaluating models.', pages: 12, chunks: 9 },
    created_at: '2026-11-19T10:00:00Z',
    expires_at: '2026-12-19T10:00:00Z',
    job_id: 'j-1',
    ...overrides,
  }
}

function summary(overrides: Partial<DocumentView> = {}): DocumentSummary {
  return {
    document: documentView(overrides),
    topics: [
      { id: 't-1', name: 'Cross-validation', summary: 'Folds held out in turn.', pages: [3, 4], chunks: 2 },
      { id: 't-2', name: 'Precision and recall', summary: 'Two views of positives.', pages: [7], chunks: 1 },
    ],
  }
}

const pdf = (name = 'Lecture 5.pdf', size = 10) => new File(['x'.repeat(size)], name, { type: 'application/pdf' })

beforeEach(() => {
  mockedApi.listDocuments.mockResolvedValue([])
})

describe('document helpers', () => {
  it('describes page ranges', () => {
    expect(pagesLabel([3, 4, 5])).toBe('Pages 3–5')
    expect(pagesLabel([7])).toBe('Page 7')
    expect(pagesLabel([])).toBe('')
  })

  it('checks the file before uploading', () => {
    expect(fileProblem(pdf())).toBeNull()
    expect(fileProblem(pdf('notes.TXT'))).toBeNull()
    expect(fileProblem(pdf('slides.pptx'))).toMatch(/PDF or TXT/)
    expect(fileProblem(pdf('empty.pdf', 0))).toBe('The file is empty.')
    expect(fileProblem(pdf('huge.pdf', 21 * 1024 * 1024))).toMatch(/larger than 20 MB/)
  })
})

describe('uploading notes', () => {
  it('refuses another format without uploading it', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderApp('/new/document')

    await user.upload(await screen.findByLabelText('Your notes'), pdf('essay.docx'))
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    expect(screen.getByText(/Choose a PDF or TXT file/)).toBeInTheDocument()
    expect(mockedApi.uploadDocument).not.toHaveBeenCalled()
  })

  it('uploads, waits while the notes are read, then shows their topics', async () => {
    mockedApi.uploadDocument.mockResolvedValue(documentView({ status: 'UPLOADED', summary: null }))
    mockedApi.documentSummary
      .mockResolvedValueOnce({ document: documentView({ status: 'PROCESSING', summary: null }), topics: [] })
      .mockResolvedValue(summary())
    const user = userEvent.setup()
    renderApp('/new/document')

    await user.upload(await screen.findByLabelText('Your notes'), pdf())
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    expect(await screen.findByText('Reading Lecture 5.pdf…')).toBeInTheDocument()
    expect(await screen.findByText('Cross-validation', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('Notes on evaluating models.')).toBeInTheDocument()
    expect(screen.getByText('Pages 3–4')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Cross-validation/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Precision and recall/ })).toBeChecked()
  })

  it('creates the interview from the chosen topics and moves to settings', async () => {
    mockedApi.uploadDocument.mockResolvedValue(documentView())
    mockedApi.documentSummary.mockResolvedValue(summary())
    mockedApi.createSession.mockResolvedValue(makeSession({ input_model: 'DOCUMENT', state: 'PREPARING' }))
    mockedApi.setContext.mockResolvedValue(makeSession({ input_model: 'DOCUMENT', state: 'CONFIGURING', config: null, plan: null }))
    mockedApi.getSession.mockResolvedValue(makeSession({ input_model: 'DOCUMENT', state: 'CONFIGURING', config: null, plan: null }))
    const user = userEvent.setup()
    const router = renderApp('/new/document')

    await user.upload(await screen.findByLabelText('Your notes'), pdf())
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    await user.click(await screen.findByRole('checkbox', { name: /Precision and recall/ }))
    await user.click(screen.getByRole('button', { name: 'Continue with 1 topic' }))

    expect(mockedApi.createSession).toHaveBeenCalledWith('DOCUMENT')
    expect(mockedApi.setContext).toHaveBeenCalledWith('s-1', {
      input_model: 'DOCUMENT', topic: 'Lecture 5', subtopics: [], document_id: 'd-1', selected_topic_ids: ['t-1'],
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions/s-1/configure'))
  })

  it('needs at least one topic', async () => {
    mockedApi.uploadDocument.mockResolvedValue(documentView())
    mockedApi.documentSummary.mockResolvedValue(summary())
    const user = userEvent.setup()
    renderApp('/new/document')

    await user.upload(await screen.findByLabelText('Your notes'), pdf())
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    await user.click(await screen.findByRole('checkbox', { name: /Cross-validation/ }))
    await user.click(screen.getByRole('checkbox', { name: /Precision and recall/ }))
    await user.click(screen.getByRole('button', { name: 'Continue with 0 topics' }))

    expect(screen.getByText('Choose at least one topic.')).toBeInTheDocument()
    expect(mockedApi.createSession).not.toHaveBeenCalled()
  })

  it('explains why notes could not be read and can try again', async () => {
    mockedApi.uploadDocument.mockResolvedValue(documentView({ status: 'UPLOADED', summary: null }))
    mockedApi.documentSummary
      .mockResolvedValueOnce({ document: documentView({ status: 'FAILED', summary: { error: 'This PDF looks scanned.' } }), topics: [] })
      .mockResolvedValue(summary())
    mockedApi.processDocument.mockResolvedValue(documentView({ status: 'UPLOADED', summary: null }))
    const user = userEvent.setup()
    renderApp('/new/document')

    await user.upload(await screen.findByLabelText('Your notes'), pdf())
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    expect(await screen.findByText('This PDF looks scanned.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(mockedApi.processDocument).toHaveBeenCalledWith('d-1')
    expect(await screen.findByText('Cross-validation')).toBeInTheDocument()
  })

  it('shows a server refusal', async () => {
    mockedApi.uploadDocument.mockRejectedValue(new ApiError(413, 'The file is larger than 20 MB.'))
    const user = userEvent.setup()
    renderApp('/new/document')

    await user.upload(await screen.findByLabelText('Your notes'), pdf())
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    expect(await screen.findByText('The file is larger than 20 MB.')).toBeInTheDocument()
  })
})

describe('earlier uploads', () => {
  it('can be reused or deleted', async () => {
    mockedApi.listDocuments.mockResolvedValue([documentView(), documentView({ id: 'd-2', filename: 'Old notes.txt' })])
    mockedApi.deleteDocument.mockResolvedValue(undefined)
    mockedApi.documentSummary.mockResolvedValue(summary())
    const user = userEvent.setup()
    renderApp('/new/document')

    const uploads = await screen.findByRole('list', { name: 'Your uploads' })
    await user.click(within(uploads).getByRole('button', { name: 'Delete Old notes.txt' }))
    await waitFor(() => expect(within(uploads).queryByText('Old notes.txt')).not.toBeInTheDocument())
    expect(mockedApi.deleteDocument).toHaveBeenCalledWith('d-2')

    await user.click(within(uploads).getByRole('button', { name: 'Use' }))
    expect(await screen.findByText('Cross-validation')).toBeInTheDocument()
  })
})

describe('changing the topics of an interview', () => {
  it('starts from the interview’s document and topics, without a new session', async () => {
    mockedApi.getSession.mockResolvedValue(makeSession({
      input_model: 'DOCUMENT', state: 'CONFIGURING', config: null, plan: null,
      context: { input_model: 'DOCUMENT', topic: 'Lecture 5', subtopics: ['Precision and recall'], document_id: 'd-1', selected_topic_ids: ['t-2'] },
    }))
    mockedApi.documentSummary.mockResolvedValue(summary())
    mockedApi.setContext.mockResolvedValue(makeSession({ input_model: 'DOCUMENT', state: 'CONFIGURING' }))
    const user = userEvent.setup()
    renderApp('/sessions/s-1/document')

    expect(await screen.findByRole('checkbox', { name: /Precision and recall/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Cross-validation/ })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Continue with 1 topic' }))

    expect(mockedApi.createSession).not.toHaveBeenCalled()
    expect(mockedApi.setContext).toHaveBeenCalledWith('s-1', expect.objectContaining({ selected_topic_ids: ['t-2'] }))
  })
})

import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// Pages update after async work; on a slow or busy machine that can take
// over the default one second. Passing tests still finish as soon as the
// page is ready.
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
  localStorage.clear()
})

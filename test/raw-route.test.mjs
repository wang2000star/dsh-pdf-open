/**
 * Route-level tests for the raw PDF handler.
 *
 * The handler is a pure fetch function over `ctx.fs`, so these run in plain
 * Node with a fake filesystem: no server, no authentication, no browser.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createPdfRawHandler, MAX_BYTES } from '../index.js'

const PDF = '/workspace/paper.pdf'
const BYTES = Uint8Array.from({ length: 1000 }, (_, index) => index % 251)

function fakeFs({ size = BYTES.byteLength, type = 'file' } = {}) {
  const reads = []
  return {
    reads,
    async resolve(path) {
      return { path, displayPath: path }
    },
    async stat() {
      return { type, size }
    },
    async readByteRange(_target, range) {
      reads.push(range)
      return BYTES.slice(range.offset, range.offset + range.length)
    },
  }
}

function get(query, headers = {}, method = 'GET') {
  return new Request(`http://127.0.0.1:3080/api/pdf-open/raw${query}`, {
    method,
    headers,
  })
}

test('serves the whole file with Range advertised', async () => {
  const fs = fakeFs()
  const response = await createPdfRawHandler(fs)(get(`?path=${encodeURIComponent(PDF)}`))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('accept-ranges'), 'bytes')
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.match(response.headers.get('content-disposition') ?? '', /^inline;/)
  assert.equal(response.headers.get('content-length'), '1000')
  assert.equal((await response.arrayBuffer()).byteLength, 1000)
  assert.deepEqual(fs.reads, [{ offset: 0, length: 1000 }])
})

test('answers HEAD without reading a body', async () => {
  const fs = fakeFs()
  const response = await createPdfRawHandler(fs)(get(`?path=${encodeURIComponent(PDF)}`, {}, 'HEAD'))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-length'), '1000')
  assert.equal(fs.reads.length, 0)
})

test('serves a bounded range as 206', async () => {
  const fs = fakeFs()
  const response = await createPdfRawHandler(fs)(
    get(`?path=${encodeURIComponent(PDF)}`, { range: 'bytes=100-199' }),
  )
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), 'bytes 100-199/1000')
  assert.equal(response.headers.get('content-length'), '100')
  assert.deepEqual(fs.reads, [{ offset: 100, length: 100 }])
})

test('clamps an open-ended range to the last byte', async () => {
  const fs = fakeFs()
  const response = await createPdfRawHandler(fs)(
    get(`?path=${encodeURIComponent(PDF)}`, { range: 'bytes=900-' }),
  )
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), 'bytes 900-999/1000')
  assert.deepEqual(fs.reads, [{ offset: 900, length: 100 }])
})

test('serves a suffix range', async () => {
  const fs = fakeFs()
  const response = await createPdfRawHandler(fs)(
    get(`?path=${encodeURIComponent(PDF)}`, { range: 'bytes=-64' }),
  )
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), 'bytes 936-999/1000')
})

test('rejects a range starting past the end with 416', async () => {
  const fs = fakeFs()
  const response = await createPdfRawHandler(fs)(
    get(`?path=${encodeURIComponent(PDF)}`, { range: 'bytes=5000-' }),
  )
  assert.equal(response.status, 416)
  assert.equal(response.headers.get('content-range'), 'bytes */1000')
})

test('ignores a malformed or multi-part range and serves 200', async () => {
  for (const range of ['bytes=abc', 'bytes=0-10,20-30']) {
    const response = await createPdfRawHandler(fakeFs())(
      get(`?path=${encodeURIComponent(PDF)}`, { range }),
    )
    assert.equal(response.status, 200)
  }
})

test('refuses non-pdf, relative, and trailing-NUL paths', async () => {
  for (const query of ['?path=/workspace/notes.txt', '?path=relative.pdf', '?path=/a%00b.pdf', '']) {
    const response = await createPdfRawHandler(fakeFs())(get(query))
    assert.equal(response.status, 400)
  }
})

test('refuses directories and oversized files', async () => {
  const directory = await createPdfRawHandler(fakeFs({ type: 'dir' }))(
    get(`?path=${encodeURIComponent(PDF)}`),
  )
  assert.equal(directory.status, 403)

  const huge = await createPdfRawHandler(fakeFs({ size: MAX_BYTES + 1 }))(
    get(`?path=${encodeURIComponent(PDF)}`),
  )
  assert.equal(huge.status, 413)
})

test('maps filesystem codes to HTTP statuses', async () => {
  const denied = fakeFs()
  denied.resolve = async () => {
    const error = new Error('denied')
    error.code = 'FS_SANDBOX_DENIED'
    throw error
  }
  const response = await createPdfRawHandler(denied)(get(`?path=${encodeURIComponent(PDF)}`))
  assert.equal(response.status, 403)

  const missing = fakeFs()
  missing.stat = async () => undefined
  const absent = await createPdfRawHandler(missing)(get(`?path=${encodeURIComponent(PDF)}`))
  assert.equal(absent.status, 404)
})

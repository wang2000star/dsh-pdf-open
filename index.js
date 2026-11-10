/**
 * Host half of dsh-pdf-open.
 *
 * The document preview's shipped "Open" control hands a file to the *server's*
 * desktop. On a headless server that lands nowhere. This plugin instead serves
 * the previewed PDF over the already-authenticated `/api` channel with real
 * Range support, so the browser's own PDF viewer (rotate, outline, find) can
 * stream it page by page.
 *
 * Security posture:
 *   - The connection carrier authenticates the request before the handler runs,
 *     exactly like the shipped `/api/file` route.
 *   - Paths go through `ctx.fs.resolve`, keeping the configured filesystem
 *     backend's sandbox and access policy.
 *   - Only regular `.pdf` files are served, and only inside a byte cap.
 */

import { basename } from 'node:path'

/** Exact route on the authenticated `/api` channel. */
export const ROUTE = '/api/pdf-open/raw'

/** Upper bound for one file. Range reads keep the per-request cost small. */
export const MAX_BYTES = 512 * 1024 * 1024

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
}

const FS_STATUS = {
  FS_NOT_FOUND: 404,
  FS_NOT_REGULAR_FILE: 403,
  FS_PERMISSION_DENIED: 403,
  FS_SANDBOX_DENIED: 403,
  FS_TOO_LARGE: 413,
  FS_ABORTED: 499,
}

function pdfHeaders(path, extra) {
  const name = basename(path).replace(/["\\\r\n]/g, '')
  return {
    ...BASE_HEADERS,
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    ...extra,
  }
}

function parseRange(header, size) {
  if (header === null) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return undefined
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return undefined
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined
    return { offset: Math.max(0, size - suffix), length: Math.min(suffix, size) }
  }
  const start = Number(rawStart)
  if (!Number.isSafeInteger(start)) return undefined
  const end = rawEnd === '' ? size - 1 : Number(rawEnd)
  if (!Number.isSafeInteger(end)) return undefined
  if (start >= size) return { unsatisfiable: true }
  if (end < start) return undefined
  const boundedEnd = Math.min(end, size - 1)
  return { offset: start, length: boundedEnd - start + 1 }
}

/**
 * Build the route handler over a filesystem backend.
 * @param fs - `ctx.fs`: resolve, stat and windowed reads with the deployment's policy.
 * @returns a fetch-shaped handler for one authenticated request.
 */
export function createPdfRawHandler(fs) {
  const fail = (request, status, text, extra) =>
    new Response(request.method === 'HEAD' ? null : text, {
      status,
      headers: { ...BASE_HEADERS, ...extra },
    })

  return async function fetchPdf(request) {
    const url = new URL(request.url)
    const path = url.searchParams.get('path')
    if (path === null || path.length === 0) return fail(request, 400, 'missing path')
    if (path.includes('\0') || !path.startsWith('/')) return fail(request, 400, 'absolute path required')
    if (!/\.pdf$/i.test(path)) return fail(request, 400, 'not a pdf')

    let target
    let info
    try {
      target = await fs.resolve(path, { signal: request.signal })
      info = await fs.stat(target, request.signal)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        return fail(request, FS_STATUS[error.code] ?? 500, String(error.code))
      }
      throw error
    }
    if (info === undefined) return fail(request, 404, 'not found')
    if (info.type !== 'file') return fail(request, 403, 'not a regular file')

    const size = info.size
    if (typeof size !== 'number' || !Number.isFinite(size)) {
      return fail(request, 500, 'unknown size')
    }
    if (size > MAX_BYTES) return fail(request, 413, 'file exceeds byte limit')

    const range = parseRange(request.headers.get('range'), size)
    if (range !== undefined && range.unsatisfiable) {
      return fail(request, 416, 'range not satisfiable', { 'Content-Range': `bytes */${size}` })
    }

    const status = range === undefined ? 200 : 206
    const headers = pdfHeaders(path, {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(range === undefined ? size : range.length),
      ...(range === undefined
        ? {}
        : { 'Content-Range': `bytes ${range.offset}-${range.offset + range.length - 1}/${size}` }),
    })

    if (request.method === 'HEAD') return new Response(null, { status, headers })

    let bytes
    try {
      bytes = range === undefined
        ? await fs.readByteRange(target, { offset: 0, length: size }, request.signal)
        : await fs.readByteRange(target, range, request.signal)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        return fail(request, FS_STATUS[error.code] ?? 500, String(error.code))
      }
      throw error
    }
    // Keep the announced length honest if the file shrank mid-read.
    headers['Content-Length'] = String(bytes.byteLength)
    return new Response(bytes.slice(), { status, headers })
  }
}

export const name = 'dsh-pdf-open'
export const inject = ['connection', 'fs']

/**
 * Register the raw-PDF route for this profile's lifetime.
 * @param ctx - host context providing connection and filesystem services.
 */
export function apply(ctx) {
  ctx.effect(
    () => {
      const dispose = ctx.connection.fetch.register({
        path: ROUTE,
        methods: ['GET', 'HEAD'],
        requestBody: 'streaming',
        fetch: createPdfRawHandler(ctx.fs),
      })
      return () => {
        void dispose()
      }
    },
    'dsh-pdf-open: raw pdf route',
  )
}

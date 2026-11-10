# dsh-pdf-open

[![ci](https://github.com/wang2000star/dsh-pdf-open/actions/workflows/ci.yml/badge.svg)](https://github.com/wang2000star/dsh-pdf-open/actions/workflows/ci.yml)

Adds **one button** to the DeepSeek Harness document preview: open the previewed
PDF in your browser's own PDF viewer.

That is the whole feature. It exists because the shipped preview renders PDFs
with PDF.js but exposes only fit-width and zoom — no rotation, no outline, no
find — and its "Open" control launches an application on the **host**, which is
useless when Harness runs on a headless server.

## What you get

- Rotation, document outline, `Ctrl+F` find, print, two-page view — the browser
  viewer's own, mature controls.
- Nothing is uploaded or converted: the bytes come from the same server, over the
  same authenticated channel, and are rendered locally by your browser.
- Your PDF is never modified and never leaves the session's filesystem policy.

## Requirements

- DeepSeek Harness with the Web UI (`dsh web`) and the right-side document
  preview. Developed against `0.2.1-rc.2`; it uses only the `connection`, `fs`
  host services and the `sidebar.right.tab.document.actions` slot.
- No build step, no runtime dependencies, no changes to Harness source.

## Install

From npm:

```sh
dsh plugin --profile web add dsh-pdf-open
```

Straight from this repository (no build step — the sources are the runtime files):

```sh
dsh plugin --profile web add github:wang2000star/dsh-pdf-open
```

From a local checkout:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-pdf-open
```

Then restart `dsh web` once (the host half is an ES module, and Node's module
cache means the route only appears after a restart), and refresh the page.

Uninstall:

```sh
dsh plugin --profile web remove dsh-pdf-open
```

## Usage

Open a PDF in the workspace file preview. A new icon appears in the preview
header, after the shipped controls. Click it; a new tab opens the same document
in the browser's PDF viewer.

## Why a separate route

`/api/file` (the shipped file route) reads the entire file into memory, returns
one buffered response, and sends no `Accept-Ranges`. A browser PDF viewer wants
range requests: it fetches the header, then only the pages you look at. Without
them the whole file must arrive before the first page paints, which is painful
on a remote server, and files above the route's byte cap fail with `413`
instead of opening at all.

Measured on one deployment, for a 56 MB, 14-page PDF over the authenticated
`/api` channel:

| Request | Result |
|---|---|
| `GET /api/file?path=…` (shipped) | `413 Payload Too Large`, 12-byte body |
| `GET /api/pdf-open/raw?path=…` | `200`, 58,809,929 bytes, `Accept-Ranges: bytes` |
| `Range: bytes=0-262143` | `206`, 262,144 bytes in 8 ms |
| `Range: bytes=50000000-` | `206`, `Content-Range: bytes 50000000-58809928/58809929` |
| `Range: bytes=99999999-` | `416`, `Content-Range: bytes */58809929` |

So the shipped route does not merely feel slow for files of this size: it refuses
them. That is what this route fixes.

This plugin registers `/api/pdf-open/raw`, which:

- advertises `Accept-Ranges: bytes` and answers `Range` with `206`;
- reads only the requested window through `ctx.fs.readByteRange`, so a bounded
  request never buffers the whole file;
- serves `application/pdf` with `Content-Disposition: inline` and no
  restrictive CSP, so the browser viewer takes over;
- caps one file at 512 MiB.

An `open-ended` request (`Range: bytes=0-`) still yields the whole remainder in
one response, which is what a viewer asks for before it knows the page offsets.
The win is that linearized PDFs then load page by page, the byte cap that made
`/api/file` answer `413` is gone, and the file is read once instead of being
buffered and copied.

## Security

- The route lives on the authenticated `/api` channel: Harness authenticates the
  request before the handler runs, exactly like the shipped file route.
- Paths pass through `ctx.fs.resolve`, so the configured filesystem backend's
  sandbox and access policy still apply.
- Only regular `.pdf` files are served.
- URLs carry the absolute host path; treat them as sensitive and do not paste
  them into public places.

## Limits

- Rotation and zoom are view state of the browser viewer: a reload returns to
  the document's own orientation. Use a PDF editor to rotate the file itself.
- One PDF per tab; no annotations, no OCR, no chat integration. If you want the
  model to read the document, use Harness's own tools or a full reader plugin.
- The previewed file must be previewable by the shipped renderer (the button
  only appears once the preview knows the file's host path).

## Tests

```sh
node --test test/
```

The route handler is a pure fetch function over `ctx.fs`, so the tests run in
plain Node against a fake filesystem: `200`, `HEAD`, `206`, suffix ranges, `416`,
malformed ranges, path validation, and filesystem error mapping.

## Implementation notes

- **GET/HEAD exact routes must use `requestBody: 'buffered'`.** The carrier's
  `streaming` mode wraps the socket in a `Request` with a body; the WHATWG
  constructor rejects a body for GET/HEAD, the error escapes the handler, and the
  web server's fallback answers an empty `400` that the browser renders as its
  own error page. This is the difference from the shipped `/api/file` route.
- **No `Content-Security-Policy` header.** The shipped file route sends
  `sandbox; default-src 'none'`. Chromium happens to render PDFs behind that
  header, but it is a viewer-implementation detail; this route omits it so the
  viewer is not at the mercy of that behavior.
- **`Accept-Ranges` is the whole point.** Without it the browser downloads the
  complete file before the first page paints.

## License

MIT

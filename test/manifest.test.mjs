/**
 * The bundle's contract with Harness is spread over three places that must
 * agree: the package name, the Client loader's factory id, and the Loader row
 * the patch inserts. Renaming any one of them alone yields a plugin that loads
 * but never renders, so pin all three here.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (name) => readFile(fileURLToPath(new URL(name, root)), 'utf8')

const manifest = JSON.parse(await read('package.json'))
const client = await read('client.js')
const patch = await read(manifest.dsh.bundle.patch)

test('the client factory id equals the package name', () => {
  const id = /window\.__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(client)
  assert.ok(id !== null, 'client.js must call window.__ModuleLoader__.load({ id, factory })')
  assert.equal(id[1], manifest.name)
})

test('the exports resolve to the files that ship', () => {
  assert.equal(manifest.exports['.'], './index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  const shipped = manifest.files.map((file) => file.replace(/^\.\//, ''))
  for (const file of ['index.js', 'client.js', manifest.dsh.bundle.patch.replace(/^\.\//, '')]) {
    assert.ok(shipped.includes(file), `${file} must be in "files" or the tarball omits it`)
  }
})

test('the patch inserts exactly one row named after the package', () => {
  const rows = [...patch.matchAll(/name:\s*'([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(rows, [manifest.name])
  assert.match(patch, /- insert:/)
})

test('the client half declares the slot package it depends on', () => {
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-documentpreview'))
})

/**
 * Build-integrity tests for the browser half.
 *
 * `lib/client.js` is generated from `lib/client/*.js` by
 * `scripts/build-client.mjs`, and it is committed because the package ships
 * `lib/` and the host serves exactly that one file. A generated file that is
 * committed can silently drift from its source, so this is the check that makes
 * that impossible to miss: it rebuilds in memory and compares.
 *
 * Nothing here renders. See `tests/client-plugin.test.js` for behaviour.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { compose, fragmentNames, MARKER } from '../scripts/build-client.mjs'

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'lib', 'client')
const BUNDLE = join(ROOT, 'lib', 'client.js')

/** The line budget one source file is expected to stay under. */
const LINE_BUDGET = 400

const readFragment = (name) => readFileSync(join(SRC, name), 'utf8')

test('lib/client.js is exactly what the fragments compose', () => {
  const expected = compose(readFragment, readFileSync(join(SRC, 'index.js'), 'utf8'))
  const actual = readFileSync(BUNDLE, 'utf8')
  assert.equal(actual, expected, 'lib/client.js is stale — run `node scripts/build-client.mjs`')
})

test('the template still has a splice point, so a rebuild cannot silently no-op', () => {
  assert.ok(readFileSync(join(SRC, 'index.js'), 'utf8').includes(MARKER))
})

test('the bundle is a classic script: no import or export statements', () => {
  const source = readFileSync(BUNDLE, 'utf8')
  // A DSH client bundle is served as a plain <script>; a stray ESM statement would
  // be a syntax error at load and the panel would never register.
  assert.equal(/^\s*import\s/m.test(source), false, 'no import statements')
  assert.equal(/^\s*export\s/m.test(source), false, 'no export statements')
})

test('every client source file stays within the line budget', () => {
  const over = ['index.js', ...fragmentNames()]
    .map((name) => ({ name, lines: readFragment(name).split('\n').length }))
    .filter((file) => file.lines > LINE_BUDGET)
  assert.deepEqual(over, [], `over ${LINE_BUDGET} lines: ${JSON.stringify(over)}`)
})

test('both locale dictionaries declare the same keys', () => {
  // The dictionaries are read out of the built bundle's source rather than
  // imported, because the bundle is a classic script with no export surface.
  const source = readFileSync(BUNDLE, 'utf8')
  const block = source.slice(source.indexOf('const STRINGS ='), source.indexOf('/* ---- lib/client/10-styles.js'))
  const zh = block.slice(block.indexOf('zh:'), block.indexOf('en:'))
  const en = block.slice(block.indexOf('en:'))
  const keysOf = (text) => [...text.matchAll(/'([a-zA-Z0-9._]+)':/g)].map((match) => match[1]).sort()
  assert.ok(keysOf(zh).length > 0, 'zh dictionary not found')
  assert.deepEqual(keysOf(en), keysOf(zh), 'zh and en must declare the same keys')
})

/** Every `.js` file under `lib/`, relative to the repo root. */
function libSourceFiles(dir = 'lib', out = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) libSourceFiles(rel, out)
    else if (entry.name.endsWith('.js')) out.push(rel)
  }
  return out
}

test('no hand-written source file exceeds the line budget', () => {
  // Two files are allowed to be long, for reasons that are about correctness
  // rather than taste:
  //
  // - `lib/learning-store.js` holds the `LearningStore` class, which is a 1:1
  //   port of the upstream Python store. Its data shape and free functions have
  //   already been moved to `lib/store/`; what remains is one cohesive class
  //   whose method-by-method correspondence with `state.py` is the audit surface
  //   the byte-equivalence suite depends on. Decomposing the class further is a
  //   design change, not a mechanical move, so it stays exempt until that is
  //   decided deliberately.
  // - `lib/client.js` is generated. The host serves exactly one bundle file per
  //   package, so its length is a platform constraint; the source it is built
  //   from lives in `lib/client/` and is budgeted separately above.
  const EXEMPT = new Set([join('lib', 'learning-store.js'), join('lib', 'client.js')])
  const over = libSourceFiles()
    .filter((rel) => !EXEMPT.has(rel))
    .map((rel) => ({ rel, lines: readFileSync(join(ROOT, rel), 'utf8').split('\n').length }))
    .filter((file) => file.lines > LINE_BUDGET)
  assert.deepEqual(over, [], `over ${LINE_BUDGET} lines: ${JSON.stringify(over)}`)
})

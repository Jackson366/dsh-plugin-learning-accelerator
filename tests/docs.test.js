/**
 * Package-structure checks.
 *
 * Upstream keeps a `tests/test_skill_structure.py` whose job is not to test
 * behaviour but to test *the package shape an installer depends on*: every file
 * the manifest names must exist, and every document a reader is pointed at must
 * be there. This is the same idea for a Node package, and it earns its keep:
 * the earlier `exports["."].types` pointed at a `lib/index.d.ts` that never
 * existed, and a renamed doc turns a README link into a 404 that no behavioural
 * test would notice.
 *
 * Nothing here loads the plugin; it only reads files.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import test from 'node:test'

const ROOT = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** Every markdown file a reader could be sent to from the repository root. */
function markdownFiles() {
  const found = ['README.md', 'CHANGELOG.md']
  for (const dir of ['docs', 'examples']) {
    const absolute = join(ROOT, dir)
    if (!existsSync(absolute)) continue
    for (const entry of readdirSync(absolute)) {
      if (entry.endsWith('.md')) found.push(join(dir, entry))
    }
  }
  return found.filter(file => existsSync(join(ROOT, file)))
}

/** Relative link targets in one markdown file, anchors and queries stripped. */
function relativeLinks(file) {
  const text = readFileSync(join(ROOT, file), 'utf8')
  const targets = []
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const raw = match[1]
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#') || raw.startsWith('/')) continue
    targets.push(raw.split('#')[0].split('?')[0])
  }
  return targets.map(target => ({ target, from: file })).filter(entry => entry.target.length > 0)
}

test('every relative markdown link resolves', () => {
  const broken = []
  for (const file of markdownFiles()) {
    for (const { target } of relativeLinks(file)) {
      const resolved = resolve(ROOT, dirname(file), target)
      if (!existsSync(resolved)) broken.push(`${file} → ${target}`)
    }
  }
  assert.deepEqual(broken, [], `broken relative links:\n${broken.join('\n')}`)
})

test('package.json exports point at files that exist', () => {
  const conditions = []
  const walk = (node, path) => {
    if (typeof node === 'string') conditions.push({ path, file: node })
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`)
    }
  }
  walk(pkg.exports, 'exports')
  assert.ok(conditions.length > 0, 'package.json declares no exports')
  for (const { path, file } of conditions) {
    assert.ok(existsSync(join(ROOT, file)), `${path} points at missing ${file}`)
  }
  // `main` is what a consumer without an exports map resolves.
  assert.ok(existsSync(join(ROOT, pkg.main)), `main points at missing ${pkg.main}`)
})

test('every path in package.json files exists, so npm cannot ship a hole', () => {
  for (const entry of pkg.files ?? []) {
    assert.ok(existsSync(join(ROOT, entry)), `files lists missing ${entry}`)
  }
  // The bundle layer and the browser half are how the harness finds this plugin
  // at all; a renamed file would install cleanly and then do nothing.
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.ok(existsSync(join(ROOT, 'cordis.patch.yml')))
  assert.equal(pkg.dsh?.client?.platform, 'web', 'dsh.client.platform must be web')
  assert.ok(existsSync(join(ROOT, pkg.exports['./client'])), 'the client bundle is missing')
})

test('the bundle patch row names this package', () => {
  const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
  const id = patch.match(/^\s*-\s*id:\s*(\S+)\s*$/m)?.[1]
  const name = patch.match(/^\s*name:\s*(\S+)\s*$/m)?.[1]
  // Loader identity: `id` is the stable diff key, `name` must be resolvable in
  // the profile's node_modules, which is what ties it to package.json.
  assert.equal(name, pkg.name, 'cordis.patch.yml must load this package by name')
  assert.ok(id, 'the patch row needs an id, or every reload remounts it')
})

test('documented counts match reality', () => {
  // The README states a test count and a file count. Keeping them honest is
  // cheaper here than in review, and a stale number is the first thing a reader
  // stops trusting.
  const testFiles = readdirSync(join(ROOT, 'tests')).filter(file => file.endsWith('.test.js'))
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const claimed = readme.match(/(\d+)\s+tests?\s+across\s+(\w+)\s+files/)
  if (claimed) {
    const [, tests, files] = claimed
    assert.equal(Number(files), testFiles.length, `README claims ${files} test files, found ${testFiles.length}`)
    assert.ok(Number(tests) > 0)
  }
  // Every test file must live under tests/ and end in .test.js, or `node --test
  // tests/` silently stops running it.
  for (const file of readdirSync(join(ROOT, 'tests'))) {
    assert.ok(file.endsWith('.test.js'), `${file} is not named *.test.js`)
    assert.ok(statSync(join(ROOT, 'tests', file)).isFile())
  }
})

test('the schema and the LICENSE the package ships are present and parseable', () => {
  const schema = JSON.parse(readFileSync(join(ROOT, 'schemas', 'learning_state.schema.json'), 'utf8'))
  assert.equal(schema.type, 'object')
  assert.ok(schema.$defs?.ConceptProgress)
  const license = readFileSync(join(ROOT, 'LICENSE'), 'utf8')
  assert.match(license, /^MIT License/m)
  assert.equal(pkg.license, 'MIT')
  // `files` is what decides whether any of this reaches the tarball.
  for (const entry of ['schemas', 'docs', 'examples', 'LICENSE', 'CHANGELOG.md']) {
    assert.ok(pkg.files.includes(entry), `${entry} is not shipped`)
  }
})

test('no source file writes learning state outside the store', () => {
  // `learning_record` is documented as the single write path, and the panel is
  // documented as read-only. A stray writeFile to a state path would break the
  // byte-equivalence guarantee this package is built on.
  //
  // The walk is recursive on purpose: `lib/` now has subdirectories
  // (`lib/store/`, `lib/tools/`, `lib/client/`), and a top-level-only scan would
  // silently stop covering them — which is exactly the hole a split could hide a
  // write in. If persistence ever moves out of `learning-store.js`, add the new
  // owner here deliberately rather than widening the allowlist by accident.
  const WRITERS = new Set([join('lib', 'learning-store.js')])
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.name.endsWith('.js')) files.push(relative(ROOT, absolute))
    }
  }
  walk(join(ROOT, 'lib'))

  const offenders = []
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8')
    for (const match of text.matchAll(/writeFileSync\(|appendFileSync\(/g)) {
      const line = text.slice(0, match.index).split('\n').length
      if (!WRITERS.has(file)) offenders.push(`${file}:${line}`)
    }
  }
  assert.deepEqual(offenders, [], `state writes outside the store: ${offenders.join(', ')}`)
})

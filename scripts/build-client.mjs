/**
 * Generate `lib/client.js` from the fragments in `lib/client/`.
 *
 * ## Why a build step exists in a package that has no bundler
 *
 * A DSH client bundle is one classic `<script>` per package: the host resolves
 * `exports["./client"]` to a single path (`clientExportOf` in
 * `@deepseek-ai/dsh-client-modules`) and the browser module table requires that
 * URL to register exactly one module id. `dsh.client` has no multi-entry field —
 * only `platform`, `inject`, `external`, `immediately`. So the *shipped* artifact
 * cannot be split, however much we would like the *source* to be.
 *
 * This script is the smallest thing that reconciles the two: it concatenates the
 * fragments in filename order into the one file the platform serves. It is a
 * concat, not a bundler — no transformation, no dependency graph, no minifier.
 * The fragments are ordinary script fragments that share the factory's scope, so
 * they must not use `import`/`export`; everything else about them is normal code.
 *
 * The output is committed, because the package ships `lib/` and consumers never
 * run this. `tests/client-build.test.js` fails when the committed file is stale,
 * so forgetting to rebuild is caught in CI rather than by a user.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'lib', 'client')
const TEMPLATE = join(SRC, 'index.js')
const OUT = join(ROOT, 'lib', 'client.js')

/** Where the fragment bodies are spliced into the template. */
export const MARKER = '/* @body */'

/** The fragment files, in the order they are concatenated. */
export function fragmentNames() {
  return readdirSync(SRC)
    .filter((name) => name.endsWith('.js') && name !== 'index.js')
    .sort()
}

/**
 * Compose the bundle text without touching the filesystem.
 *
 * Exported so the staleness test can rebuild in memory and diff, rather than
 * shelling out and comparing timestamps.
 *
 * @param {(name: string) => string} read - reads one fragment, relative to lib/client.
 * @param {string} template - the contents of lib/client/index.js.
 * @returns {string} the exact text lib/client.js should contain.
 */
export function compose(read, template) {
  if (!template.includes(MARKER)) {
    throw new Error(`lib/client/index.js must contain ${MARKER}`)
  }
  const body = fragmentNames()
    .map((name) => {
      const text = read(name).replace(/\s+$/, '')
      return `/* ---- lib/client/${name} ---- */\n${text}`
    })
    .join('\n\n')
  return template.replace(MARKER, body)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const template = readFileSync(TEMPLATE, 'utf8')
  const out = compose((name) => readFileSync(join(SRC, name), 'utf8'), template)
  writeFileSync(OUT, out)
  const lines = out.split('\n').length
  console.log(`lib/client.js <- ${fragmentNames().length} fragments, ${lines} lines`)
}

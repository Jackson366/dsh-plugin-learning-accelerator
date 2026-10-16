/**
 * Panel route tests.
 *
 * The route is the browser half's only trust boundary, so it gets the same
 * treatment as a first-party route: the guard is exercised directly (it is the
 * security decision), and the handler is driven through a stub carrier with a
 * fake request/response pair to confirm the status codes, body, and header
 * contract.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createService } from '../lib/index.js'
import { panelPayload } from '../lib/panel.js'
import {
  MAX_PANEL_CWD_LENGTH,
  PANEL_ROUTE,
  guardPanelRequest,
  panelCwdFromRequest,
  registerPanelRoute,
} from '../lib/panel-route.js'

/**
 * A request-shaped object with just the fields the guard and the handler read.
 *
 * `host: null` means "send no Host header at all", which is distinct from
 * omitting the option (which takes the default loopback host). `url` defaults to
 * the bare route path, which is what a request with no workspace hint looks like.
 */
function request({ host = '127.0.0.1:3080', origin, method = 'GET', url = PANEL_ROUTE } = {}) {
  const headers = {}
  if (host !== null) headers.host = host
  if (origin !== undefined) headers.origin = origin
  return { headers, method, url }
}

/** A response recorder implementing the subset the route calls. */
function createResponse() {
  const record = { status: undefined, headers: undefined, body: '', ended: false }
  return {
    record,
    writeHead(status, headers) {
      record.status = status
      record.headers = headers
    },
    end(chunk) {
      record.body = chunk ?? ''
      record.ended = true
    },
  }
}

/** A carrier stub that captures the registered route. */
function carrierStub() {
  const routes = []
  return {
    routes,
    register(route) {
      if (routes.some(existing => existing.path === route.path)) {
        throw new Error(`duplicate ${route.kind} route "${route.path}"`)
      }
      routes.push(route)
      return () => {
        const at = routes.indexOf(route)
        if (at >= 0) routes.splice(at, 1)
      }
    },
  }
}

/**
 * A `ctx` stub with only what the route touches.
 *
 * `inject` runs its callback immediately with an injected face exposing the
 * carrier, which is what Cordis does once the service is available.
 */
function contextStub(carrier, warnings = []) {
  return {
    inject(_deps, callback) {
      callback({
        webServer: carrier,
        effect: (fn) => fn(),
      })
      return { dispose: async () => {} }
    },
    logger: { warn: (message) => warnings.push(message) },
  }
}

test('the guard accepts loopback hosts, with and without a port', () => {
  for (const host of ['127.0.0.1:3080', '127.0.0.1', 'localhost:3080', 'localhost', '[::1]:3080', '[::1]']) {
    assert.deepEqual(guardPanelRequest(request({ host })), { ok: true }, `rejected ${host}`)
  }
})

test('the guard rejects non-loopback hosts, which is the DNS-rebinding case', () => {
  for (const host of ['evil.example.com', '10.0.0.5:3080', '192.168.1.9', 'attacker.test:3080', null]) {
    const result = guardPanelRequest(request({ host }))
    assert.equal(result.ok, false, `accepted ${host}`)
    assert.equal(result.status, 403)
  }
})

test('the guard rejects a remote Origin but allows local and app origins', () => {
  assert.equal(guardPanelRequest(request({ origin: 'http://127.0.0.1:3080' })).ok, true)
  assert.equal(guardPanelRequest(request({ origin: 'http://localhost:3080' })).ok, true)
  assert.equal(guardPanelRequest(request({ origin: 'dsh-app://renderer' })).ok, true)
  // `null` and a local file are allowed: a process that can read local files
  // gains nothing from this route.
  assert.equal(guardPanelRequest(request({ origin: 'null' })).ok, true)
  assert.equal(guardPanelRequest(request({ origin: 'file:///tmp/x.html' })).ok, true)
  // A remote page is the case this check exists for.
  const remote = guardPanelRequest(request({ origin: 'https://evil.example.com' }))
  assert.equal(remote.ok, false)
  assert.match(remote.reason, /not local|not loopback/)
  const unparseable = guardPanelRequest(request({ origin: 'http://%zz' }))
  assert.equal(unparseable.ok, false)
})

test('registerPanelRoute mounts one exact route after waiting for the carrier', () => {
  const carrier = carrierStub()
  const ctx = contextStub(carrier)
  registerPanelRoute(ctx, createService(), { buildPayload: panelPayload })
  assert.equal(carrier.routes.length, 1)
  assert.equal(carrier.routes[0].kind, 'exact')
  assert.equal(carrier.routes[0].path, PANEL_ROUTE)
})

test('registerPanelRoute waits via ctx.inject instead of probing the carrier', () => {
  // Probing would drop the route on every boot: the carrier is mounted by a
  // different loader entry and does not exist while this plugin applies.
  const carrier = carrierStub()
  const seen = []
  const ctx = {
    inject(deps, callback) {
      seen.push([...deps])
      callback({ webServer: carrier, effect: (fn) => fn() })
      return { dispose: async () => {} }
    },
    get() {
      throw new Error('registerPanelRoute must not probe with ctx.get')
    },
    logger: { warn() {} },
  }
  registerPanelRoute(ctx, createService(), { buildPayload: panelPayload })
  assert.deepEqual(seen, [['webServer']])
})

test('a GET returns the panel snapshot as uncached JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'la-route-'))
  try {
    const service = createService({ root: dir })
    service.storeFor({}).store.updateProfile({ learning_goal: '通过 N5' })
    const carrier = carrierStub()
    registerPanelRoute(contextStub(carrier), service, { buildPayload: panelPayload })

    const res = createResponse()
    await carrier.routes[0].handler(request(), res)
    assert.equal(res.record.status, 200)
    assert.match(res.record.headers['content-type'], /application\/json/)
    assert.equal(res.record.headers['cache-control'], 'no-store')
    const body = JSON.parse(res.record.body)
    assert.equal(body.ok, true)
    assert.equal(body.profile.learning_goal, '通过 N5')
    assert.equal(body.path, join(dir, '.learning', 'state.json'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a rejected request is 403, is logged, and leaks no state', async () => {
  const warnings = []
  const carrier = carrierStub()
  registerPanelRoute(contextStub(carrier, warnings), createService(), { buildPayload: panelPayload, logger: { warn: (message) => warnings.push(message) } })

  const res = createResponse()
  await carrier.routes[0].handler(request({ host: 'evil.example.com' }), res)
  assert.equal(res.record.status, 403)
  assert.match(res.record.body, /forbidden/)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /rejected panel request/)
})

test('a non-GET method is 405 with an Allow header', async () => {
  const carrier = carrierStub()
  registerPanelRoute(contextStub(carrier), createService(), { buildPayload: panelPayload })
  const res = createResponse()
  await carrier.routes[0].handler(request({ method: 'POST' }), res)
  assert.equal(res.record.status, 405)
  assert.equal(res.record.headers.allow, 'GET, HEAD')
})

test('a malformed state file answers 200 with the error, so the panel can explain it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'la-route-bad-'))
  try {
    const service = createService({ root: dir })
    const binding = service.storeFor({})
    binding.store.reset()
    const { writeFileSync } = await import('node:fs')
    writeFileSync(binding.path, '{ broken', 'utf8')

    const carrier = carrierStub()
    registerPanelRoute(contextStub(carrier), service, { buildPayload: panelPayload })
    const res = createResponse()
    await carrier.routes[0].handler(request(), res)
    assert.equal(res.record.status, 200)
    const body = JSON.parse(res.record.body)
    assert.equal(body.ok, false)
    assert.match(body.error, /Invalid JSON/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a throwing payload builder is contained, not turned into a 500', async () => {
  const carrier = carrierStub()
  registerPanelRoute(contextStub(carrier), createService(), {
    buildPayload: () => { throw new Error('builder exploded') },
  })
  const res = createResponse()
  await carrier.routes[0].handler(request(), res)
  assert.equal(res.record.status, 200)
  const body = JSON.parse(res.record.body)
  assert.equal(body.ok, false)
  assert.match(body.error, /builder exploded/)
})

test('the panel follows the most recent session, not the process directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'la-panel-scope-'))
  const other = mkdtempSync(join(tmpdir(), 'la-panel-scope2-'))
  try {
    const service = createService()
    // Two sessions in two projects; the later one is the active learner.
    service.storeFor({ agent: { session: { header: { cwd: dir } } } })
    service.storeFor({ agent: { session: { header: { cwd: other } } } })

    // The process directory must not win, which is the bug this guards: for the
    // packaged desktop app it is the profile directory, so the panel would show an
    // empty learner while the tools worked on the real one.
    const request = service.panelRequest()
    assert.equal(request.stateFile, join(other, '.learning', 'state.json'))
    assert.equal(request.scope, 'project')

    const payload = panelPayload(service, request)
    assert.equal(payload.ok, true)
    assert.equal(payload.path, join(other, '.learning', 'state.json'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(other, { recursive: true, force: true })
  }
})

test('an explicit or configured scope still wins over the session hint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'la-panel-scope3-'))
  try {
    const service = createService({ scope: 'user' })
    service.storeFor({ agent: { session: { header: { cwd: dir } } } })
    // A configured user scope is a deliberate global choice; the panel must honour it.
    assert.equal(service.panelRequest().scope, 'user')
    // An explicit request is passed through untouched.
    assert.deepEqual(
      service.panelRequest({ stateFile: '/tmp/explicit.json' }),
      { stateFile: '/tmp/explicit.json' },
    )
    assert.deepEqual(service.panelRequest({ scope: 'project' }), { scope: 'project' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a project with no state file yet still wins over the process directory', () => {
  const fresh = mkdtempSync(join(tmpdir(), 'la-panel-fresh-'))
  try {
    const service = createService()
    const binding = service.storeFor({ agent: { session: { header: { cwd: fresh } } } })
    assert.equal(existsSync(binding.path), false, 'the fixture must not have a state file yet')
    // Showing "nothing here yet, at this path" is the honest answer; falling
    // through to the process directory would name the wrong project.
    const request = service.panelRequest()
    assert.equal(request.stateFile, binding.path)
    const payload = panelPayload(service, request)
    assert.equal(payload.ok, true)
    assert.equal(payload.path, binding.path)
  } finally {
    rmSync(fresh, { recursive: true, force: true })
  }
})

test('a session whose project directory is gone is skipped', () => {
  const stale = mkdtempSync(join(tmpdir(), 'la-panel-stale-'))
  const live = mkdtempSync(join(tmpdir(), 'la-panel-live-'))
  try {
    const service = createService()
    const stalePath = service.storeFor({ agent: { session: { header: { cwd: stale } } } }).path
    service.storeFor({ agent: { session: { header: { cwd: live } } } })
    // Make the stale row the most recent, then remove the project itself.
    service.rememberSessionPath(stalePath)
    rmSync(stale, { recursive: true, force: true })
    assert.equal(existsSync(stale), false)
    const request = service.panelRequest()
    assert.equal(request.stateFile, join(live, '.learning', 'state.json'))
  } finally {
    rmSync(stale, { recursive: true, force: true })
    rmSync(live, { recursive: true, force: true })
  }
})

test('the session-path memory is bounded', () => {
  const dirs = []
  try {
    const service = createService()
    for (let index = 0; index < 12; index += 1) {
      const dir = mkdtempSync(join(tmpdir(), `la-panel-cap-${index}-`))
      dirs.push(dir)
      service.storeFor({ agent: { session: { header: { cwd: dir } } } })
    }
    assert.ok(service.sessionPaths.length <= 8, `expected a capped list, got ${service.sessionPaths.length}`)
    // Most recent first.
    assert.equal(service.sessionPaths[0], join(dirs.at(-1), '.learning', 'state.json'))
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  }
})

test('the reported workspace is read from the cwd parameter, not from the path', () => {
  assert.equal(panelCwdFromRequest({ url: PANEL_ROUTE }), undefined)
  assert.equal(panelCwdFromRequest({ url: `${PANEL_ROUTE}?cwd=%2Ftmp%2Flearn` }), '/tmp/learn')
  // `encodeURIComponent` never emits a bare `+`, so a literal `+` reaches the
  // route as `%2B`; the form-encoded spelling of a space would decode to one,
  // which is still an absolute path and therefore still accepted.
  assert.equal(panelCwdFromRequest({ url: `${PANEL_ROUTE}?cwd=%2Ftmp%2Fa%2Bb` }), '/tmp/a+b')
  assert.equal(panelCwdFromRequest({ url: `${PANEL_ROUTE}?cwd=%2Ftmp%2Fa+b` }), '/tmp/a b')
  assert.equal(panelCwdFromRequest({ url: `${PANEL_ROUTE}?cwd=%2Ftmp%2Fa&cwd=%2Fetc` }), '/tmp/a')
  // A full absolute request target is accepted too; only the pathname carries
  // the route, so the search string still parses.
  assert.equal(
    panelCwdFromRequest({ url: `http://127.0.0.1:3080${PANEL_ROUTE}?cwd=%2Ftmp%2Flearn` }),
    '/tmp/learn',
  )
})

test('a cwd hint that is not an absolute path is dropped, not trusted', () => {
  const rejected = [
    `${PANEL_ROUTE}?cwd=`, // empty
    `${PANEL_ROUTE}?cwd=%20%20`, // whitespace only
    `${PANEL_ROUTE}?cwd=relative%2Fpath`, // relative
    `${PANEL_ROUTE}?cwd=.%2Fhere`, // relative
    `${PANEL_ROUTE}?cwd=~%2Flearn`, // a home shorthand, not a path the host can join
    `${PANEL_ROUTE}?cwd=%2Ftmp%2Fa%00b`, // NUL: a truncated path, never a real one
    `${PANEL_ROUTE}?cwd=${encodeURIComponent(`/${'x'.repeat(MAX_PANEL_CWD_LENGTH)}`)}`, // over the bound
    `${PANEL_ROUTE}?cwd=%ZZ`, // undecodable
  ]
  for (const url of rejected) {
    assert.equal(panelCwdFromRequest({ url }), undefined, `accepted ${url}`)
  }
  assert.equal(panelCwdFromRequest({}), undefined)
  assert.equal(panelCwdFromRequest({ url: '' }), undefined)
  assert.equal(panelCwdFromRequest({ url: 'http://%zz' }), undefined)
})

test('the panel follows the workspace the browser reports over its own session hint', () => {
  const sessionDir = mkdtempSync(join(tmpdir(), 'la-panel-ws-session-'))
  const reported = mkdtempSync(join(tmpdir(), 'la-panel-ws-reported-'))
  try {
    const service = createService()
    service.storeFor({ agent: { session: { header: { cwd: sessionDir } } } })

    // The whole point: the host's own "most recent session" answer is the other
    // project, and the reported workspace must win over it.
    const request = service.panelRequest({}, reported)
    assert.equal(request.cwd, reported)
    assert.equal(request.stateFile, undefined, 'a reported workspace must not be smuggled in as an explicit file')

    const payload = panelPayload(service, request)
    assert.equal(payload.ok, true)
    assert.equal(payload.path, join(reported, '.learning', 'state.json'))
    assert.equal(payload.source, 'panel-cwd')
  } finally {
    rmSync(sessionDir, { recursive: true, force: true })
    rmSync(reported, { recursive: true, force: true })
  }
})

test('an explicit stateFile, a configured scope, or a bad cwd still decides normally', () => {
  const reported = mkdtempSync(join(tmpdir(), 'la-panel-ws-guard-'))
  try {
    const service = createService()
    // An explicit request is passed through untouched, cwd hint or not.
    assert.deepEqual(
      service.panelRequest({ stateFile: '/tmp/explicit.json' }, reported),
      { stateFile: '/tmp/explicit.json' },
    )
    assert.deepEqual(service.panelRequest({ scope: 'user' }, reported), { scope: 'user' })
    // A relative or missing hint falls through to the host's own resolution
    // rather than producing a path relative to the process directory.
    for (const bad of [undefined, '', 'relative/path', 42]) {
      const request = service.panelRequest({}, bad)
      assert.equal(request.cwd, undefined, `accepted ${String(bad)}`)
      assert.notEqual(panelPayload(service, request).source, 'panel-cwd')
    }
  } finally {
    rmSync(reported, { recursive: true, force: true })
  }
})

test('a GET with a cwd hint renders that workspace through the route', async () => {
  const reported = mkdtempSync(join(tmpdir(), 'la-panel-ws-route-'))
  try {
    const service = createService()
    service.storeFor({ cwd: reported }).store.updateProfile({ learning_goal: '面板跟随工作空间' })
    const carrier = carrierStub()
    registerPanelRoute(contextStub(carrier), service, { buildPayload: panelPayload })

    const res = createResponse()
    await carrier.routes[0].handler(
      request({ url: `${PANEL_ROUTE}?cwd=${encodeURIComponent(reported)}` }),
      res,
    )
    assert.equal(res.record.status, 200)
    const body = JSON.parse(res.record.body)
    assert.equal(body.ok, true)
    assert.equal(body.path, join(reported, '.learning', 'state.json'))
    assert.equal(body.source, 'panel-cwd')
    assert.equal(body.profile.learning_goal, '面板跟随工作空间')
  } finally {
    rmSync(reported, { recursive: true, force: true })
  }
})

test('a rejected cwd hint leaves the route answering from its own session hint', async () => {
  const sessionDir = mkdtempSync(join(tmpdir(), 'la-panel-ws-fallback-'))
  try {
    const service = createService()
    service.storeFor({ agent: { session: { header: { cwd: sessionDir } } } })
    const carrier = carrierStub()
    registerPanelRoute(contextStub(carrier), service, { buildPayload: panelPayload })

    const res = createResponse()
    await carrier.routes[0].handler(request({ url: `${PANEL_ROUTE}?cwd=not-absolute` }), res)
    assert.equal(res.record.status, 200)
    const body = JSON.parse(res.record.body)
    assert.equal(body.path, join(sessionDir, '.learning', 'state.json'))
    assert.equal(body.source, 'argument')
  } finally {
    rmSync(sessionDir, { recursive: true, force: true })
  }
})

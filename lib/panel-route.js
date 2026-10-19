/**
 * The browser half's data route.
 *
 * ## Why a plain HTTP route and not `@Remote`
 *
 * The client half is a plain JavaScript classic script with no build step
 * (see `../lib/client.js`). `@Remote` requires TypeScript decorators plus the
 * typert code generator to emit a `/remote` surface, so it is not available to a
 * zero-build plugin. The two supported alternatives are
 * `ctx.connection.rpc.handle(...)` (present from 0.1.x) and
 * `ctx.webServer.register(...)` (present in every composition with an HTTP
 * carrier). This module uses the webserver, which is the lower and more stable of
 * the two and needs no envelope protocol, and probes for the optional `connection`
 * capability only to answer requests without a route lookup.
 *
 * ## Why the guards
 *
 * The route exposes a learner's profile and progress to anything that can reach
 * the loopback port. The carrier's own authenticated `/api` surface is not used
 * here, so this route must defend itself: it accepts only requests whose `Host`
 * resolves to loopback and whose `Origin`, when the browser sends one, is a
 * loopback or desktop-app origin. That blocks a remote page on the same machine
 * from reading the file through a rebound hostname.
 *
 * ## Why the request carries a `cwd`
 *
 * A browser request has no session identity, so without a hint the route can only
 * guess which project the panel means (see `LearningAcceleratorService#panelRequest`).
 * The panel's client half therefore reads the workspace of the conversation it is
 * rendered in from the Session list and passes it as `?cwd=`. Since that value
 * comes from the page, it is treated as untrusted input and accepted only when it
 * is a plain absolute directory path: anything relative, empty, NUL-bearing, or
 * absurdly long is dropped, and the request falls back to the host's own session
 * hint. The value never reaches a shell, and the file it selects is a
 * `.learning/state.json` under it — the same file the session itself would use.
 */

import { isAbsolute } from 'node:path'

/**
 * Hostnames considered local for the purpose of accepting a panel request.
 *
 * `localhost` and the loopback literals cover the browser; the `dsh-app` scheme
 * is the desktop shell, which serves the renderer from its own origin.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const LOCAL_SCHEMES = new Set(['http:', 'https:', 'dsh-app:', 'file:'])

/** Strip the port from a `Host` header value. */
function hostnameOf(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return null
  const value = hostHeader.trim().toLowerCase()
  // `[::1]` is a bare IPv6 literal, while `[::1]:3080` hides its port after the
  // closing bracket. Only a value without brackets falls back to the last colon.
  if (value.startsWith('[') && value.endsWith(']')) return value
  const lastColon = value.lastIndexOf(':')
  if (lastColon > 0) return value.slice(0, lastColon)
  return value
}

/**
 * Decide whether one request may read the panel.
 *
 * The Host check is the real boundary; the Origin check is defence in depth.
 * It is deliberately not stricter than that: `Origin: null` (a sandboxed iframe
 * or a local file) and a local `file:` page are both allowed, because a process
 * that can already read local files gains nothing from this route. What the
 * guard does stop is a page served from a *remote* origin — reached via a
 * DNS-rebound hostname or a proxy on the loopback port — reading the file over
 * HTTP.
 *
 * @param {import('node:http').IncomingMessage} req - the incoming request.
 * @returns {{ ok: true } | { ok: false, status: number, reason: string }}
 */
export function guardPanelRequest(req) {
  const host = hostnameOf(req.headers?.host)
  if (host === null) return { ok: false, status: 403, reason: 'missing Host header' }
  if (!LOOPBACK_HOSTS.has(host)) {
    return { ok: false, status: 403, reason: `Host ${host} is not loopback` }
  }

  // A browser always sends Origin on a cross-origin request and on same-origin
  // non-GET requests; a missing Origin is a same-origin navigation or a
  // non-browser client, both of which the Host check already constrained.
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0 && origin !== 'null') {
    let parsed
    try {
      parsed = new URL(origin)
    } catch {
      return { ok: false, status: 403, reason: `unparseable Origin ${origin}` }
    }
    if (!LOCAL_SCHEMES.has(parsed.protocol)) {
      return { ok: false, status: 403, reason: `Origin scheme ${parsed.protocol} is not local` }
    }
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
    ) {
      return { ok: false, status: 403, reason: `Origin host ${parsed.hostname} is not loopback` }
    }
  }

  return { ok: true }
}

/**
 * Longest `cwd` this route will read off a request.
 *
 * Every real platform limit is far below this, so the bound exists only to stop
 * a request from making the route carry an unbounded string.
 */
export const MAX_PANEL_CWD_LENGTH = 4096

/**
 * Read the workspace hint a panel request carries, if it carries a usable one.
 *
 * The client half knows which conversation is open and therefore which workspace
 * the panel should describe; the host cannot, so it asks. The value is page input
 * and is validated as such: it must parse as an absolute path in the host's own
 * spelling (POSIX here, a drive or UNC path on Windows), and anything else is
 * dropped so the caller falls back to the host's session hint instead of
 * pointing the panel at a path the request invented.
 *
 * @param {import('node:http').IncomingMessage} req - the incoming request.
 * @returns {string | undefined} the absolute workspace path, or `undefined`.
 */
export function panelCwdFromRequest(req) {
  const raw = req?.url
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  let url
  try {
    // A path-only request target; the base supplies the scheme a URL needs.
    url = new URL(raw, 'http://localhost')
  } catch {
    return undefined
  }
  const value = url.searchParams.get('cwd')
  if (value === null) return undefined
  const cwd = value.trim()
  if (cwd.length === 0 || cwd.length > MAX_PANEL_CWD_LENGTH) return undefined
  if (cwd.includes('\0')) return undefined
  return isAbsolute(cwd) ? cwd : undefined
}

/** Write one JSON response with the headers a live panel needs. */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    // The panel is live state; a cached copy would show stale review queues.
    'cache-control': 'no-store',
  })
  res.end(text)
}

/** Write a plain-text error for a rejected request. */
function sendText(res, status, message) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(message)
}

/**
 * Route path for the panel snapshot.
 *
 * Deliberately *not* under `/api`: the carrier owns that prefix for its
 * authenticated gateway, and piggybacking on it would invite a request that
 * passes one auth check and bypasses another.
 */
export const PANEL_ROUTE = '/learning-accelerator/panel'

/**
 * Register the panel route once a web carrier is live.
 *
 * The carrier is awaited with `ctx.inject` rather than probed with `ctx.get`,
 * because it is mounted by a *different* loader entry and its service does not
 * exist yet while this plugin's `apply` is running. Probing would silently drop
 * the route on every boot. Declaring the dependency inside this nested plugin
 * (rather than on this plugin's own `inject`) is what keeps a headless
 * composition working: without a carrier the nested fiber simply stays PENDING
 * and this plugin's tools and prompt context still load.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{ summarize: (request: object) => object }} service - host service.
 * @param {{ stateFile?: string, scope?: 'project' | 'user', buildPayload: Function, logger?: object }} options
 * @returns {import('@deepseek-ai/cordis').Fiber} the inject fiber, so a caller can
 *   await or dispose it.
 */
export function registerPanelRoute(ctx, service, options) {
  return ctx.inject(['webServer'], (injected) => {
    const { webServer } = injected

    injected.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: PANEL_ROUTE,
          handler: (req, res) => {
            const guard = guardPanelRequest(req)
            if (!guard.ok) {
              options.logger?.warn?.(`learning-accelerator: rejected panel request (${guard.reason})`)
              sendText(res, guard.status, `forbidden: ${guard.reason}`)
              return
            }
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              res.writeHead(405, { allow: 'GET, HEAD' })
              res.end()
              return
            }
            try {
              // `panelRequest` decides *which* learner a browser request means. The
              // browser cannot name a session, but it does know which workspace the
              // conversation it is rendering belongs to, and passes it as `cwd`; the
              // service follows that first and reports the winner back to the UI as
              // `path` and `source`.
              sendJson(
                res,
                200,
                options.buildPayload(
                  service,
                  service.panelRequest(
                    {
                      stateFile: options.stateFile,
                      scope: options.scope,
                    },
                    panelCwdFromRequest(req),
                  ),
                ),
              )
            } catch (error) {
              // A malformed state file must render an explanation in the panel, not a
              // 500 with an empty body.
              sendJson(res, 200, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                path: '',
                generated_at: new Date().toISOString(),
              })
            }
          },
        }),
      'learning-accelerator: panel route',
    )
  })
}

/**
 * Host-side learning-state scope resolution.
 *
 * The whole plugin hangs off one question: *which* `.learning/state.json` does
 * this turn belong to? Getting that wrong is worse than failing, because a
 * learner would silently accumulate progress in a file nobody reads again. So
 * resolution follows one explicit precedence chain, lives in one function, and
 * is unit-tested independently of Cordis.
 *
 * Precedence, highest first:
 *   1. an explicit `stateFile` argument from the model or a human,
 *   2. the calling session's working directory (`session.header.cwd`),
 *   3. the working directory the Web panel reported for the open conversation,
 *   4. the plugin's configured `root`,
 *   5. the host process working directory.
 *
 * Steps 2-5 only ever produce a *project* path. `scope: 'user'` deliberately
 * short-circuits them, because a user-level store is machine-global by
 * definition and has nothing to do with any session.
 *
 * Step 3 exists because a browser request has no session identity of its own:
 * the panel's client half reads the workspace of the conversation it is rendered
 * in and passes it along, so the panel follows the workspace the learner is
 * looking at rather than whichever session happened to resolve a store last.
 * It sits below steps 1-2 — a session that *does* have an identity still decides
 * for itself — and above `root`, which the Config description already defines as
 * the answer only "when the session has no working directory".
 */

import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { LearningStore, PROJECT_STATE_RELATIVE, userStateFile } from './learning-store.js'
import { teachingProtocolBlock } from './protocol.js'

/** State scopes the plugin understands. */
export const STATE_SCOPES = Object.freeze(['project', 'user'])

/**
 * How many session-derived state paths to remember for the Web panel.
 *
 * Small on purpose: this is a "which project was I just working in" hint, not a
 * registry, and an unbounded list would leak one entry per directory ever used.
 */
const SESSION_PATH_LIMIT = 8

/** Path of the project-scoped state file under one root. */
export function projectStateFile(root) {
  return join(root, PROJECT_STATE_RELATIVE)
}

/**
 * Return one value when it is a usable absolute directory path.
 *
 * Every caller below reads a path out of an object a future harness release may
 * reshape — a session header, a panel request, a route parameter — and a missing
 * or relative path must degrade to "no project hint" rather than throw or resolve
 * against the process directory.
 *
 * @param {unknown} value - candidate path.
 * @returns {string | undefined} the path, or `undefined` when it is not absolute.
 */
function absolutePath(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return isAbsolute(value) ? value : undefined
}

/**
 * Read the working directory a session was created in.
 *
 * Defensive by design: this walks three levels of a live runtime object that a
 * future harness release may reshape, and a missing cwd must degrade to "no
 * project hint" rather than throw inside a model-facing tool.
 *
 * @param {unknown} agent - a live `Agent` (or anything shaped like one).
 * @returns {string | undefined} the session cwd when it is a usable absolute path.
 */
export function sessionCwd(agent) {
  return absolutePath(agent?.session?.header?.cwd)
}

/**
 * Resolve the state file for one call.
 *
 * @param {object} options
 * @param {'project' | 'user'} [options.scope] - which store family to use.
 * @param {string} [options.root] - configured project root (step 4).
 * @param {string} [options.stateFile] - explicit override (step 1).
 * @param {unknown} [options.agent] - calling agent, for its session cwd (step 2).
 * @param {string} [options.cwd] - working directory reported for the open
 *   conversation by the Web panel's browser half (step 3).
 * @param {string} [options.fallback] - process working directory (step 5).
 * @returns {{ path: string, scope: 'project' | 'user', source: string }} the
 *   chosen path plus the precedence step that produced it, for diagnostics and
 *   for the UI to explain where data is being written.
 */
export function resolveStatePath({
  scope = 'project',
  root,
  stateFile,
  agent,
  cwd,
  fallback,
} = {}) {
  if (stateFile) {
    return { path: resolve(stateFile), scope, source: 'argument' }
  }
  if (scope === 'user') {
    return { path: userStateFile(), scope: 'user', source: 'user-scope' }
  }
  const fromSession = sessionCwd(agent)
  if (fromSession) {
    return { path: projectStateFile(fromSession), scope: 'project', source: 'session-cwd' }
  }
  const reported = absolutePath(cwd)
  if (reported) {
    // A distinct source, not `session-cwd`: the path came from the browser, so
    // the panel can say why it is showing this project.
    return { path: projectStateFile(reported), scope: 'project', source: 'panel-cwd' }
  }
  if (root) return { path: projectStateFile(resolve(root)), scope: 'project', source: 'config-root' }
  return { path: projectStateFile(fallback ?? process.cwd()), scope: 'project', source: 'process-cwd' }
}

/**
 * Host service (`ctx.learningAccelerator`) that turns one call's identity into
 * one bound {@link LearningStore}.
 *
 * Caching per path matters more than it looks: every tool call and every prompt
 * assembly resolves through here, and without a cache a single turn would
 * re-read and re-validate the same JSON a dozen times.
 */
export class LearningAcceleratorService {
  /**
   * @param {object} [config] - validated plugin config.
   * @param {() => string} [config.defaultRoot] - lazily read configured root, so
   *   a `!!js` expression is evaluated at use time rather than at apply time.
   */
  constructor(config = {}) {
    this.config = config
    /** @type {Map<string, LearningStore>} */
    this.stores = new Map()
    /**
     * Paths this process has actually resolved for a *session*, most recent
     * first, capped. See {@link LearningAcceleratorService#panelBinding}.
     * @type {string[]}
     */
    this.sessionPaths = []
  }

  /**
   * Resolve and memoize the store for one call.
   * @param {{ stateFile?: string, agent?: unknown, cwd?: string, scope?: 'project' | 'user' }} [request]
   * @returns {{ store: LearningStore, path: string, scope: string, source: string, root: string }}
   */
  storeFor(request = {}) {
    const scope = request.scope ?? this.config.scope ?? 'project'
    if (!STATE_SCOPES.includes(scope)) {
      throw new Error(`learning scope must be one of: ${STATE_SCOPES.join(', ')}`)
    }
    const resolved = resolveStatePath({
      scope,
      root: this.defaultRoot(),
      stateFile: request.stateFile,
      agent: request.agent,
      cwd: request.cwd,
    })
    let store = this.stores.get(resolved.path)
    if (!store) {
      store = new LearningStore(resolved.path)
      this.stores.set(resolved.path, store)
    }
    // Remember what a session actually worked on. Only session-derived paths are
    // recorded: an explicit `state_file` argument is a one-off the caller chose,
    // not evidence of where this learner lives.
    if (request.agent !== undefined && resolved.source === 'session-cwd') {
      this.rememberSessionPath(resolved.path)
    }
    return { ...resolved, store, root: this.defaultRoot() ?? process.cwd() }
  }

  /** Read the configured default root, if any. */
  defaultRoot() {
    const root = typeof this.config.defaultRoot === 'function'
      ? this.config.defaultRoot()
      : this.config.defaultRoot
    return typeof root === 'string' && root.length > 0 ? root : undefined
  }

  /**
   * Move one path to the front of the session-path list, capped at
   * {@link SESSION_PATH_LIMIT}.
   */
  rememberSessionPath(path) {
    const at = this.sessionPaths.indexOf(path)
    if (at >= 0) this.sessionPaths.splice(at, 1)
    this.sessionPaths.unshift(path)
    if (this.sessionPaths.length > SESSION_PATH_LIMIT) {
      this.sessionPaths.length = SESSION_PATH_LIMIT
    }
  }

  /**
   * Resolve the request a *browser* panel should make.
   *
   * A browser request carries no session identity, so the panel cannot ask "which
   * file does this conversation belong to" the way a tool can. Falling back to the
   * process working directory is the worst answer available — it is whatever the
   * app was launched from, which for the packaged desktop app is the profile
   * directory, so the panel would silently show an empty learner while the tools
   * worked on the real one.
   *
   * So the panel follows the learner, in this order:
   *
   *   1. `cwd`, the workspace of the conversation the panel is rendered in. The
   *      client half reads it from the Session list and puts it on the request,
   *      which is what makes the panel change when the learner switches
   *      workspace — the path a browser request otherwise cannot carry.
   *   2. the most recent session working directory this process resolved.
   *   3. nothing, leaving resolution to the configured `root` and finally the
   *      process directory (see {@link resolveStatePath}).
   *
   * A reported `cwd` is used **whether or not its file exists yet**, so a project
   * the learner just opened still gets the "no state file here" message pointing
   * at the right place. The remembered session paths are used the same way, and
   * are skipped only once their directory is gone, so a deleted project cannot
   * pin the panel to nothing.
   *
   * The caller can always see which one won, because `panelPayload` reports the
   * resolved path and its `source` back to the UI.
   *
   * @param {{ stateFile?: string, scope?: 'project' | 'user' }} [explicit] - a
   *   configured override, or a deliberate user scope, always wins.
   * @param {string} [cwd] - workspace of the open conversation, as reported by
   *   the browser half, or `undefined` when it could not be determined.
   * @returns {{ stateFile?: string, scope?: 'project' | 'user', cwd?: string }} a
   *   request for {@link LearningAcceleratorService#summarize}.
   */
  panelRequest(explicit = {}, cwd) {
    if (explicit.stateFile !== undefined || explicit.scope !== undefined) return explicit
    const request = { scope: this.config.scope ?? 'project' }
    const reported = absolutePath(cwd)
    if (reported) return { ...request, cwd: reported }
    for (const candidate of this.sessionPaths) {
      // `dirname(dirname(path))` is the project directory the path was derived
      // from; if that is gone, the learner is not there any more.
      if (existsSync(dirname(dirname(candidate)))) return { ...request, stateFile: candidate }
    }
    return request
  }

  /**
   * Summarize one scope without throwing on malformed state.
   *
   * Read paths must not fail a turn just because a state file was hand-edited
   * into an invalid shape: the tools surface the error to the model so it can
   * repair the file, and the UI still renders.
   *
   * @param {{ stateFile?: string, agent?: unknown, cwd?: string, scope?: 'project' | 'user' }} [request]
   * @returns {{ ok: true, path: string, source: string, scope: string, summary: object }
   *   | { ok: false, path: string, source: string, scope: string, error: string }}
   */
  summarize(request = {}) {
    let binding
    try {
      binding = this.storeFor(request)
    } catch (error) {
      return {
        ok: false,
        path: '',
        source: 'unresolved',
        scope: request.scope ?? this.config.scope ?? 'project',
        error: error instanceof Error ? error.message : String(error),
      }
    }
    try {
      return {
        ok: true,
        path: binding.path,
        source: binding.source,
        scope: binding.scope,
        summary: binding.store.summary(),
      }
    } catch (error) {
      return {
        ok: false,
        path: binding.path,
        source: binding.source,
        scope: binding.scope,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * The summary a prompt-injection decision is made on, or `null` to stay silent.
   *
   * One rule for every injection point: this plugin only speaks up for a scope
   * that actually carries a learning track. Injecting "no goals, nothing due"
   * into an unrelated session would be noise that costs tokens on every turn.
   *
   * @param {{ store: LearningStore, path: string }} binding - a resolved store.
   * @returns {object|null} the summary, or `null` when there is nothing to say.
   */
  _injectableSummary(binding) {
    if (!binding.store.exists) return null
    const summary = binding.store.summary()
    if (!summary.current_topic && !summary.learning_goal && summary.priority_reviews.length === 0
      && summary.current_tasks.length === 0) {
      return null
    }
    return summary
  }

  /**
   * Render the teaching protocol for one call's scope.
   *
   * This is what makes the plugin a learning OS rather than a review scheduler:
   * upstream ships the method as markdown a skill *asks* the model to load, and
   * here it simply arrives, adapted to the stored profile, on every turn of a
   * track that has a state file.
   *
   * Gated exactly like {@link LearningAcceleratorService#promptContext}, so the
   * two blocks appear and disappear together and a session that never opted into
   * learning pays nothing.
   *
   * @param {{ stateFile?: string, agent?: unknown, scope?: 'project' | 'user' }} [request]
   * @returns {string} markdown, or `''`.
   */
  protocolContext(request = {}) {
    let binding
    try {
      binding = this.storeFor(request)
    } catch {
      return ''
    }
    if (!this._injectableSummary(binding)) return ''
    try {
      // Read the profile from the file rather than from the summary: the summary
      // is the kernel's compact, Python-identical shape and deliberately omits
      // `experience_level`, which is exactly what profile adaptation needs.
      const profile = binding.store.load().learner_profile ?? {}
      return teachingProtocolBlock({
        domain: profile.learning_domain ?? 'general',
        experienceLevel: profile.experience_level ?? 'unknown',
        knownSkills: profile.known_skills ?? profile.known_stack ?? [],
      })
    } catch {
      return ''
    }
  }

  /**
   * Render the compact prompt-context block for one call's scope.
   *
   * Returns an empty string when nothing is worth injecting, so a session that
   * never opted into learning does not pay a single token for this plugin.
   *
   * @param {{ stateFile?: string, agent?: unknown, scope?: 'project' | 'user' }} [request]
   * @returns {string} markdown context, or `''`.
   */
  promptContext(request = {}) {
    let binding
    try {
      binding = this.storeFor(request)
    } catch {
      return ''
    }
    if (!this._injectableSummary(binding)) return ''
    try {
      const lines = binding.store.promptContext().split('\n')
      return [
        '## 学习状态（Learning Accelerator）',
        `状态文件：\`${binding.path}\``,
        '',
        ...lines,
        '',
        '在本轮回复中按需：先复习到期项目，再教新内容，最后用小练习和回述问题收尾；'
        + '如学习状态有变化，调用 `learning_record` 落盘，不要只在正文里声明已保存。',
      ].join('\n')
    } catch {
      return ''
    }
  }
}

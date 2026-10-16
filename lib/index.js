/**
 * dsh-plugin-learning-accelerator — host half.
 *
 * Ports Learning-Accelerator's General Learning OS from "a prompt plus a Python
 * CLI the agent may or may not call" into harness-native capabilities:
 *
 *   - a `LearningAccelerator` service that owns scope resolution and caching,
 *   - five model-facing tools registered on `ctx.tools`,
 *   - two ordered runtime-context contributions on `ctx.systemPrompt`: the
 *     teaching protocol (the method) and the learner's profile, weak concepts,
 *     and due reviews (the state), so a learning turn needs no tool call to know
 *     either what to teach or what is due,
 *   - a read-only panel payload for the browser half.
 *
 * Everything registered here is an *effect*: unloading or hot-reloading the
 * plugin unwinds the tools, the prompt context, and the route with no manual
 * bookkeeping.
 *
 * @see ../README.md
 */

import { Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

import { panelPayload } from './panel.js'
import { registerPanelRoute } from './panel-route.js'
import { LearningAcceleratorService } from './scope.js'
import { registerLearningTools } from './tools.js'

// The panel payload and its route path are part of the public surface: a test or
// an embedder reads them directly, and the browser half depends on the path.
export { panelPayload } from './panel.js'
export { PANEL_ROUTE } from './panel-route.js'

/** Plugin display name, used by Cordis diagnostics. */
export const name = 'learning-accelerator'

/**
 * Required services.
 *
 * `tools` and `systemPrompt` are both mounted by `@deepseek-ai/dsh-base`, so
 * this list is satisfiable in every shipped profile. The webserver, by contrast,
 * is optional — a headless or ACP composition has no browser carrier — so it is
 * probed at use time instead of pinned here. Pinning it would park this plugin in
 * PENDING forever in those compositions, silently losing the tools too.
 */
export const inject = ['tools', 'systemPrompt']

/** Plugin configuration. */
export const Config = Schema.object({
  stateFile: Schema.string()
    .description('Explicit learning state file. Overrides every other scope rule.'),
  root: Schema.string()
    .description('Project root used when the session has no working directory. Defaults to the process working directory.'),
  scope: Schema.union(['project', 'user'])
    .default('project')
    .description('Default store family: project keeps ./.learning/state.json, user keeps ~/.learning-accelerator/state.json.'),
  injectPromptContext: Schema.boolean()
    .default(true)
    .description('Contribute the learner profile and review queue to the system prompt of sessions that already have a state file.'),
  injectProtocol: Schema.boolean()
    .default(true)
    .description('Contribute the teaching protocol (modes, teaching unit, exercise generation, error analysis, difficulty rules) alongside the state block.'),
  promptContextOrder: Schema.number()
    .default(150)
    .description('Order of the state block. The protocol block sits one order above it, so the method is read before the queue. The tool-guidance band is 100-199.'),
  panelRoute: Schema.boolean()
    .default(true)
    .description('Serve the Web panel snapshot on the local HTTP carrier. Turn off only if another plugin owns that path.'),
})

/**
 * `ctx.learningAccelerator` — the host service.
 *
 * Exposed as a service rather than kept private so other plugins (a future
 * scheduler, a report exporter) can read the same cached store instead of
 * re-implementing scope resolution.
 */
/**
 * `ctx.learningAccelerator` — the host service.
 *
 * A thin Cordis-facing wrapper around {@link LearningAcceleratorService}: it
 * exists so other plugins can reach the shared store through `ctx`, while the
 * tools and prompt context close over the same implementation instance directly.
 */
export class LearningAccelerator extends Service {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx - owning context.
   * @param {object} config - validated {@link Config}.
   * @param {LearningAcceleratorService} [impl] - shared implementation; one is
   *   constructed when the class is mounted as a plugin on its own.
   */
  constructor(ctx, config, impl) {
    super(ctx, 'learningAccelerator')
    this.config = config
    this.impl = impl ?? new LearningAcceleratorService({
      scope: config?.scope,
      defaultRoot: () => config?.root,
    })
  }

  /** Resolve and memoize the store for one call. */
  storeFor(request) {
    return this.impl.storeFor(request)
  }

  /** Read one scope without throwing on malformed state. */
  summarize(request) {
    return this.impl.summarize(request)
  }

  /** Render the prompt-context block for one scope, or `''`. */
  promptContext(request) {
    return this.impl.promptContext(request)
  }

  /** Render the teaching-protocol block for one scope, or `''`. */
  protocolContext(request) {
    return this.impl.protocolContext(request)
  }
}

/**
 * Build a standalone learning-state service from validated config.
 *
 * Exported so tests and embedders can drive the same implementation without a
 * Cordis application, and so `apply` has one obvious place to construct it.
 *
 * @param {object} [config] - validated {@link Config}, or a partial one.
 * @returns {LearningAcceleratorService}
 */
export function createService(config = {}) {
  return new LearningAcceleratorService({
    scope: config.scope,
    defaultRoot: () => config.root,
  })
}

/**
 * Mount the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} config - validated {@link Config}.
 */
export function apply(ctx, config) {
  // One implementation instance, shared by every callback this plugin creates.
  const service = createService(config)

  // Mount it as a service too, so another plugin (a report exporter, a
  // scheduler) can read the same cached store instead of re-resolving scope.
  // A zero-arg factory is the simplest way to hand the constructor its shared
  // implementation: Cordis passes only `(ctx, config)` to a plugin body.
  ctx.plugin((serviceCtx) => {
    serviceCtx.plugin(LearningAccelerator, config, service)
  })

  // Cordis gates service *reads* on the reading fiber's `inject` declaration, and
  // the callbacks registered below run on behalf of this plugin's fiber. So the
  // service reads happen on a context that declares the dependency explicitly;
  // `ctx.inject` is a plugin whose body re-runs if the service is replaced.
  ctx.inject(['learningAccelerator'], injected => {
    registerLearningTools(injected, service)

    // The method first, then the state: a reader of the assembled prompt learns
    // how to run a turn before it learns what is due in this one.
    if (config.injectProtocol) {
      injected.systemPrompt.context({
        name: 'learning-accelerator/protocol',
        order: config.promptContextOrder - 1,
        text: assemble => service.protocolContext({
          scope: config.scope,
          stateFile: config.stateFile,
          agent: assemble?.agent,
        }),
      })
    }

    if (config.injectPromptContext) {
      // A dynamic context, not a static section: it is re-evaluated for every
      // assembly, so a review completed in an earlier turn is already reflected
      // in the next turn's prompt without a tool call.
      injected.systemPrompt.context({
        name: 'learning-accelerator/status',
        order: config.promptContextOrder,
        text: assemble => service.promptContext({
          // The session's working directory decides which state file applies, so
          // one process can serve several learners or several projects at once.
          scope: config.scope,
          stateFile: config.stateFile,
          agent: assemble?.agent,
        }),
      })
    }
  })

  if (config.panelRoute) {
    // The browser half needs the same data the tools read. A browser request has
    // no session identity, so the route asks the service to resolve one, and
    // `panelPayload` reports the winner back to the UI as `path`.
    //
    // `scope` is forwarded only when the operator chose something other than the
    // project default. Cordis fills defaults in before `apply` runs, and
    // `panelRequest` treats *any* explicit scope as "stop following sessions" —
    // so forwarding the default would silently pin the panel to the configured
    // root or the process working directory (for the packaged desktop app, the
    // profile directory), which is precisely the answer the panel exists to
    // avoid. An explicit `stateFile` or `root` still wins over the session hint,
    // so the documented override order holds.
    //
    // The returned fiber stays PENDING in a composition with no HTTP carrier,
    // which is the intended outcome: the tools keep working, only the panel route
    // is absent.
    registerPanelRoute(ctx, service, {
      stateFile: config.stateFile,
      scope: config.scope === 'project' ? undefined : config.scope,
      buildPayload: panelPayload,
      logger: ctx.logger,
    })
  }
}

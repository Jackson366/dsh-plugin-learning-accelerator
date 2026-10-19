/**
 * The model-facing tools.
 *
 * Design rules that come straight out of the harness tool contract
 * (`docs/cookbook/adding-a-tool.md`):
 *
 * - **One canonical JSON value per call.** `output.schema` is the programmatic
 *   API, so it returns the structured summary — not prose a caller would have to
 *   parse. Code Mode reaches the same value via `tools.learning_status(...)`.
 * - **`output.render` owns the model-facing prose.** Explanations live in the
 *   renderer, so the canonical value stays clean.
 * - **Write tools report what changed, not just "ok".** `learning_record`
 *   returns the touched review item, concept progress, and difficulty adjustment,
 *   because that delta is what the agent needs to phrase its state update.
 * - **Read paths never throw on malformed state.** A hand-edited state file must
 *   produce a repairable error payload, not a failed turn.
 *
 * This module is the registry only. Each tool lives in its own file next to this
 * one, so a tool can be read, reviewed, or changed without scrolling past the
 * other four, and so `docs/extending.md` can point at a named file instead of a
 * line number.
 *
 * @see ../../../Learning-Accelerator/references/learning_os_protocol.md
 */
import { learningDomainTool } from './domain.js'
import { learningDueTool } from './due.js'
import { learningRecordTool } from './record.js'
import { learningSessionTool } from './session.js'
import { learningStatusTool } from './status.js'

/**
 * Every tool factory, in registration order.
 *
 * Order is the order the model sees them in the tool list, so it follows the
 * loop a turn runs in: read the state, look at the queue, then act.
 */
const TOOLS = [learningStatusTool, learningDueTool, learningSessionTool, learningRecordTool, learningDomainTool]

/**
 * Register every tool on `ctx`.
 *
 * `ctx.tools.register()` attaches its disposer to the calling plugin, so
 * unloading or hot-reloading this plugin unregisters all of them with no manual
 * bookkeeping.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {object} service - the `LearningAcceleratorService` instance.
 */
export function registerLearningTools(ctx, service) {
  for (const makeTool of TOOLS) ctx.tools.register(makeTool(service))
}

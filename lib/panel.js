/**
 * Panel payload builder.
 *
 * This is the browser half's whole data contract. It is a pure function of the
 * learning state — no Cordis, no HTTP, no clock beyond one `generated_at` stamp —
 * so it can be unit-tested directly and rendered by any transport.
 *
 * The shape is deliberately flat and already sorted: sorting and shaping happen
 * once here rather than on every browser render, and a UI that wants a different
 * order does not have to know the state schema.
 */

import { compareCodePoints } from './learning-store.js'

/**
 * Build the read-only snapshot the Web panel renders.
 *
 * @param {{ summarize: (request: object) => object }} service - the host service
 *   (or any object with the same `summarize` contract).
 * @param {{ stateFile?: string, scope?: 'project' | 'user', cwd?: string }} [request] - scope overrides.
 * @returns {object} a JSON-serializable snapshot. Always returns an object; a
 *   malformed state file produces `{ ok: false, error }` rather than a throw, so
 *   the panel can render the problem instead of an empty frame.
 */
export function panelPayload(service, request = {}) {
  const state = service.summarize({
    stateFile: request.stateFile,
    scope: request.scope,
    cwd: request.cwd,
  })
  if (state.ok === false) {
    return {
      ok: false,
      error: state.error,
      path: state.path,
      scope: state.scope,
      source: state.source,
      generated_at: new Date().toISOString(),
    }
  }

  const summary = state.summary
  const progress = Object.values(summary.concept_progress ?? {})

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    path: state.path,
    scope: state.scope,
    source: state.source,
    profile: {
      learning_domain: summary.learning_domain,
      learning_goal: summary.learning_goal,
      target_outcome: summary.target_outcome,
      known_skills: summary.known_skills,
      level: summary.level,
    },
    topic: summary.current_topic,
    difficulty: {
      current: summary.current_difficulty,
      next_adjustment: summary.next_adjustment,
    },
    mastered_concepts: summary.mastered_concepts,
    weak_concepts: summary.weak_concepts,
    due_reviews: summary.due_reviews,
    priority_reviews: summary.priority_reviews,
    // Weakest first: the panel's job is to make the next thing to fix obvious.
    // The tie-break is code-point order, matching the kernel's ranking rather
    // than a locale collation.
    concept_progress: progress.sort((left, right) => (
      Number(left.strength ?? 0) - Number(right.strength ?? 0)
      || compareCodePoints(left.concept, right.concept)
    )),
    current_tasks: summary.current_tasks,
    counts: {
      exercises: summary.exercise_specs.length,
      attempts: summary.attempt_records.length,
      mastered: summary.mastered_concepts.length,
      weak: summary.weak_concepts.length,
      due: summary.due_reviews.length,
    },
  }
}

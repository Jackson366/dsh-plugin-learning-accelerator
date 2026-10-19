/**
 * Parameter nodes shared by more than one tool.
 *
 * Both describe *where* the learner lives rather than *what* to do, so they are
 * declared once and spread into each tool's `parameters`.
 */

/** Shared parameter node: where the state lives, when it is not the default. */
export const STATE_FILE_PARAM = {
  type: 'string',
  description:
    "Path to the learning state JSON file. Omit to use the session working directory's .learning/state.json.",
}

export const SCOPE_PARAM = {
  type: 'string',
  enum: ['project', 'user'],
  description:
    "Which store to use: 'project' (default, ./.learning/state.json) or 'user' (~/.learning-accelerator/state.json).",
}

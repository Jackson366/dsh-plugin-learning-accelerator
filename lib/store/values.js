/**
 * The free-function half of the port: date arithmetic, ordering, ids, and the
 * review / exercise constructors.
 *
 * These are exactly the parts of the kernel that hold no state, which is why
 * they can be read (and tested) without a filesystem. `learning-store.js`
 * re-exports the public ones, so the module's surface is unchanged.
 *
 * @see ../../../Learning-Accelerator/learning_accelerator/state.py
 */
import { createHash } from 'node:crypto'

import {
  EXERCISE_DIFFICULTIES,
  LearningStateError,
  REVIEW_INTERVALS_BY_RESULT,
  REVIEW_RESULTS,
} from './schema.js'

/* ------------------------------------------------------------------ *
 * Pure helpers — kept module-private so the exported surface stays the
 * store's public API, exactly as the Python module keeps them private.
 * ------------------------------------------------------------------ */

/** Today in local time as `YYYY-MM-DD`, matching Python `date.today()`. */
export function todayIso(now = new Date()) {
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Add whole days to an ISO calendar date, matching Python `timedelta`. */
export function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number)
  // Date.UTC keeps the arithmetic DST-free; the value is read back in UTC.
  const base = Date.UTC(year, month - 1, day) + days * 86_400_000
  const next = new Date(base)
  return todayIso({
    getFullYear: () => next.getUTCFullYear(),
    getMonth: () => next.getUTCMonth(),
    getDate: () => next.getUTCDate(),
  })
}

/** Structural clone for plain JSON data. */
export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/** Python's `_deep_merge`: loaded scalars and lists win, objects merge. */
export function deepMerge(base, loaded) {
  const merged = clone(base)
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) return merged
  for (const [key, value] of Object.entries(loaded)) {
    const current = merged[key]
    if (value && typeof value === 'object' && !Array.isArray(value)
      && current && typeof current === 'object' && !Array.isArray(current)) {
      merged[key] = deepMerge(current, value)
    } else {
      merged[key] = clone(value)
    }
  }
  return merged
}

/** Python's `_ensure_list`: absent becomes empty, non-list is malformed. */
export function ensureList(value, fieldName) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new LearningStateError(`${fieldName} must be a list`)
  return value
}

/**
 * Compare two strings the way Python's `<` does: by **Unicode code point**.
 *
 * `String.prototype.localeCompare` is the wrong tool here. It compares by a
 * locale collation, which is case-insensitive at the primary level and orders by
 * alphabet rather than by code point, so `'aaa'.localeCompare('B') < 0` while
 * Python says `'aaa' > 'B'`. Any list the kernel ranks by a string tie-break
 * would therefore come out in a different order than the Python store's — the
 * state files stay byte-identical, but the *order the model sees* silently
 * diverges. Iterating with `for...of` yields whole code points (so surrogate
 * pairs compare as the single character they encode), and `>, <` on a
 * one-code-point string compares its numeric value. That is exactly Python's
 * semantics for the BMP and above.
 */
export function compareCodePoints(left, right) {
  const a = Array.from(String(left ?? ''))
  const b = Array.from(String(right ?? ''))
  const shared = Math.min(a.length, b.length)
  for (let index = 0; index < shared; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  // One is a prefix of the other: the shorter sorts first, as in Python.
  return a.length - b.length
}

/** Stable 12-hex-char id, byte-identical to Python's `_stable_id`. */
export function stableId(...parts) {
  const normalized = parts.map(part => String(part).trim().toLowerCase()).join('\n')
  return createHash('sha1').update(normalized, 'utf8').digest('hex').slice(0, 12)
}

/** Python's `_upsert_by_id`: merge by `id`, else append. */
export function upsertById(items, item) {
  const index = items.findIndex(existing => existing?.id === item.id)
  if (index >= 0) {
    items[index] = { ...items[index], ...item }
    return items
  }
  items.push(item)
  return items
}

/** Deterministic key order for byte-compatible `sort_keys=True` output. */
export function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key])
    return out
  }
  return value
}

/* ------------------------------------------------------------------ *
 * Review / exercise constructors — the free-function half of the port.
 * ------------------------------------------------------------------ */

/**
 * Create a review item using the default spaced-repetition intervals.
 * @param {string} concept - the concept under review.
 * @param {string} prompt - the recall prompt shown to the learner.
 * @param {keyof typeof REVIEW_INTERVALS_BY_RESULT} [result] - recall outcome.
 * @param {string} [source] - where the item came from (`manual`, `attempt`, …).
 * @param {string} [today] - ISO date override, for deterministic tests.
 */
export function createReviewItem(concept, prompt, result = 'correct', source = 'manual', today) {
  if (!Object.hasOwn(REVIEW_INTERVALS_BY_RESULT, result)) {
    throw new LearningStateError(`result must be one of: ${REVIEW_RESULTS.slice().sort().join(', ')}`)
  }
  const baseDay = today ?? todayIso()
  return {
    id: stableId('review', concept, prompt),
    concept,
    prompt,
    source,
    result,
    created_at: baseDay,
    due_at: addDays(baseDay, REVIEW_INTERVALS_BY_RESULT[result]),
  }
}

/**
 * Create a structured exercise specification for agent-generated practice.
 * The model drafts the task, hint, and criteria; the store owns the stable id.
 */
export function createExerciseSpec({
  topic,
  concepts,
  difficulty,
  task,
  goal,
  input = '',
  expected_output = '',
  constraints = [],
  evaluation_criteria = [],
  hint = '',
  created_at,
}) {
  if (!EXERCISE_DIFFICULTIES.includes(difficulty)) {
    throw new LearningStateError(`difficulty must be one of: ${EXERCISE_DIFFICULTIES.slice().sort().join(', ')}`)
  }
  if (!String(task ?? '').trim()) throw new LearningStateError('task must not be empty')
  const cleanConcepts = (concepts ?? []).map(concept => String(concept).trim()).filter(Boolean)
  if (cleanConcepts.length === 0) throw new LearningStateError('concepts must contain at least one concept')
  const cleanTask = String(task).trim()
  return {
    id: stableId('exercise-spec', topic, cleanConcepts.join(','), difficulty, cleanTask),
    topic: String(topic ?? '').trim(),
    concepts: cleanConcepts,
    difficulty,
    goal: (goal ? String(goal).trim() : `Practice ${cleanConcepts.join(', ')}`),
    task: cleanTask,
    input,
    expected_output,
    constraints,
    evaluation_criteria,
    hint,
    created_at: created_at ?? todayIso(),
  }
}

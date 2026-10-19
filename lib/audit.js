/** Append-only audit beside state.json; keeps upstream Python state format untouched. */
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const auditPath = stateFile => join(dirname(stateFile), 'audit.jsonl')
const short = value => typeof value === 'string' ? value.slice(0, 500) : ''
export function auditMetadata(args, path) {
  return {
    event_id: randomUUID(), timestamp: new Date().toISOString(), state_path: path,
    action: args?.action ?? 'unknown', source: 'model_tool',
    request_id: short(args?.request_id) || null,
    evidence_ref: short(args?.evidence_ref) || null,
    evidence_kind: args?.evidence_ref ? 'model_reference_unverified' : 'model_assessment_unverified',
    evaluation_reason: short(args?.evaluation_reason) || null,
    submitted_result: args?.result ?? args?.attempt_result ?? args?.exercise_status ?? null,
  }
}
export function progressSnapshot(state, names = []) {
  const concepts = {}
  for (const name of [...new Set(names.filter(x => typeof x === 'string' && x.trim()))].slice(0, 20)) {
    const row = state.topic_state?.concept_progress?.[name]
    concepts[name] = row ? {
      strength: row.strength, correct_streak: row.correct_streak, attempts: row.attempts,
      failure_count: row.failure_count, next_due_at: row.next_due_at,
      mastered: state.topic_state.mastered_concepts.includes(name),
      weak: state.topic_state.weak_concepts.includes(name),
    } : null
  }
  return {
    concepts, difficulty: state.difficulty_state?.current_difficulty,
    review_history: state.review_state?.review_history?.length ?? 0,
    pending_reviews: (state.review_state?.due_items?.length ?? 0) + (state.review_state?.next_review_items?.length ?? 0),
    attempts: state.practice_state?.attempt_records?.length ?? 0,
    exercises: state.practice_state?.exercise_specs?.length ?? 0,
    tasks: state.practice_state?.current_tasks?.length ?? 0,
  }
}
export class LearningAuditStore {
  constructor(stateFile) { this.path = auditPath(stateFile) }
  append(event) {
    mkdirSync(dirname(this.path), { recursive: true })
    appendFileSync(this.path, JSON.stringify(event) + '\n', 'utf8')
    return this.path
  }
  recent(limit = 20) {
    if (!existsSync(this.path)) return []
    const rows = readFileSync(this.path, 'utf8').split('\n').filter(Boolean)
    return rows.slice(-limit).reverse().map(row => JSON.parse(row))
  }
}

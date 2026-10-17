/**
 * `learning_status` — The turn's entry point: read the current learner snapshot.
 *
 * Reads the profile, topic, mastered and weak concepts, the due and priority
 * queues, the next tasks, and the difficulty state in one call.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { SCHEMA_VERSION } from '../learning-store.js'
import { SCOPE_PARAM, STATE_FILE_PARAM } from './shared.js'

export function learningStatusTool(service) {
  return defineTool({
    name: 'learning_status',
    description:
      'Read the learner profile, current topic, mastered and weak concepts, due and priority reviews, '
      + 'open exercise specs, recent attempts, current tasks, and difficulty. Call this first in any '
      + 'learning, review, practice, or calibration turn.',
    parameters: {
      state_file: STATE_FILE_PARAM,
      scope: SCOPE_PARAM,
      due_limit: { type: 'number', description: 'How many priority review items to include (default 5).' },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) {
        if (value.ok === false) {
          return [{
            type: 'text',
            text: `学习状态读取失败：${value.error}\n状态文件：\`${value.path || '未解析'}\`\n`
              + '如果文件是手工改坏的，先用 write 修回合法 JSON 再继续。',
          }]
        }
        const s = value.summary
        const line = (label, items) => `- ${label}：${items.length ? items.join('、') : '无'}`
        const lines = [
          `**状态文件**：\`${value.path}\`（来源：${value.source}）`,
          `**学习领域**：${s.learning_domain}　**难度**：${s.current_difficulty}/5（下一步 ${s.next_adjustment}）`,
          `**当前主题**：${s.current_topic || '未设置'}　**层级**：${s.level}`,
          `**学习目标**：${s.learning_goal || '未设置'}`,
          `**目标结果**：${s.target_outcome || '未设置'}`,
          '',
          line('已掌握', s.mastered_concepts),
          line('薄弱点', s.weak_concepts),
          line('到期复习', s.due_reviews.map(item => item.concept).filter(Boolean)),
          line('下一步任务', s.current_tasks.map(task => task.name)),
          '',
          s.priority_reviews.length
            ? `**优先复习**（${s.priority_reviews.length} 项）\n${s.priority_reviews.map(item => `- [${item.priority}] ${item.concept}（strength ${item.strength}）→ ${item.prompt}`).join('\n')}`
            : '**优先复习**：暂无',
          '',
          `**待做练习**：${s.exercise_specs.length} 个　**历史尝试**：${s.attempt_records.length} 条`,
        ]
        if (s.weak_concepts.length === 0 && s.mastered_concepts.length === 0 && !s.current_topic) {
          lines.push('', '状态几乎为空：如果用户还没有说明背景，先走 onboarding，用 `learning_session` 建档。')
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
      presentationMeta(_args, value) {
        return {
          title: 'learning_status',
          status: value?.ok === false ? 'error' : 'ok',
          path: value?.path ?? '',
          due: value?.summary?.due_reviews?.length ?? 0,
          weak: value?.summary?.weak_concepts?.length ?? 0,
        }
      },
    },
    async execute(args, exec) {
      const state = service.summarize({ stateFile: args.state_file, scope: args.scope, agent: exec.agent })
      if (state.ok === false) return { ...state, schema_version: SCHEMA_VERSION }
      const limit = Number.isFinite(args.due_limit) && args.due_limit >= 0 ? Math.trunc(args.due_limit) : 5
      // `store.summary()` returns the kernel's own 5-item slice of
      // `priorityReviews()`, so slicing that again could only ever shrink the
      // list. Rank the full queue through the store so `due_limit` works in both
      // directions. `summarize()` always builds the summary for "today", so the
      // full queue is ranked for the same day.
      const binding = service.storeFor({ stateFile: args.state_file, scope: args.scope, agent: exec.agent })
      return {
        ...state,
        schema_version: SCHEMA_VERSION,
        summary: {
          ...state.summary,
          priority_reviews: binding.store.priorityReviews(undefined, Infinity).slice(0, limit),
        },
      }
    },
    presentCall() {
      return { card: 'generic', title: 'learning_status', kind: 'read' }
    },
    presentResult(args, result) {
      const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('')
      return { card: 'generic', title: 'learning_status', content: text, locations: args.state_file ? [{ path: args.state_file }] : undefined }
    },
  })
}

/**
 * `learning_due` — The review queue, ranked.
 *
 * Returns what is due on one local date, already ranked, so the caller never has
 * to re-sort or re-derive "what to review first".
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { todayIso } from '../learning-store.js'
import { SCOPE_PARAM, STATE_FILE_PARAM } from './shared.js'

export function learningDueTool(service) {
  return defineTool({
    name: 'learning_due',
    description:
      'List spaced-repetition items that are due, ranked by weak-concept status, low strength, and repeated ' +
      'failures. Use it before teaching new material, or when the learner asks what to review.',
    parameters: {
      state_file: STATE_FILE_PARAM,
      scope: SCOPE_PARAM,
      on_date: {
        type: 'string',
        description: 'ISO date (YYYY-MM-DD) to treat as today. Defaults to the real today.',
      },
      limit: { type: 'number', description: 'Maximum items to return (default 5).' },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) {
        if (value.ok === false) {
          return [
            {
              type: 'text',
              text: `无法读取学习状态：${value.error}\n状态文件：\`${value.path || '未解析'}\``,
            },
          ]
        }
        if (value.items.length === 0) {
          return [
            {
              type: 'text',
              text: `没有到期复习项（检查日期 ${value.on_date}，共 ${value.total_due} 项待复习）。`,
            },
          ]
        }
        const rows = value.items.map(
          (item, index) =>
            `${index + 1}. **${item.concept}**（优先级 ${item.priority}，strength ${item.strength}，到期 ${item.due_at}）\n` +
            `   回述题：${item.prompt}`,
        )
        return [
          {
            type: 'text',
            text:
              `到期复习项（共 ${value.total_due} 项，返回前 ${value.items.length} 项）：\n\n${rows.join('\n')}\n\n` +
              '给用户出题时不要泄露答案；用户答完用 `learning_record` 记下 recall 结果。',
          },
        ]
      },
      presentationMeta(_args, value) {
        return {
          title: 'learning_due',
          status: value?.ok === false ? 'error' : 'ok',
          count: value?.items?.length ?? 0,
        }
      },
    },
    async execute(args, exec) {
      const binding = service.storeFor({
        stateFile: args.state_file,
        scope: args.scope,
        agent: exec.agent,
      })
      const onDate = typeof args.on_date === 'string' && args.on_date.length > 0 ? args.on_date : undefined
      const limit = Number.isFinite(args.limit) && args.limit >= 0 ? Math.trunc(args.limit) : 5
      // `priorityReviews` defaults `limit` to 5 (matching the Python kernel's
      // `summary()`); asking it for the whole queue is what lets `limit` here be
      // honoured above 5 instead of being a cap of five.
      const all = binding.store.priorityReviews(onDate, Infinity)
      return {
        ok: true,
        path: binding.path,
        source: binding.source,
        // Local calendar day, matching the kernel's `todayIso()`. A UTC
        // `toISOString()` slice would name yesterday for the first hours of a
        // UTC+ offset's day, disagreeing with the due-date comparison.
        on_date: onDate ?? todayIso(),
        total_due: all.length,
        items: all.slice(0, limit),
      }
    },
    presentCall() {
      return { card: 'generic', title: 'learning_due', kind: 'search' }
    },
    presentResult(args, result) {
      const text = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
      return {
        card: 'generic',
        title: 'learning_due',
        content: text,
        locations: args.state_file ? [{ path: args.state_file }] : undefined,
      }
    },
  })
}

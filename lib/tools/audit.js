import { defineTool } from '@deepseek-ai/dsh-tools'
import { LearningAuditStore } from '../audit.js'
import { STATE_FILE_PARAM, SCOPE_PARAM } from './shared.js'

export function learningAuditTool(service) {
  return defineTool({
    name: 'learning_audit',
    description: 'Read recent assessment validation and write-audit events, without exposing raw learner answers.',
    parameters: {
      state_file: STATE_FILE_PARAM,
      scope: SCOPE_PARAM,
      limit: { type: 'number', description: 'Number of recent events (1-100; default 20).' },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    },
    async execute(args, exec) {
      const binding = service.storeFor({ stateFile: args.state_file, scope: args.scope, agent: exec.agent })
      const audit = new LearningAuditStore(binding.path)
      const limit = Number.isFinite(args.limit) ? Math.max(1, Math.min(100, Math.trunc(args.limit))) : 20
      return { ok: true, path: audit.path, items: audit.recent(limit) }
    },
  })
}

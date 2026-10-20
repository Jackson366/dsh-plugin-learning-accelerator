// Human-only /learn command for interactive DSH clients. Optional for headless/ACP.
const HELP = [
  '学习快捷指令：',
  '/learn start <主题> — 创建或切换学习主题（保留原有进度）',
  '/learn status — 当前目标、进度、难度与待办',
  '/learn review — 列出优先级最高的 5 条到期复习题',
  '/learn practice — 列出近期练习题和下一步任务',
  '/learn mistakes — 查看最近 5 条错误诊断',
  '/learn help — 查看帮助',
  '',
  '命令直接操作学习状态，不会调用模型；出题、讲解、评估回答请在普通对话中提出。',
].join('\n')

function success(text) {
  return { kind: 'success', text }
}

function error(text) {
  return { kind: 'error', text }
}

function shown(value, fallback = '未设置') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function names(values, fallback = '无') {
  return values?.length ? values.join('、') : fallback
}

export function executeLearnCommand(service, config = {}, { agent, rawInput = '', signal } = {}) {
  if (signal?.aborted) return error('指令已取消，学习状态未改变。')
  const input = String(rawInput).trim()
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(input)
  const subcommand = match?.[1]?.toLowerCase() ?? 'help'
  const argument = match?.[2]?.trim() ?? ''
  if (subcommand === 'help' && !argument) return success(HELP)
  if (
    !['start', 'status', 'review', 'practice', 'mistakes'].includes(subcommand) ||
    (subcommand !== 'start' && argument)
  ) {
    return error(`不支持该指令或参数。\n\n${HELP}`)
  }
  if (subcommand === 'start' && (!argument || argument.length > 160 || /[\r\n]/.test(argument))) {
    return error('用法：/learn start <主题>（主题长度 1–160 字符，不允许换行）。')
  }

  const request = { stateFile: config.stateFile, scope: config.scope, agent }
  try {
    if (subcommand === 'start') {
      const { store, path } = service.storeFor(request)
      if (signal?.aborted) return error('指令已取消，学习状态未改变。')
      store.setTopic(argument)
      return success(`已设置当前学习主题：${argument}\n状态文件：${path}\n保留原有学习进度。可用 /learn status 查看，或直接对话开始学习。`)
    }

    const snapshot = service.summarize(request)
    if (snapshot.ok === false) {
      return error(`学习状态读取失败：${snapshot.error}\n状态文件：${shown(snapshot.path)}`)
    }
    const { summary: s, path } = snapshot
    if (subcommand === 'status') {
      return success([
        `状态文件：${path}`,
        `学习领域：${shown(s.learning_domain)}　主题：${shown(s.current_topic)}`,
        `学习目标：${shown(s.learning_goal)}`,
        `当前难度：${s.current_difficulty}/5　已掌握：${s.mastered_concepts.length}　薄弱点：${s.weak_concepts.length}`,
        `到期复习：${s.due_reviews.length}　待做练习：${s.exercise_specs.length}`,
        `薄弱知识点：${names(s.weak_concepts)}`,
        `下一步任务：${names(s.current_tasks.map((task) => task.name))}`,
      ].join('\n'))
    }
    if (subcommand === 'review') {
      const { store } = service.storeFor(request)
      const all = store.priorityReviews(undefined, Infinity)
      if (!all.length) return success(`当前没有到期复习项。\n状态文件：${path}`)
      return success([
        `到期复习共 ${all.length} 项，按优先级展示前 5 项：`,
        ...all.slice(0, 5).map(
          (item, index) =>
            `${index + 1}. ${shown(item.concept)}（到期 ${shown(item.due_at)}，ID: ${shown(item.id)}）\n   问题：${shown(item.prompt)}`,
        ),
        '请在普通对话中回答，让 Agent 评估后经 learning_record 记录；此指令不会自动判分。',
        `状态文件：${path}`,
      ].join('\n'))
    }
    if (subcommand === 'practice') {
      const exercises = s.exercise_specs.slice(-5).map((item, index) =>
        `${index + 1}. [${shown(item.difficulty, 'normal')}] ${shown(item.task)}（ID: ${shown(item.id)}）`,
      )
      const tasks = s.current_tasks.slice(-5).map((item, index) => `${index + 1}. ${shown(item.name)}`)
      return success([
        `当前主题：${shown(s.current_topic)}　练习题共 ${s.exercise_specs.length} 道`,
        '最近练习题：',
        ...(exercises.length ? exercises : ['暂无，告诉 Agent「根据薄弱点出题」可生成练习。']),
        '下一步任务：',
        ...(tasks.length ? tasks : ['暂无']),
        `状态文件：${path}`,
      ].join('\n'))
    }
    const { store } = service.storeFor(request)
    const mistakes = (store.load().practice_state.last_code_errors ?? []).slice(-5).reverse()
    return success([
      `最近错误诊断（${mistakes.length} 条）：`,
      ...(mistakes.length
        ? mistakes.map(
            (item, index) =>
              `${index + 1}. ${shown(item.concept)}（${shown(item.recorded_at)}）— ${shown(item.detail, '未记录原因')}`,
          )
        : ['暂无错误记录。']),
      `状态文件：${path}`,
    ].join('\n'))
  } catch (cause) {
    return error(`学习指令执行失败：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

export function registerLearnCommand(ctx, service, config = {}) {
  return ctx.commands.register({
    name: 'learn',
    description: '学习管理：start / status / review / practice / mistakes',
    input: { hint: '[start <主题>|status|review|practice|mistakes|help]' },
    handler: (invocation) => executeLearnCommand(service, config, invocation),
  })
}

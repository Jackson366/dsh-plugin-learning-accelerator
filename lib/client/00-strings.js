/**
 * Both locale dictionaries, and nothing else.
 *
 * Keys are grouped by the surface that reads them, in render order, so a missing
 * translation is visible next to its siblings rather than buried. `tests/*`
 * asserts that `zh` and `en` declare exactly the same keys.
 *
 * Two labels that used to collide now say different things on purpose:
 * `panel.profile` titles the section that holds the goal and the concept counts,
 * while `panel.file` labels the state-file path in the footer. Reusing one key
 * for both printed the same words twice on one screen, meaning two different
 * things.
 */
const STRINGS = {
  zh: {
    'view.learning': '学习',
    'panel.title': '学习加速器',
    'panel.refresh': '刷新',
    'panel.loading': '正在读取学习状态…',
    'panel.updated': '更新于',

    'panel.due': '现在复习',
    'panel.noReview': '现在没有到期复习项。',
    'panel.dueRatio': '当前显示 / 到期总数',
    'panel.copy': '复制复习清单',
    'panel.copyHint': '把待复习的概念和问题复制到剪贴板',

    'panel.profile': '学习档案',
    'panel.goal': '目标',
    'panel.topic': '当前主题',
    'panel.outcome': '目标产出',
    'panel.counts': '进度',
    'panel.attempts': '尝试',
    'panel.mastered': '已掌握',

    'panel.progress': '其他概念',
    'panel.progressMore': '还有 {n} 个未显示',
    'panel.tasks': '下一步任务',

    'panel.failures': '失败',
    'panel.streak': '连对',
    'panel.overdue': '逾期',
    'panel.dayShort': '天',
    'panel.weak': '偏弱',

    'panel.empty.title': '还没有学习档案',
    'panel.empty.body': '这个学习空间没有状态文件。在对话框里直接开始一次学习，或者贴下面这句让 agent 建档：',
    'panel.empty.starter': '帮我用 learning_session 建一份学习档案，我想学 <主题>',

    'sidebar.label': '学习',
    'sidebar.none': '学习：暂无到期复习',
    'sidebar.due': '学习：{n} 项待复习',

    'error.route': '读不到面板数据：宿主路由未挂载或已被拒绝。',
    'error.state': '读不到学习状态',
    'error.state.detail': '状态文件存在但无法解析，进度不会显示。修好后点“刷新”。',
    'error.route.detail': '宿主路由没有挂载，面板拿不到数据。',

    'panel.file': '状态文件',
    'panel.difficulty': '难度',
    'domain.general': '通用',
    'domain.technology': '技术',
    'domain.language': '语言',
    'domain.exam': '应试',
    'domain.writing': '写作',
    'domain.communication': '沟通',
    'level.unknown': '未定',
    'level.no_programming': '无编程基础',
    'level.beginner': '入门',
    'level.intermediate': '中级',
    'level.advanced': '进阶',
    'adjust.easier': '下调',
    'adjust.same': '不变',
    'adjust.harder': '上调',
  },
  en: {
    'view.learning': 'Learning',
    'panel.title': 'Learning Accelerator',
    'panel.refresh': 'Refresh',
    'panel.loading': 'Reading learning state…',
    'panel.updated': 'Updated',

    'panel.due': 'Due now',
    'panel.noReview': 'Nothing is due right now.',
    'panel.dueRatio': 'shown / total due',
    'panel.copy': 'Copy review list',
    'panel.copyHint': 'Copy the due concepts and questions to the clipboard',

    'panel.profile': 'Learning file',
    'panel.goal': 'Goal',
    'panel.topic': 'Topic',
    'panel.outcome': 'Target outcome',
    'panel.counts': 'Progress',
    'panel.attempts': 'attempts',
    'panel.mastered': 'Mastered',

    'panel.progress': 'Other concepts',
    'panel.progressMore': '{n} more not shown',
    'panel.tasks': 'Next tasks',

    'panel.failures': 'fails',
    'panel.streak': 'streak',
    'panel.overdue': 'overdue',
    'panel.dayShort': 'd',
    'panel.weak': 'weak',

    'panel.empty.title': 'No learning file yet',
    'panel.empty.body':
      'There is no state file in this learning scope. Start a learning turn in the chat, or paste this to have the agent create one:',
    'panel.empty.starter': 'Use learning_session to create a learning file; I want to learn <topic>',

    'sidebar.label': 'Learning',
    'sidebar.none': 'Learning: nothing due',
    'sidebar.due': 'Learning: {n} due',

    'error.route': 'Panel data unavailable: the host route is missing or was refused.',
    'error.state': 'The learning state file could not be read',
    'error.state.detail': 'The file exists but does not parse, so progress is hidden. Fix it and press Refresh.',
    'error.route.detail': 'The host route is not mounted, so the panel has no data to show.',

    'panel.file': 'State file',
    'panel.difficulty': 'Difficulty',
    'domain.general': 'General',
    'domain.technology': 'Technology',
    'domain.language': 'Language',
    'domain.exam': 'Exam',
    'domain.writing': 'Writing',
    'domain.communication': 'Communication',
    'level.unknown': 'Unset',
    'level.no_programming': 'No programming',
    'level.beginner': 'Beginner',
    'level.intermediate': 'Intermediate',
    'level.advanced': 'Advanced',
    'adjust.easier': 'easier',
    'adjust.same': 'steady',
    'adjust.harder': 'harder',
  },
}

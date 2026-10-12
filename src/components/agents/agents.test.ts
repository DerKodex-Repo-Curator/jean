import { describe, expect, it } from 'vitest'
import type { AgentApproval, AgentSummary } from '@/services/agents'
import { agentStatusLabel, findAgent } from './agents'
import { describeApproval, formatRelative } from './AgentActivity'
import { taskStatusLabel } from './AgentTasks'
import { formatInterval } from './AgentSchedules'
import { splitNotifications } from './AgentInbox'

function agent(overrides: Partial<AgentSummary>): AgentSummary {
  return {
    id: 'jean',
    name: 'Jean',
    description: '',
    icon: 'jean',
    rolePrompt: '',
    worktreeId: '__jean_agent__',
    paused: false,
    maxWakesPerHour: 12,
    builtin: true,
    status: 'idle',
    homeSessionId: null,
    pendingUpdates: 0,
    pendingApprovals: 0,
    activeDelegations: 0,
    nextScheduleAt: null,
    budgetReached: false,
    tasksWorktreeId: '__agent_tasks_jean__',
    runningTasks: 0,
    unreadNotifications: 0,
    ...overrides,
  }
}

describe('agentStatusLabel', () => {
  it('puts paused and approvals before other states', () => {
    expect(
      agentStatusLabel(agent({ status: 'paused', pendingApprovals: 2 }))
    ).toBe('Paused')
    expect(
      agentStatusLabel(agent({ status: 'working', pendingApprovals: 2 }))
    ).toBe('Needs approval (2)')
  })

  it('shows work, waiting, budget and followed sessions', () => {
    expect(agentStatusLabel(agent({ status: 'working' }))).toBe('Working')
    expect(
      agentStatusLabel(agent({ status: 'working', runningTasks: 2 }))
    ).toBe('Working (2 tasks)')
    expect(agentStatusLabel(agent({ unreadNotifications: 1 }))).toBe(
      '1 new notification'
    )
    expect(agentStatusLabel(agent({ status: 'waiting' }))).toBe(
      'Waiting for you'
    )
    expect(agentStatusLabel(agent({ budgetReached: true }))).toBe(
      'Hourly limit reached'
    )
    expect(agentStatusLabel(agent({ activeDelegations: 1 }))).toBe(
      'Following 1 session'
    )
    expect(agentStatusLabel(agent({ activeDelegations: 3 }))).toBe(
      'Following 3 sessions'
    )
    expect(agentStatusLabel(agent({}))).toBe('Idle')
  })
})

describe('findAgent', () => {
  const agents = [agent({}), agent({ id: 'reviewer', builtin: false })]

  it('finds by id and falls back to the first agent', () => {
    expect(findAgent(agents, 'reviewer')?.id).toBe('reviewer')
    expect(findAgent(agents, 'deleted-agent')?.id).toBe('jean')
    expect(findAgent(undefined, 'jean')).toBeUndefined()
  })
})

describe('formatRelative', () => {
  const now = 1_000_000_000_000

  it('formats past and future times', () => {
    expect(formatRelative(now / 1000, now)).toBe('now')
    expect(formatRelative(now / 1000 - 120, now)).toBe('2m ago')
    expect(formatRelative(now / 1000 + 7200, now)).toBe('in 2h')
    expect(formatRelative(now / 1000 - 3 * 86_400, now)).toBe('3d ago')
  })
})

describe('describeApproval', () => {
  it('names the action and its worktree', () => {
    const approval: AgentApproval = {
      id: 1,
      agentId: 'jean',
      tool: 'permanently_delete_worktree',
      args: { worktreeId: 'wt-1' },
      status: 'pending',
      result: null,
      createdAt: 0,
    }
    expect(describeApproval(approval)).toBe('Permanently delete worktree wt-1')
    expect(describeApproval({ ...approval, tool: 'custom', args: {} })).toBe(
      'custom'
    )
  })
})

describe('taskStatusLabel', () => {
  it('explains waiting tasks', () => {
    expect(taskStatusLabel('waiting')).toBe('waiting for sessions')
    expect(taskStatusLabel('done')).toBe('done')
  })
})

describe('formatInterval', () => {
  it('uses the largest whole unit', () => {
    expect(formatInterval(30 * 60)).toBe('every 30m')
    expect(formatInterval(2 * 3600)).toBe('every 2h')
    expect(formatInterval(86_400)).toBe('every 1d')
    expect(formatInterval(90 * 60)).toBe('every 90m')
  })
})

describe('splitNotifications', () => {
  it('keeps unread apart from read and keeps order', () => {
    const n = (id: number, readAt: number | null) => ({
      id,
      agentId: 'jean',
      sessionId: null,
      level: 'info',
      message: `m${id}`,
      createdAt: id,
      readAt,
    })
    const { unread, read } = splitNotifications([
      n(3, null),
      n(2, 5),
      n(1, null),
    ])
    expect(unread.map(x => x.id)).toEqual([3, 1])
    expect(read.map(x => x.id)).toEqual([2])
  })
})

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'paused'

export interface AgentSummary {
  id: string
  name: string
  description: string
  icon: string
  rolePrompt: string
  worktreeId: string
  paused: boolean
  maxWakesPerHour: number
  builtin: boolean
  status: AgentStatus
  homeSessionId: string | null
  pendingUpdates: number
  pendingApprovals: number
  activeDelegations: number
  nextScheduleAt: number | null
  budgetReached: boolean
  /** Worktree ID of the agent's background task sessions */
  tasksWorktreeId: string
  runningTasks: number
  unreadNotifications: number
}

export interface AgentTask {
  id: number
  agentId: string
  sessionId: string
  title: string
  /** schedule | delegation | message | approval */
  kind: string
  /** running | waiting | done | failed | cancelled */
  status: string
  summary: string | null
  createdAt: number
  updatedAt: number
}

export interface AgentNotification {
  id: number
  agentId: string
  sessionId: string | null
  /** info | action | error */
  level: string
  message: string
  createdAt: number
  readAt: number | null
}

export interface AgentDelegation {
  id: number
  agentId: string
  sessionId: string
  worktreeId: string
  hop: number
  /** active | waiting | done | failed | cancelled */
  status: string
  lastEvent: string | null
  lastError: string | null
  lastSummary: string | null
  checkAfter: number | null
  updatedAt: number
}

export interface AgentSchedule {
  id: number
  agentId: string
  name: string
  prompt: string
  everySecs: number | null
  nextRunAt: number
  lastRunAt: number | null
}

export interface AgentApproval {
  id: number
  agentId: string
  tool: string
  args: Record<string, unknown>
  /** pending | approved | denied | failed */
  status: string
  result: string | null
  createdAt: number
}

export type MemoryKind = 'rule' | 'fact' | 'open_work'

export interface AgentMemory {
  id: number
  /** null = shared by all agents */
  agentId: string | null
  projectId: string | null
  kind: MemoryKind
  content: string
  pinned: boolean
  createdAt: number
  updatedAt: number
  expiresAt: number | null
}

export interface AgentDetails {
  delegations: AgentDelegation[]
  schedules: AgentSchedule[]
  approvals: AgentApproval[]
  memories: AgentMemory[]
  tasks: AgentTask[]
  notifications: AgentNotification[]
}

export interface AgentPatch {
  name?: string
  description?: string
  icon?: string
  rolePrompt?: string
  paused?: boolean
  maxWakesPerHour?: number
}

export const agentsQueryKeys = {
  all: ['agents'] as const,
  list: () => [...agentsQueryKeys.all, 'list'] as const,
  details: (agentId: string) =>
    [...agentsQueryKeys.all, 'details', agentId] as const,
  workdir: (agentId: string) =>
    [...agentsQueryKeys.all, 'workdir', agentId] as const,
}

export function useAgentsList(enabled = true) {
  return useQuery({
    queryKey: agentsQueryKeys.list(),
    queryFn: () => invoke<AgentSummary[]>('list_agents'),
    enabled,
    staleTime: 10_000,
  })
}

export function useAgentDetails(agentId: string | null) {
  return useQuery({
    queryKey: agentsQueryKeys.details(agentId ?? ''),
    queryFn: () =>
      invoke<AgentDetails>('get_agent_details', { agentId: agentId ?? '' }),
    enabled: !!agentId,
    staleTime: 10_000,
  })
}

export function useAgentWorkdir(agentId: string | null) {
  return useQuery({
    queryKey: agentsQueryKeys.workdir(agentId ?? ''),
    queryFn: () =>
      invoke<string>('get_agent_workdir', { agentId: agentId ?? '' }),
    enabled: !!agentId,
    staleTime: Infinity,
  })
}

/** Mutation that refreshes all agent data when it succeeds. */
function useAgentsMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentsQueryKeys.all }),
  })
}

export function useCreateAgent() {
  return useAgentsMutation(
    (args: {
      name: string
      description: string
      icon: string
      rolePrompt: string
    }) => invoke<AgentSummary>('create_agent', args)
  )
}

export function useUpdateAgent() {
  return useAgentsMutation((args: { agentId: string; patch: AgentPatch }) =>
    invoke<AgentSummary>('update_agent', args)
  )
}

export function useDeleteAgent() {
  return useAgentsMutation((args: { agentId: string }) =>
    invoke<null>('delete_agent', args)
  )
}

export function useDecideAgentApproval() {
  return useAgentsMutation((args: { approvalId: number; approve: boolean }) =>
    invoke<AgentApproval>('decide_agent_approval', args)
  )
}

export function useCancelAgentSchedule() {
  return useAgentsMutation((args: { agentId: string; scheduleId: number }) =>
    invoke<null>('cancel_agent_schedule', args)
  )
}

export function useSaveAgentMemory() {
  return useAgentsMutation(
    (args: {
      agentId: string
      content: string
      kind: MemoryKind
      shared: boolean
      pinned: boolean
    }) => invoke<AgentMemory>('save_agent_memory', args)
  )
}

export function useUpdateAgentMemory() {
  return useAgentsMutation(
    (args: {
      agentId: string
      memoryId: number
      patch: { content?: string; kind?: MemoryKind; pinned?: boolean }
    }) => invoke<AgentMemory>('update_agent_memory', args)
  )
}

export function useDeleteAgentMemory() {
  return useAgentsMutation((args: { agentId: string; memoryId: number }) =>
    invoke<null>('delete_agent_memory', args)
  )
}

export function useMarkAgentNotificationsRead() {
  return useAgentsMutation((args: { agentId: string }) =>
    invoke<null>('mark_agent_notifications_read', args)
  )
}

export function exportAgentMemory(agentId: string): Promise<string> {
  return invoke<string>('export_agent_memory', { agentId })
}

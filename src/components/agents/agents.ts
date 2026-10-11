import { useAgentsList, type AgentSummary } from '@/services/agents'
import { useUIStore } from '@/store/ui-store'
import { useAgentsEnabled } from './agents-feature'

/** Colors offered for new agents (`jean` is reserved for the boss). */
export const AGENT_COLOR_CHOICES = [
  'blue',
  'green',
  'pink',
  'purple',
  'orange',
  'yellow',
] as const

/** Agent by ID, or the first agent (Jean) when the ID is unknown. */
export function findAgent(
  agents: AgentSummary[] | undefined,
  id: string | null | undefined
): AgentSummary | undefined {
  return agents?.find(agent => agent.id === id) ?? agents?.[0]
}

/** The agent selected in the Agents sidebar (from the backend list). */
export function useSelectedAgent(): {
  agent: AgentSummary | undefined
  agents: AgentSummary[] | undefined
  isLoading: boolean
  error: unknown
} {
  const enabled = useAgentsEnabled()
  const { data: agents, isLoading, error } = useAgentsList(enabled)
  const selectedAgentId = useUIStore(state => state.selectedAgentId)
  return {
    agent: findAgent(agents, selectedAgentId),
    agents,
    isLoading,
    error,
  }
}

/** Short status text for an agent row and header. */
export function agentStatusLabel(agent: AgentSummary): string {
  if (agent.status === 'paused') return 'Paused'
  if (agent.pendingApprovals > 0)
    return `Needs approval (${agent.pendingApprovals})`
  if (agent.status === 'working') return 'Working'
  if (agent.status === 'waiting') return 'Waiting for you'
  if (agent.budgetReached) return 'Hourly limit reached'
  if (agent.activeDelegations > 0)
    return `Following ${agent.activeDelegations} session${agent.activeDelegations === 1 ? '' : 's'}`
  return 'Idle'
}

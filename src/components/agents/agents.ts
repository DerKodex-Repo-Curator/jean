import type { ComponentType, SVGProps } from 'react'
import { JeanAgentIcon } from '@/components/icons/JeanAgentIcon'
import { usePreferences } from '@/services/preferences'
import { useUIStore } from '@/store/ui-store'

export interface AgentDefinition {
  id: string
  name: string
  description: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Reserved worktree ID for the agent's sessions (matches Rust). */
  worktreeId: string
}

/** All agents shown in the Agents sidebar. Add new agents here. */
export const AGENTS: AgentDefinition[] = [
  {
    id: 'jean',
    name: 'Jean',
    description: 'The boss. Coordinates all your projects.',
    Icon: JeanAgentIcon,
    // Matches Rust `JEAN_AGENT_WORKTREE_ID`
    worktreeId: '__jean_agent__',
  },
]

/** Agent by ID, or the first agent when the ID is unknown. */
export function findAgent(id: string | null | undefined): AgentDefinition {
  return AGENTS.find(agent => agent.id === id) ?? (AGENTS[0] as AgentDefinition)
}

/** Agents feature is on (Experimental setting, off by default). */
export function useAgentsEnabled(): boolean {
  const { data: preferences } = usePreferences()
  return preferences?.agents_enabled ?? false
}

/** Agents page is open: section selected and feature enabled. */
export function useShowAgents(): boolean {
  const agentsSelected = useUIStore(state => state.railSection === 'agents')
  return useAgentsEnabled() && agentsSelected
}

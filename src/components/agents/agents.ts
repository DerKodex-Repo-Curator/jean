import type { ComponentType, SVGProps } from 'react'
import { JeanAgentIcon } from '@/components/icons/JeanAgentIcon'

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

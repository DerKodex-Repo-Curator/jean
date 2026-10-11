import { useCallback, useState } from 'react'
import { Plus, X } from '@/components/icons/reicon'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { SidebarTabRail } from '@/components/projects/SidebarTabRail'
import { AgentIcon } from '@/components/icons/JeanAgentIcon'
import type { AgentSummary } from '@/services/agents'
import { agentStatusLabel, useSelectedAgent } from './agents'
import { NewAgentDialog } from './NewAgentDialog'

/** Small dot that shows an agent needs attention or is working. */
export function AgentStatusDot({ agent }: { agent: AgentSummary }) {
  const needsYou =
    agent.pendingApprovals > 0 ||
    agent.unreadNotifications > 0 ||
    agent.status === 'waiting'
  if (agent.status === 'paused') {
    return (
      <span className="size-2 shrink-0 rounded-full bg-muted-foreground/50" />
    )
  }
  if (needsYou) {
    return <span className="size-2 shrink-0 rounded-full bg-amber-500" />
  }
  if (agent.status === 'working') {
    return (
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
    )
  }
  return null
}

/** Agents sidebar panel: lists all agents like the projects list. */
export function AgentsSidebar() {
  const isMobile = useIsMobile()
  const { agent: selected, agents, error } = useSelectedAgent()
  const [newAgentOpen, setNewAgentOpen] = useState(false)

  const handleSelect = useCallback(
    (agentId: string) => {
      const ui = useUIStore.getState()
      ui.setSelectedAgentId(agentId)
      if (isMobile) ui.setLeftSidebarVisible(false)
    },
    [isMobile]
  )

  return (
    <div className="flex h-full">
      {isMobile && (
        <SidebarTabRail className="border-r border-border/40">
          <button
            type="button"
            className="flex size-12 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => useUIStore.getState().setLeftSidebarVisible(false)}
            aria-label="Close sidebar"
          >
            <X className="size-6" />
          </button>
        </SidebarTabRail>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Same 8px offset and 48px height as the rail buttons, so they line up */}
        <div className="mt-2 flex h-12 shrink-0 items-center justify-between px-3">
          <h2 className="text-sm font-medium text-foreground">Agents</h2>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setNewAgentOpen(true)}
            aria-label="New agent"
          >
            <Plus className="size-4" />
          </button>
        </div>
        {error ? (
          <p className="px-3 text-xs text-destructive">
            Agents are unavailable: {String(error)}
          </p>
        ) : null}
        <ul
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          aria-label="Agents"
        >
          {agents?.map(agent => {
            const isSelected = agent.id === selected?.id
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  aria-current={isSelected ? 'page' : undefined}
                  title={agentStatusLabel(agent)}
                  className={cn(
                    'relative flex w-full items-center gap-1.5 overflow-hidden px-2 py-1.5 text-left transition-colors duration-150',
                    isSelected
                      ? 'bg-primary/10 text-foreground before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] before:bg-primary'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                  onClick={() => handleSelect(agent.id)}
                  data-testid={`agent-row-${agent.id}`}
                >
                  <AgentIcon icon={agent.icon} className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {agent.name}
                  </span>
                  <AgentStatusDot agent={agent} />
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      <NewAgentDialog
        open={newAgentOpen}
        onOpenChange={setNewAgentOpen}
        onCreated={handleSelect}
      />
    </div>
  )
}

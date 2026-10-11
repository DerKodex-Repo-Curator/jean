import { Suspense, lazy } from 'react'
import { useQuery } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { useUIStore } from '@/store/ui-store'
import { findAgent } from './agents'

const ChatWindow = lazy(() =>
  import('@/components/chat/ChatWindow').then(mod => ({
    default: mod.ChatWindow,
  }))
)

const LOADING = (
  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
    Loading agent…
  </div>
)

/** Agents page: header and chat of the agent selected in the Agents sidebar. */
export function AgentPage() {
  const agent = useUIStore(state => findAgent(state.selectedAgentId))
  const { data: workdir, error } = useQuery({
    queryKey: ['jean-agent', 'workdir'],
    queryFn: () => invoke<string>('get_jean_agent_workdir'),
    staleTime: Infinity,
  })

  return (
    <div className="flex h-full min-h-0 w-full flex-col font-sans">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <agent.Icon className="size-9 shrink-0" />
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-tight text-foreground">
            {agent.name}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {agent.description}
          </p>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {error ? (
          <div
            className="flex flex-1 items-center justify-center px-6 text-center text-sm text-destructive"
            role="alert"
          >
            {String(error).includes('Unknown command')
              ? 'Jean needs a newer Jean server. Update the server and reload.'
              : `Jean is unavailable: ${String(error)}`}
          </div>
        ) : workdir ? (
          <Suspense fallback={LOADING}>
            <ChatWindow
              key={agent.id}
              isModal
              worktreeId={agent.worktreeId}
              worktreePath={workdir}
            />
          </Suspense>
        ) : (
          LOADING
        )}
      </div>
    </div>
  )
}

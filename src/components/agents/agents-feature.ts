import { usePreferences } from '@/services/preferences'
import { useUIStore } from '@/store/ui-store'

// Kept apart from agents.ts so layout code (tab rail, sidebar) does not load
// the agents service and transport.

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

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiAuthed } from '../../lib/apiClient'
import type {
  AccountProposal,
  AccountProposeRequest,
  ActivityEvent,
  Dashboard,
  SituationInterpretation,
  DocumentWriteResult,
  PlanChange,
  ProcessState,
  SavedPlan,
  SavedPlanInput,
  SavedPlanSummary,
  VaultDocument,
  VaultDocumentInput,
} from '../../types/api'
import { useAuth } from '../auth/useAuth'

/** All account queries live under ['account', userId, ...] (removed on sign-out). */
function useAccountKey() {
  const { status, session } = useAuth()
  const userId = session?.user.id ?? null
  return { enabled: status === 'signedIn' && userId !== null, key: ['account', userId] as const }
}

const json = (body: unknown) => ({ body: JSON.stringify(body) })

export function useVault() {
  const { enabled, key } = useAccountKey()
  return useQuery({
    queryKey: [...key, 'documents'],
    queryFn: async () => (await apiAuthed<{ documents: VaultDocument[] }>('/api/me/documents')).documents,
    enabled,
    retry: false,
  })
}

export function useAccountProgress() {
  const { enabled, key } = useAccountKey()
  return useQuery({
    queryKey: [...key, 'progress'],
    queryFn: async () => (await apiAuthed<{ progress: Record<string, Exclude<ProcessState, 'not_started'>> }>('/api/me/progress')).progress,
    enabled,
    retry: false,
  })
}

export function useSavedPlans(status: 'active' | 'archived' | 'all' = 'active') {
  const { enabled, key } = useAccountKey()
  return useQuery({
    queryKey: [...key, 'plans', status],
    queryFn: async () => (await apiAuthed<{ plans: SavedPlanSummary[] }>(`/api/me/plans?status=${status}`)).plans,
    enabled,
    retry: false,
  })
}

export function useSavedPlan(id: string | null) {
  const { enabled, key } = useAccountKey()
  return useQuery({
    queryKey: [...key, 'plan', id],
    queryFn: () => apiAuthed<SavedPlan>(`/api/me/plans/${id}`),
    enabled: enabled && id !== null,
    placeholderData: keepPreviousData,
    retry: false,
  })
}

export function useActivity() {
  const { enabled, key } = useAccountKey()
  return useInfiniteQuery({
    queryKey: [...key, 'activity'],
    queryFn: ({ pageParam }) =>
      apiAuthed<{ events: ActivityEvent[]; next_before_id: number | null }>(
        `/api/me/activity?limit=30${pageParam ? `&before_id=${pageParam}` : ''}`,
      ),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next_before_id,
    enabled,
    retry: false,
  })
}

/** Every account write can change plans (deterministic re-evaluation) and history. */
function useAccountMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient()
  const { key } = useAccountKey()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: key }) })
}

export function useAddDocument() {
  return useAccountMutation((body: VaultDocumentInput) => apiAuthed<DocumentWriteResult>('/api/me/documents', { method: 'POST', ...json(body) }))
}

export function useUpdateDocument() {
  return useAccountMutation(({ id, ...body }: VaultDocumentInput & { id: string }) =>
    apiAuthed<DocumentWriteResult>(`/api/me/documents/${id}`, { method: 'PATCH', ...json(body) }),
  )
}

export function useDeleteDocument() {
  return useAccountMutation((id: string) => apiAuthed<DocumentWriteResult>(`/api/me/documents/${id}`, { method: 'DELETE' }))
}

export function useSetProgress() {
  return useAccountMutation(({ serviceId, state }: { serviceId: string; state: ProcessState }) =>
    apiAuthed<{ progress: Record<string, string>; plan_changes: PlanChange[] }>(`/api/me/progress/${encodeURIComponent(serviceId)}`, {
      method: 'PUT',
      ...json({ state }),
    }),
  )
}

export function useCreatePlan() {
  return useAccountMutation((body: SavedPlanInput) => apiAuthed<SavedPlan>('/api/me/plans', { method: 'POST', ...json(body) }))
}

export function useUpdatePlan() {
  return useAccountMutation(({ id, ...body }: SavedPlanInput & { id: string }) =>
    apiAuthed<SavedPlan>(`/api/me/plans/${id}`, { method: 'PATCH', ...json(body) }),
  )
}

export function usePlanAction() {
  const qc = useQueryClient()
  const { key } = useAccountKey()
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'archive' | 'restore' | 'recalculate' | 'delete' }) =>
      action === 'delete'
        ? apiAuthed<null>(`/api/me/plans/${id}`, { method: 'DELETE' })
        : apiAuthed<SavedPlan>(`/api/me/plans/${id}/${action}`, { method: 'POST' }),
    onSuccess: (_r, { id, action }) => {
      if (action === 'delete') qc.removeQueries({ queryKey: [...key, 'plan', id] }) // gone: do not refetch it
      return qc.invalidateQueries({ queryKey: key })
    },
  })
}

export function useDashboard() {
  const { enabled, key } = useAccountKey()
  return useQuery({ queryKey: [...key, 'dashboard'], queryFn: () => apiAuthed<Dashboard>('/api/me/dashboard'), enabled, retry: false })
}

/** AI reading of the situation WITH the account's known facts (explicit user action only). */
export function useAccountInterpret() {
  return useMutation({
    mutationFn: (body: { text: string; language: 'en' | 'hi'; previous?: string }) =>
      apiAuthed<SituationInterpretation>('/api/me/situation/interpret', { method: 'POST', ...json(body) }),
  })
}

/** Reviewed situation + vault + progress + profile -> proposal. Never saved by itself. */
export function useAccountProposal(request: AccountProposeRequest | null) {
  const { enabled, key } = useAccountKey()
  return useQuery({
    queryKey: [...key, 'proposal', request],
    queryFn: () => apiAuthed<AccountProposal>('/api/me/proposal', { method: 'POST', ...json(request) }),
    enabled: enabled && request !== null,
    placeholderData: keepPreviousData,
    retry: false,
  })
}

/** The deterministic-planner request for a saved plan (vault + account progress + plan state),
 * e.g. so the assistant explains the citizen's own plan. Null until everything has loaded. */
export function useSavedPlanRequest(plan: SavedPlanSummary | null) {
  const vault = useVault()
  const progress = useAccountProgress()
  if (!plan || !vault.data || !progress.data) return null
  const owned = [...new Set(vault.data.map((d) => d.document_type))].sort()
  const states: Record<string, 'expired' | 'invalid' | 'unsure'> = {}
  for (const type of owned) {
    const statuses = vault.data.filter((d) => d.document_type === type).map((d) => d.effective_status)
    if (statuses.includes('valid')) continue
    states[type] = statuses.includes('unsure') ? 'unsure' : statuses.includes('expired') ? 'expired' : 'invalid'
  }
  const entries = Object.entries(progress.data)
  return {
    target_service_ids: [...plan.target_service_ids].sort(),
    owned_document_ids: owned,
    completed_service_ids: entries.filter(([, p]) => p === 'completed').map(([s]) => s).sort(),
    progress: Object.fromEntries(entries.filter(([, p]) => p !== 'completed')),
    document_states: states,
    state: plan.citizen_state,
  }
}

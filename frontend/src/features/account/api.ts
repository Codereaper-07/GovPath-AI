import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiAuthed } from '../../lib/apiClient'
import type {
  ActivityEvent,
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
  return useAccountMutation(({ id, action }: { id: string; action: 'archive' | 'restore' | 'recalculate' | 'delete' }) =>
    action === 'delete'
      ? apiAuthed<null>(`/api/me/plans/${id}`, { method: 'DELETE' })
      : apiAuthed<SavedPlan>(`/api/me/plans/${id}/${action}`, { method: 'POST' }),
  )
}

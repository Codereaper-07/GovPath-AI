import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { apiGet, apiPost } from '../../lib/apiClient'
import type {
  CitizenContext,
  DiscoverResponse,
  PlanRequest,
  PlanResponse,
  ProposalResponse,
  ProposeRequest,
  SituationInterpretation,
  Vocabulary,
} from '../../types/api'

/** Calls the backend planner (the single source of truth for ordering and readiness). */
export function usePlan(request: PlanRequest | null) {
  return useQuery({
    queryKey: ['plan', request],
    queryFn: () => apiPost<PlanResponse>('/api/workflows/plan', request),
    enabled: request !== null && request.target_service_ids.length > 0,
    placeholderData: keepPreviousData, // keep showing the last plan while recalculating
    retry: false,
  })
}

/** Deterministic service discovery from the structured situation. */
export function useDiscovery(context: CitizenContext | null) {
  return useQuery({
    queryKey: ['discover', context],
    queryFn: () => apiPost<DiscoverResponse>('/api/workflows/discover', context),
    enabled: context !== null && (context.goals.length > 0 || context.life_events.length > 0),
    placeholderData: keepPreviousData,
    retry: false,
  })
}

export function useVocabulary() {
  return useQuery({
    queryKey: ['vocabulary'],
    queryFn: () => apiGet<Vocabulary>('/api/workflows/vocabulary'),
    staleTime: Infinity,
  })
}

/** AI extraction of facts from free text (explicit user action only; result is reviewed). */
export function useInterpretSituation() {
  return useMutation({
    mutationFn: (body: { text: string; language: 'en' | 'hi'; previous?: string }) =>
      apiPost<SituationInterpretation>('/api/situation/interpret', body),
  })
}

/** Reviewed situation -> discovered services -> deterministic plan. Never saved by itself. */
export function useProposal(request: ProposeRequest | null) {
  return useQuery({
    queryKey: ['propose', request],
    queryFn: () => apiPost<ProposalResponse>('/api/workflows/propose', request),
    enabled: request !== null,
    placeholderData: keepPreviousData,
    retry: false,
  })
}

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiPost } from '../../lib/apiClient'
import type { PlanRequest, PlanResponse } from '../../types/api'

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

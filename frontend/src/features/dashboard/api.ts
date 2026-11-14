import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../lib/apiClient'
import type { DbHealthResponse, HealthResponse } from '../../types/api'

export function useApiHealth() {
  return useQuery({ queryKey: ['health'], queryFn: () => apiGet<HealthResponse>('/api/health') })
}

export function useDbHealth() {
  return useQuery({ queryKey: ['health', 'db'], queryFn: () => apiGet<DbHealthResponse>('/api/health/db') })
}

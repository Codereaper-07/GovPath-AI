import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../lib/apiClient'
import type { DocumentType, ServiceDetail, ServiceSummary } from '../../types/api'

export function useServices() {
  return useQuery({
    queryKey: ['services'],
    queryFn: () => apiGet<ServiceSummary[]>('/api/services'),
    staleTime: 5 * 60_000,
  })
}

export function useService(id: string) {
  return useQuery({
    queryKey: ['services', id],
    queryFn: () => apiGet<ServiceDetail>(`/api/services/${encodeURIComponent(id)}`),
    staleTime: 5 * 60_000,
  })
}

export function useDocuments() {
  return useQuery({
    queryKey: ['documents'],
    queryFn: () => apiGet<DocumentType[]>('/api/documents'),
    staleTime: 5 * 60_000,
  })
}

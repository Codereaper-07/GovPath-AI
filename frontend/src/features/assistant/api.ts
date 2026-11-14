import { useMutation } from '@tanstack/react-query'
import { apiPost } from '../../lib/apiClient'
import type { AssistantAnswer, AssistantQuery } from '../../types/api'

export function useAskAssistant() {
  return useMutation({
    mutationFn: (q: AssistantQuery) => apiPost<AssistantAnswer>('/api/assistant/query', q),
  })
}

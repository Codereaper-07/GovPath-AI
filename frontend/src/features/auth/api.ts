import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiAuthed } from '../../lib/apiClient'
import type { Profile, ProfileUpdate } from '../../types/api'
import { useAuth } from './useAuth'

/** The signed-in user's profile (created by the backend on first access). */
export function useProfile() {
  const { status, session } = useAuth()
  const userId = session?.user.id ?? null
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: () => apiAuthed<Profile>('/api/me/profile'),
    enabled: status === 'signedIn' && userId !== null,
    retry: false,
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  const { session } = useAuth()
  return useMutation({
    mutationFn: (body: ProfileUpdate) => apiAuthed<Profile>('/api/me/profile', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (profile) => queryClient.setQueryData(['profile', session?.user.id ?? null], profile),
  })
}

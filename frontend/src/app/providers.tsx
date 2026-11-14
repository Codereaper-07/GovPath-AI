import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from '../features/auth/AuthProvider'
import { supabaseAuth } from '../lib/supabase'
import { router } from './router'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

export function Providers() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={supabaseAuth}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  )
}

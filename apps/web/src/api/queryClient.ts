import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './client'

// A 4xx won't change on retry, so it fails at once; network and server errors retry twice.
// Data refetches when the window regains focus, which shows other users' changes without polling.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
})

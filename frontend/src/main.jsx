import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.jsx'
import { SessionProvider } from './context/SessionContext.jsx'
import { UIProvider } from './context/UIContext.jsx'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => (error?.status >= 400 && error?.status < 500 ? false : count < 2),
    },
    mutations: { retry: false },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <UIProvider>
          <App />
        </UIProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
)

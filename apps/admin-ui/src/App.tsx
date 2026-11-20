import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';

const FoundationStatusView = lazy(() => import('@/views/FoundationStatusView'));
const DesignSystemLabView = import.meta.env.DEV
  ? lazy(() => import('@/views/_lab/DesignSystemLabView'))
  : null;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function ViewLoadingFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg-app font-mono text-xs text-fg-muted">
      Loading console view…
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RouteErrorBoundary>
          <Suspense fallback={<ViewLoadingFallback />}>
            <Routes>
              <Route path="/" element={<FoundationStatusView />} />
              {import.meta.env.DEV && DesignSystemLabView && (
                <Route path="/_lab" element={<DesignSystemLabView />} />
              )}
              <Route path="*" element={<FoundationStatusView unavailableRoute />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

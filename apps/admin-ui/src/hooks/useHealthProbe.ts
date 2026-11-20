import { useQuery } from '@tanstack/react-query';
import { fetchAdminApiHealth } from '@/api/health';

export const HEALTH_QUERY_KEY = ['admin-api', 'health'] as const;

export function useHealthProbe() {
  return useQuery({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: ({ signal }) => fetchAdminApiHealth(signal),
    refetchInterval: 15_000,
    retry: false,
    staleTime: 3_000,
  });
}

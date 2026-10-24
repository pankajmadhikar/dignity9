import { useQuery, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useRealtime } from '@/features/queue/realtime';
import { api } from '@/services/api';

export function useServerQuery<T>(key: QueryKey, path: string, enabled = true) {
  const { subscribe } = useRealtime();
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<T>(path),
    enabled,
  });
  const { refetch } = query;
  useEffect(() => subscribe(() => void refetch()), [subscribe, refetch]);
  return query;
}

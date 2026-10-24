import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';

type RealtimeValue = {
  connected: boolean;
  online: boolean;
  subscribe: (listener: () => void) => () => void;
};

const RealtimeContext = createContext<RealtimeValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const listeners = useRef(new Set<() => void>());

  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  useEffect(() => {
    const socket: Socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
    const notify = () => listeners.current.forEach((listener) => listener());
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('queue:updated', notify);
    const poll = window.setInterval(notify, 15000);
    const goOnline = () => setOnline(true);
    const goOffline = () => {
      setOnline(false);
      setConnected(false);
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      socket.close();
      window.clearInterval(poll);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const value = useMemo(() => ({ connected, online, subscribe }), [connected, online, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error('RealtimeProvider is missing');
  return value;
}

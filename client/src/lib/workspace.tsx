import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buildModel, type Model } from '../../../shared/engine';
import type { User, WorkspaceData } from '../../../shared/types';
import { api, ApiError } from './api';
import { useToast } from '../components/ui';

interface WorkspaceCtx {
  user: User;
  canEdit: boolean;
  isAdmin: boolean;
  model: Model;
  data: WorkspaceData;
  live: boolean;
  /** Run an API mutation: toast the result, refresh data, and return whether it succeeded. */
  act: (fn: () => Promise<unknown>, success?: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  setUser: (u: User | null) => void;
}

const Ctx = createContext<WorkspaceCtx | null>(null);

export function useWorkspace(): WorkspaceCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace outside provider');
  return v;
}
export const useModel = () => useWorkspace().model;

export function WorkspaceProvider({ user, setUser, children }: { user: User; setUser: (u: User | null) => void; children: ReactNode }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [live, setLive] = useState(false);
  const [tick, setTick] = useState(0);
  const query = useQuery({ queryKey: ['workspace'], queryFn: () => api.get<WorkspaceData>('/workspace'), staleTime: 60_000 });

  // Live updates: the server pushes a message after every change; refetch when it arrives.
  useEffect(() => {
    let es: EventSource | null = new EventSource('/api/events');
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = () => qc.invalidateQueries({ queryKey: ['workspace'] });
    return () => { es?.close(); es = null; };
  }, [qc]);

  // "Now" moves on: recompute time-based health every minute.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const model = useMemo(() => (query.data ? buildModel(query.data, new Date()) : null), [query.data, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => { await qc.invalidateQueries({ queryKey: ['workspace'] }); }, [qc]);

  const act = useCallback(async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) toast(success);
      await refresh();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
      toast('⚠ ' + (e instanceof Error ? e.message : 'Something went wrong'), 'error');
      return false;
    }
  }, [refresh, toast, setUser]);

  if (query.error) return <div className="empty-state">Couldn't load the workspace: {(query.error as Error).message}</div>;
  if (!model || !query.data) return <div className="empty-state">Loading EEOS…</div>;

  return (
    <Ctx.Provider value={{ user, canEdit: user.role !== 'viewer', isAdmin: user.role === 'admin', model, data: query.data, live, act, refresh, setUser }}>
      {children}
    </Ctx.Provider>
  );
}

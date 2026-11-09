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
  const [live, setLive] = useState(true);
  const [tick, setTick] = useState(0);
  const query = useQuery({ queryKey: ['workspace'], queryFn: () => api.get<WorkspaceData>('/workspace'), staleTime: 60_000 });

  // Teammates' changes: check the workspace version every few seconds (while the tab is visible)
  // and refetch only when it moved. Works on serverless hosts, which can't hold a push connection open.
  const version = query.data?.version;
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (document.hidden) return;
      try {
        const v = await api.get<{ version: number }>('/version');
        if (stopped) return;
        setLive(true);
        if (version !== undefined && v.version !== version) qc.invalidateQueries({ queryKey: ['workspace'] });
      } catch {
        if (!stopped) setLive(false);
      }
    };
    const id = setInterval(check, 5000);
    document.addEventListener('visibilitychange', check);
    return () => { stopped = true; clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, [qc, version]);

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

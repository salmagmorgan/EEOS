import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { User } from '../../shared/types';
import { Layout } from './components/Layout';
import { ModalProvider, ToastProvider } from './components/ui';
import { api } from './lib/api';
import { WorkspaceProvider } from './lib/workspace';
import { Login } from './views/Login';
import './styles.css';

const Dashboard = lazy(() => import('./views/Dashboard'));
const Copilot = lazy(() => import('./views/Copilot'));
const NewEngagement = lazy(() => import('./views/NewEngagement'));
const Lifecycle = lazy(() => import('./views/Lifecycle'));
const Status = lazy(() => import('./views/Status'));
const Profitability = lazy(() => import('./views/Profitability'));
const EngagementTrajectory = lazy(() => import('./views/EngagementTrajectory'));
const Suggestions = lazy(() => import('./views/Suggestions'));
const TalentDirectory = lazy(() => import('./views/TalentDirectory'));
const TalentTrajectory = lazy(() => import('./views/TalentTrajectory'));
const Capacity = lazy(() => import('./views/Capacity'));
const Planner = lazy(() => import('./views/Planner'));
const Monitor = lazy(() => import('./views/Monitor'));
const Allocation = lazy(() => import('./views/Allocation'));
const HiringForecast = lazy(() => import('./views/Hiring').then((m) => ({ default: m.HiringForecast })));
const RolePlanning = lazy(() => import('./views/Hiring').then((m) => ({ default: m.RolePlanning })));
const Clients = lazy(() => import('./views/Clients'));
const Reports = lazy(() => import('./views/Reports'));
const ExportCenter = lazy(() => import('./views/ExportCenter'));
const Settings = lazy(() => import('./views/Settings'));
const DataManagement = lazy(() => import('./views/DataManagement'));
const Audit = lazy(() => import('./views/Audit'));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    api.get<{ user: User | null }>('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);
  if (user === undefined) return <div className="empty-state">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;
  return (
    <WorkspaceProvider user={user} setUser={(u) => { setUser(u); if (!u) queryClient.clear(); }}>
      <ModalProvider>
        <Suspense fallback={<div className="empty-state">Loading…</div>}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="copilot" element={<Copilot />} />
              <Route path="engagements/new" element={<NewEngagement />} />
              <Route path="engagements/lifecycle" element={<Lifecycle />} />
              <Route path="engagements/status" element={<Status />} />
              <Route path="engagements/profitability" element={<Profitability />} />
              <Route path="engagements/trajectory" element={<EngagementTrajectory />} />
              <Route path="engagements/suggestions" element={<Suggestions />} />
              <Route path="talents" element={<TalentDirectory />} />
              <Route path="talents/trajectory" element={<TalentTrajectory />} />
              <Route path="traffic/capacity" element={<Capacity />} />
              <Route path="traffic/planner" element={<Planner />} />
              <Route path="traffic/monitor" element={<Monitor />} />
              <Route path="traffic/allocation" element={<Allocation />} />
              <Route path="hiring/forecast" element={<HiringForecast />} />
              <Route path="hiring/roles" element={<RolePlanning />} />
              <Route path="clients" element={<Clients />} />
              <Route path="reports" element={<Reports />} />
              <Route path="reports/export" element={<ExportCenter />} />
              <Route path="admin/settings" element={<Settings />} />
              <Route path="admin/data" element={<DataManagement />} />
              <Route path="admin/audit" element={<Audit />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </ModalProvider>
    </WorkspaceProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

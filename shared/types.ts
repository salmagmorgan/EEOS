import type { StageId, WorkloadTier } from './constants';

export type Role = 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

export type TalentStatus = 'active' | 'removed' | 'alumni';

export interface UtilOverride {
  value: number;
  reason: string;
  by: string;
  at: string;
}

export interface Flag {
  by: string;
  at: string;
}

export interface Talent {
  id: string;
  name: string;
  initials: string;
  title: string;
  department: string;
  /** active = on the roster; removed = hidden but restorable; alumni = left the firm / history only */
  status: TalentStatus;
  utilOverride: UtilOverride | null;
  flag: Flag | null;
  createdAt: string;
  updatedAt: string;
}

export interface CpsStage {
  id: StageId;
  label: string;
  start: string; // YYYY-MM-DD
  end: string;
  startWeek?: number;
  endWeek?: number;
  owner?: string | null;
}

export type EngagementStatus = 'active' | 'paused' | 'closed' | 'deleted';

export interface Engagement {
  id: string;
  name: string;
  client: string;
  country: string;
  sector: string;
  scope: string;
  subScope: string | null;
  stage: StageId;
  leadId: string;
  teamIds: string[];
  supervisorId: string | null;
  start: string; // YYYY-MM-DD
  end: string;
  notes: string;
  workloadTier: WorkloadTier;
  customCps: CpsStage[] | null;
  price: number | null;
  cost: number | null;
  status: EngagementStatus;
  /** Imported from the historical trajectory log — read-only. */
  historical: boolean;
  /** talentId -> allocation % overriding the workload-tier default */
  allocationOverrides: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  name: string;
  industry: string;
  country: string;
  owner: string;
}

export interface CapacityRule {
  title: string;
  department: string;
  project: number;
  leadership: number;
  /** True when the number is an estimate pending confirmation. */
  placeholder: boolean;
}

export interface TrajectoryRow {
  id: number;
  year: number;
  month: string;
  engagement: string;
  sector: string;
  scope: string;
  status: 'Open' | 'Closed';
  talent: string;
  talentId: string | null;
  title: string;
  role: 'Leader' | 'Engagement Member';
  client: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  userId: string | null;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string;
  details: string;
  undoable: boolean;
  undoneAt: string | null;
  undoneBy: string | null;
}

/** Everything the web app needs to render, in one payload. */
export interface WorkspaceData {
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  talents: Talent[];
  engagements: Engagement[];
  clients: Client[];
  capacityRules: CapacityRule[];
  trajectory: TrajectoryRow[];
}

/** Portable seed format used by `npm run seed` and the artifact importer. */
export interface SeedFile {
  generatedAt: string;
  description: string;
  talents: Talent[];
  engagements: Engagement[];
  clients: Client[];
  capacityRules: CapacityRule[];
  trajectory: Omit<TrajectoryRow, 'id'>[];
  audit?: { at: string; userName: string; action: string; entityName: string; details: string }[];
}

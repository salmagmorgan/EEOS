/* Reference data and business rules for EEOS.
   Everything here is policy that TBC owns — change it here and both the API and the
   web app pick it up. Data that changes day to day (capacity numbers, people,
   engagements) lives in the database instead. */

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export type MonthAbbr = (typeof MONTHS)[number];

export const SECTORS = [
  'Real Estate', 'FMCGs', 'Education', 'Governmental', 'NGO', 'Fashion', 'Retail', 'Internal Strategy',
  'Sports', 'Fragrances', 'Banking', 'Financials', 'Entertainment', 'Telecom',
];

export const SUB_SCOPES_STRATEGY = [
  'Growth Strategy', 'Commercial Strategy', 'Business Turnaround', 'Due Diligence', 'Project Strategy',
  'Corporate Strategy', 'Sales Strategy', 'Launch Plan / Go-to-Market',
];

export const TITLES = [
  'Business Consulting Director', 'Associate Director', 'Consulting Manager', 'Senior Consultant', 'Consultant',
  'Senior Business Analyst', 'Business Analyst', 'Project Manager', 'Field Executive', 'Reporting Analyst',
  'Principal', 'Venture Partner', 'People and Culture Associate Manager',
];

export const DEPARTMENTS = ['Consulting', 'Pulse', 'Operations'];

/** Default capacity (max concurrent engagements) when a title × department pair has no rule. */
export const FALLBACK_CAPACITY = { project: 4, leadership: 1 };

export type StageId =
  | 'kickoff' | 'situational' | 'fieldwork' | 'analysis' | 'reportdev'
  | 'stratbuilding' | 'stratformulation' | 'stratdeliverable' | 'deployment' | 'execution';

export interface StageDef {
  id: StageId;
  label: string;
  icon: string;
  tone: 'accent' | 'danger';
  details: string;
  /** Typical % of a full-cycle engagement this stage consumes (all ten sum to 100). */
  weight: number;
}

export const LIFECYCLE: StageDef[] = [
  { id: 'kickoff', label: 'Project kickoff', icon: '🔗', tone: 'accent', weight: 4, details: 'Internal and External Meetings' },
  { id: 'situational', label: 'Situational Analysis', icon: '🔍', tone: 'accent', weight: 12, details: 'Internal Assessment, Global Benchmarking, Competitive Analysis, and Research Material Preparation' },
  { id: 'fieldwork', label: 'On-Ground Fieldwork', icon: '👥', tone: 'accent', weight: 12, details: 'Conducting Units (Qual and Quant)' },
  { id: 'analysis', label: 'Data Downloading and Analysis', icon: '📊', tone: 'accent', weight: 12, details: 'Downloading Sessions, Data Processing, Coding, etc.' },
  { id: 'reportdev', label: 'Report Development', icon: '📋', tone: 'accent', weight: 10, details: 'Charting and Report Formulation' },
  { id: 'stratbuilding', label: 'Strategy Building Blocks', icon: '🧱', tone: 'danger', weight: 10, details: 'Strawman Deck and Initial SKL' },
  { id: 'stratformulation', label: 'Strategy Formulation', icon: '🔀', tone: 'danger', weight: 10, details: 'Brainstorming Sessions and Workshops' },
  { id: 'stratdeliverable', label: 'Strategy Deliverable', icon: '📦', tone: 'danger', weight: 8, details: 'Slides Development' },
  { id: 'deployment', label: 'Deployment', icon: '👤', tone: 'danger', weight: 8, details: 'Gearing Up' },
  { id: 'execution', label: 'Strategy Execution', icon: '⚙️', tone: 'danger', weight: 14, details: 'Full Execution Across Different Fronts' },
];

export const STAGE_IDS = LIFECYCLE.map((s) => s.id);

export const SCOPES = ['Research', 'Research and Strategy', 'Strategy', 'Execution'] as const;
export type Scope = (typeof SCOPES)[number];

/** Each scope runs a slice of the lifecycle and closes at the last stage of its slice. */
export const SCOPE_STAGES: Record<Scope, { ids: StageId[]; icon: string; label: string; typicalDays: number }> = {
  Research: { ids: ['kickoff', 'situational', 'fieldwork', 'analysis', 'reportdev'], icon: '🔬', label: 'Research', typicalDays: 90 },
  'Research and Strategy': {
    ids: ['kickoff', 'situational', 'fieldwork', 'analysis', 'reportdev', 'stratbuilding', 'stratformulation', 'stratdeliverable'],
    icon: '🧭', label: 'Research & Strategy', typicalDays: 120,
  },
  Strategy: {
    ids: ['kickoff', 'situational', 'fieldwork', 'analysis', 'reportdev', 'stratbuilding', 'stratformulation', 'stratdeliverable'],
    icon: '🎯', label: 'Strategy', typicalDays: 75,
  },
  Execution: { ids: ['kickoff', 'deployment', 'execution'], icon: '🚀', label: 'Execution', typicalDays: 120 },
};

export const WORKLOAD_TIERS = {
  'Quick Work': { member: 25, leader: 25, icon: '⚡', tone: 'ok' },
  'Business as Usual': { member: 35, leader: 35, icon: '📋', tone: 'accent' },
  'Heavy & Complex': { member: 50, leader: 65, icon: '🏋️', tone: 'danger' },
} as const;
export type WorkloadTier = keyof typeof WORKLOAD_TIERS;
export const WORKLOAD_TIER_NAMES = Object.keys(WORKLOAD_TIERS) as WorkloadTier[];
export const DEFAULT_WORKLOAD_TIER: WorkloadTier = 'Quick Work';

/** A supervisor is an oversight role, separate from the team, at a flat allocation. */
export const SUPERVISOR_ALLOCATION_PCT = 15;

/** Governance: titles and departments never auto-recommended for staffing. */
export const EXCLUDED_FROM_AUTO_STAFFING_TITLES = ['Business Consulting Director'];
export const EXCLUDED_FROM_AUTO_STAFFING_DEPARTMENTS = ['Operations'];

/** Recommendation weights (must sum to 1). */
export const RECOMMENDATION_WEIGHTS = { capacity: 0.3, rotation: 0.25, scope: 0.25, sector: 0.2 };

/** Utilization status bands. */
export const UTIL_BANDS = { optimal: 75, atCapacity: 91, over: 100 };

/** Leaders on this many concurrent engagements raise a rotation alert. */
export const LEADER_CONCENTRATION_THRESHOLD = 3;

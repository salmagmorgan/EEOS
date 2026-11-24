/* Shared helpers for engagement updates meeting notes. */
import { useMemo } from 'react';
import type { Engagement, MeetingNote, Milestone } from '../../../shared/types';
import { useWorkspace } from './workspace';

export const staffOf = (e: Engagement) => [...new Set([e.leadId, ...(e.supervisorId ? [e.supervisorId] : []), ...e.teamIds])];

/** Notes and milestones per engagement: notes newest first, milestones by date. */
export function useMeetingData() {
  const { data } = useWorkspace();
  return useMemo(() => {
    const notes = new Map<string, MeetingNote[]>();
    for (const n of data.meetingNotes ?? []) (notes.get(n.engagementId) ?? notes.set(n.engagementId, []).get(n.engagementId)!).push(n);
    for (const list of notes.values()) list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const milestones = new Map<string, Milestone[]>();
    for (const m of data.milestones ?? []) (milestones.get(m.engagementId) ?? milestones.set(m.engagementId, []).get(m.engagementId)!).push(m);
    for (const list of milestones.values()) list.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.createdAt.localeCompare(b.createdAt));
    return { notesFor: (id: string) => notes.get(id) ?? [], milestonesFor: (id: string) => milestones.get(id) ?? [] };
  }, [data.meetingNotes, data.milestones]);
}

/** A note's text: the free-text notes, plus any structured answers it was written with. */
export function noteText(n: MeetingNote): { label?: string; text: string }[] {
  const parts: { label?: string; text: string }[] = [];
  if (n.notes) parts.push({ text: n.notes });
  if (n.whereWeAre) parts.push({ label: '📍 Where are we now', text: n.whereWeAre });
  if (n.challenges) parts.push({ label: '⚠️ Challenges', text: n.challenges });
  if (n.nextSteps) parts.push({ label: '➡️ Next steps', text: n.nextSteps });
  return parts;
}

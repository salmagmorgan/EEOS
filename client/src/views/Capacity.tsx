import { TITLES } from '../../../shared/constants';
import { Bars, Heatmap } from '../components/charts';
import { TalentModal } from '../components/modals';
import { Card, PageHead, Stat, useModal } from '../components/ui';
import { useModel } from '../lib/workspace';

export default function Capacity() {
  const m = useModel();
  const modal = useModal();
  const t = m.talents;
  const byTitle = TITLES.map((title) => {
    const g = t.filter((x) => x.title === title);
    return { label: `${title} (${g.length})`, value: g.length ? Math.round(g.reduce((s, x) => s + x.util, 0) / g.length) : 0, n: g.length };
  }).filter((r) => r.n > 0);
  return (
    <>
      <PageHead title="Capacity Intelligence" desc="Firm-wide capacity, utilization and forward availability." />
      <div className="stat-strip">
        <Stat value={t.length} label="Talents" />
        <Stat value={m.firmUtilization + '%'} label="Firm utilization" />
        <Stat value={t.filter((x) => x.utilStatus === 'Overutilized').length} label="Over capacity" color="var(--danger)" />
        <Stat value={t.filter((x) => x.utilStatus === 'Not Allocated').length} label="Not allocated" />
        <Stat value={m.openCapacity().reduce((s, x) => s + x.openSlots, 0)} label="Open project slots" color="var(--ok)" />
      </div>
      <div className="row-2">
        <Card title="Utilization heatmap — this year">
          <div className="small muted" style={{ marginBottom: 8 }}>Past months: from real engagement dates · ● current month: live · dashed: projected from active engagements · “–”: no engagements that month.</div>
          <div className="table-wrap"><Heatmap model={m} talents={t} onPick={(id) => modal.open(<TalentModal id={id} />)} /></div>
        </Card>
        <Card title="Average utilization by title"><Bars labelWidth={190} suffix="%" rows={byTitle} /></Card>
      </div>
    </>
  );
}

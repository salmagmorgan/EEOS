import { TalentHistoryModal } from '../components/modals';
import { Card, Empty, PageHead, useModal } from '../components/ui';
import { useModel } from '../lib/workspace';

export default function TalentTrajectory() {
  const m = useModel();
  const modal = useModal();
  const rows = m.data.talents.filter((t) => t.status !== 'removed').map((t) => {
    const traj = m.data.trajectory.filter((r) => r.talentId === t.id);
    const engs = m.engagements.filter((e) => m.staff(e).includes(t.id));
    return {
      t, engagements: engs.length, led: engs.filter((e) => e.leadId === t.id).length, active: engs.filter((e) => m.bucket(e) === 'active').length,
      clients: [...new Set([...engs.map((e) => e.client), ...traj.map((r) => r.client)])], months: traj.length,
    };
  }).filter((r) => r.engagements > 0 || r.months > 0).sort((a, b) => b.engagements - a.engagements);
  return (
    <>
      <PageHead title="Talent Trajectory" desc="Everyone ranked by engagement involvement across the firm's history (alumni included). Click a row for the month-by-month record." />
      <Card>
        <div className="table-wrap">
          {rows.length ? (
            <table className="data">
              <thead><tr><th>Talent</th><th>Title</th><th>Engagements</th><th>As lead</th><th>Active now</th><th>Clients</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.t.id} onClick={() => modal.open(<TalentHistoryModal id={r.t.id} />)}>
                  <td><b>{r.t.name}</b>{r.t.status === 'alumni' && <span className="small muted"> · alumni</span>}</td><td>{r.t.title}</td>
                  <td>{r.engagements}</td><td>{r.led}</td><td>{r.active}</td>
                  <td className="small">{r.clients.slice(0, 5).join(', ')}{r.clients.length > 5 && ` +${r.clients.length - 5} more`}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>No involvement recorded yet.</Empty>}
        </div>
      </Card>
    </>
  );
}

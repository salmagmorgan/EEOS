import { Card, Empty, PageHead, Tag } from '../components/ui';
import { useModel } from '../lib/workspace';

export function HiringForecast() {
  const m = useModel();
  const needs = m.hiringNeeds();
  return (
    <>
      <PageHead title="Hiring Forecast" desc="Hiring gaps computed live from utilization by title × department." />
      <Card>
        <div className="table-wrap">
          {needs.length ? (
            <table className="data">
              <thead><tr><th>Title</th><th>Department</th><th>Headcount</th><th>Avg utilization</th><th>Urgency</th><th>Estimated gap</th></tr></thead>
              <tbody>{needs.map((h) => (
                <tr key={h.title + h.department} style={{ cursor: 'default' }}>
                  <td><b>{h.title}</b></td><td><Tag className="tag-neutral">{h.department}</Tag></td><td>{h.headcount}</td>
                  <td><b style={{ color: h.avgUtil >= 130 ? 'var(--danger)' : 'var(--warn)' }}>{h.avgUtil}%</b></td>
                  <td><Tag className={h.urgency === 'High' ? 'tag-danger' : h.urgency === 'Medium' ? 'tag-warn' : 'tag-neutral'}>{h.urgency}</Tag></td>
                  <td>~{h.fteGap} FTE</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>No title/department group averages 100% or more — no hiring gaps right now.</Empty>}
        </div>
      </Card>
      <p className="small muted" style={{ marginTop: 12, lineHeight: 1.6 }}>A gap appears when a title × department group averages at least 100% utilization. Urgency: High ≥ 130%, Medium ≥ 105%. The estimated gap is the number of extra people needed to bring the group's engagement load back within its standard project capacity (minimum one).</p>
    </>
  );
}

export function RolePlanning() {
  const m = useModel();
  const rows = m.rolePlanning();
  return (
    <>
      <PageHead title="Role Planning" desc="Headcount and capacity rules by title. Capacity rules are edited under Data Management → Capacity rules." />
      <Card>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Title</th><th>Department</th><th>Headcount</th><th>Avg utilization</th><th>Project capacity</th><th>Leadership capacity</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.title + r.department} style={{ cursor: 'default' }}>
                <td><b>{r.title}</b>{r.placeholder && <span className="small" style={{ color: 'var(--warn)' }} title="Estimate pending confirmation"> (estimate)</span>}</td>
                <td><Tag className="tag-neutral">{r.department}</Tag></td><td>{r.headcount}</td><td>{r.avgUtil}%</td><td>{r.project} engagements</td><td>{r.leadership} engagements</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

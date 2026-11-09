import { useNavigate } from 'react-router-dom';
import { Card, PageHead } from '../components/ui';

const EXPORTS = [
  ['engagements', 'Engagements', 'Every engagement with status, stage, team, dates, health and financials'],
  ['talents', 'Talents', 'The roster with live utilization and status'],
  ['clients', 'Clients', 'Relationships with active and past engagement counts'],
  ['trajectory', 'Staffing history', 'The imported month-by-month trajectory log'],
];

export default function ExportCenter() {
  const nav = useNavigate();
  return (
    <>
      <PageHead title="Export Center" desc="Download live data as CSV (opens in Excel and Google Sheets)." />
      <Card style={{ marginBottom: 16, cursor: 'pointer' }}>
        <div className="row" onClick={() => nav('/reports')} style={{ justifyContent: 'space-between' }}>
          <div><b>🖥️ Looking for a presentation?</b><div className="small muted">The board deck and one-page snapshot live in Reports Center.</div></div>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Reports Center →</span>
        </div>
      </Card>
      <div className="qa-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
        {EXPORTS.map(([kind, label, desc]) => (
          <a key={kind} className="qa-btn" href={`/api/export/${kind}.csv`} download>
            <div className="qic">⬇</div>{label} (.csv)<span className="small muted" style={{ fontWeight: 400, textAlign: 'center' }}>{desc}</span>
          </a>
        ))}
      </div>
    </>
  );
}

import { useNavigate } from 'react-router-dom';
import { NotesReportIcon, RecapModal } from '../components/RecapModal';
import { Card, PageHead, useModal } from '../components/ui';

const EXPORTS = [
  ['engagements', 'Engagements', 'Every engagement with status, stage, team, dates, health and financials'],
  ['talents', 'Talents', 'The roster with live utilization and status'],
  ['clients', 'Clients', 'Relationships with active and past engagement counts'],
  ['trajectory', 'Staffing history', 'The imported month-by-month trajectory log'],
  ['meeting-notes', 'Meeting notes', 'Every Engagement Updates Meeting note, with status and comments'],
];

export default function ExportCenter() {
  const nav = useNavigate();
  const modal = useModal();
  return (
    <>
      <PageHead title="Export Center" desc="Download live data as CSV (opens in Excel and Google Sheets), or the meeting notes as a branded PDF report." />
      <Card style={{ marginBottom: 16, cursor: 'pointer' }}>
        <div className="row" onClick={() => nav('/reports')} style={{ justifyContent: 'space-between' }}>
          <div><b>🖥️ Looking for a presentation?</b><div className="small muted">The board deck and one-page snapshot live in Reports Center.</div></div>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Reports Center →</span>
        </div>
      </Card>
      <div className="export-report" role="button" tabIndex={0} onClick={() => modal.open(<RecapModal />)} onKeyDown={(x) => x.key === 'Enter' && modal.open(<RecapModal />)}>
        <div className="export-report-icon"><NotesReportIcon size={40} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>Meeting notes report (PDF)</b>
          <div className="small muted">Engagement Meeting Updates Recap — a one-page, TBC-branded summary of a session’s notes. Preview it, then export or share.</div>
        </div>
        <span className="export-report-go">Preview &amp; export →</span>
      </div>
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

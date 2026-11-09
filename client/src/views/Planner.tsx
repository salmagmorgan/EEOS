import { LineChart } from '../components/charts';
import { Card, PageHead } from '../components/ui';
import { useModel } from '../lib/workspace';

export default function Planner() {
  const m = useModel();
  const { months, talentCount } = m.capacityProjection(6);
  return (
    <>
      <PageHead title="Capacity Planner" desc="Projected demand from scheduled engagements vs. available capacity, month by month." />
      <Card>
        <LineChart labels={months.map((x) => x.label)} series={[
          { name: 'Projected demand (% of capacity)', color: '#ED2429', data: months.map((x) => x.demandPct) },
          { name: 'Available capacity', color: '#4FC98A', data: months.map(() => 100) },
        ]} />
        <div className="box" style={{ marginTop: 16, fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.7 }}>
          <b style={{ color: 'var(--text)' }}>Method:</b> demand sums each person's real allocation (by workload tier, role and any overrides) on every active engagement whose dates overlap the month, across {talentCount} Consulting and Pulse talents (Operations are excluded).<br />
          <b style={{ color: 'var(--warn)' }}>Assumption:</b> only engagements already scheduled are counted. New business will add demand, so treat a falling line as a floor, not a forecast.
        </div>
      </Card>
    </>
  );
}

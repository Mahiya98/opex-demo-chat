const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const round = (value, digits = 2) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const monthOf = (date) => String(date || '').slice(0, 7);

function sum(rows, field) {
  return rows.reduce((total, row) => total + num(row[field]), 0);
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function buildDashboard(data) {
  const production = data.production || [];
  const fiveS = data['5s_audit'] || [];
  const qcp = data.qcp_audit || [];
  const kaizen = data.kaizen || [];
  const breakdown = data.breakdown || [];

  const planned = sum(production, 'planned_tonnes');
  const actual = sum(production, 'actual_tonnes');
  const reject = sum(production, 'reject_tonnes');
  const pass = qcp.filter((row) => row.status === 'Pass').length;

  const kpis = {
    plan_attainment_pct: planned ? round((actual / planned) * 100) : null,
    actual_tonnes: Math.round(actual),
    planned_tonnes: Math.round(planned),
    reject_pct: actual ? round((reject / actual) * 100) : null,
    five_s_score: fiveS.length ? round(average(fiveS.map((row) => num(row.score_pct)))) : null,
    qcp_pass_rate: qcp.length ? round((pass / qcp.length) * 100) : null,
    qcp_audits: qcp.length,
    kaizen_count: kaizen.length,
    kaizen_savings_usd: Math.round(sum(kaizen, 'savings_usd')),
    downtime_hours: round(sum(breakdown, 'downtime_hours')),
    breakdown_cost_usd: Math.round(sum(breakdown, 'maintenance_cost_usd'))
  };

  const prodByMonth = new Map();
  for (const row of production) {
    const month = monthOf(row.date);
    if (!month) continue;
    const item = prodByMonth.get(month) || { month, planned: 0, actual: 0 };
    item.planned += num(row.planned_tonnes);
    item.actual += num(row.actual_tonnes);
    prodByMonth.set(month, item);
  }
  const productionSeries = [...prodByMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((item) => ({
      month: item.month,
      planned: Math.round(item.planned),
      actual: Math.round(item.actual)
    }));

  const fiveSByMonth = new Map();
  for (const row of fiveS) {
    const month = monthOf(row.date);
    if (!month) continue;
    const item = fiveSByMonth.get(month) || { month, total: 0, count: 0 };
    item.total += num(row.score_pct);
    item.count += 1;
    fiveSByMonth.set(month, item);
  }
  const fiveSSeries = [...fiveSByMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((item) => ({ month: item.month, score_pct: round(item.total / item.count) }));

  const qcpByMonth = new Map();
  for (const row of qcp) {
    const month = monthOf(row.date);
    if (!month) continue;
    const item = qcpByMonth.get(month) || { month, total: 0, pass: 0 };
    item.total += 1;
    if (row.status === 'Pass') item.pass += 1;
    qcpByMonth.set(month, item);
  }
  const qcpSeries = [...qcpByMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((item) => ({
      month: item.month,
      pass_rate_pct: item.total ? round((item.pass / item.total) * 100) : null
    }));

  const downtimeByCategory = new Map();
  for (const row of breakdown) {
    const key = row.category || 'Unknown';
    const item = downtimeByCategory.get(key) || { category: key, hours: 0, events: 0 };
    item.hours += num(row.downtime_hours);
    item.events += 1;
    downtimeByCategory.set(key, item);
  }
  const downtimeSeries = [...downtimeByCategory.values()]
    .map((item) => ({ category: item.category, hours: round(item.hours), events: item.events }))
    .sort((a, b) => b.hours - a.hours);

  return {
    kpis,
    charts: {
      production: productionSeries,
      fiveS: fiveSSeries,
      qcp: qcpSeries,
      downtime: downtimeSeries
    },
    meta: {
      ...(data.meta || {}),
      source: data.source || 'local-demo'
    }
  };
}

module.exports = { buildDashboard, num, round, monthOf };

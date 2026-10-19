const fs = require('fs');
const path = require('path');

const { loadData } = require('./data-source');
const { num, round, monthOf } = require('./metrics');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

let KB = {};
try {
  KB = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'knowledge', 'improvement.json'), 'utf8')
  );
} catch (err) {
  console.error('[tools] knowledge not loaded:', err.message);
}

function dateArg(value) {
  return typeof value === 'string' && ISO_DATE.test(value) ? value : null;
}

function plantArg(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 40) return null;
  return v.toLowerCase();
}

function matchesPlant(row, plant) {
  return !plant || String(row.plant || '').toLowerCase() === plant;
}

function inRange(dateStr, from, to) {
  const d = String(dateStr || '').slice(0, 10);
  return d >= from && d <= to;
}

function groupKey(value, fallback) {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function term(value) {
  return String(value || '')
    .replace(/[(),*"%_\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 60);
}

function limitArg(value, max = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(Math.floor(n), max));
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_kpis',
      description:
        'Overall OPEX KPIs for a period: plan attainment, 5S score, QCP pass rate, Kaizen savings, downtime hours and breakdown cost.',
      parameters: {
        type: 'object',
        properties: {
          plant: { type: ['string', 'null'], description: 'Plant A, Plant B, Plant C, or null for all.' },
          from: { type: 'string', description: 'Start date YYYY-MM-DD.' },
          to: { type: 'string', description: 'End date YYYY-MM-DD.' }
        },
        required: ['from', 'to'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_production_summary',
      description:
        'Production plan vs actual, variance, reject rate and downtime by month, plant or line.',
      parameters: {
        type: 'object',
        properties: {
          plant: { type: ['string', 'null'], description: 'Plant A, Plant B, Plant C, or null for all.' },
          from: { type: 'string', description: 'Start date YYYY-MM-DD.' },
          to: { type: 'string', description: 'End date YYYY-MM-DD.' },
          by: { type: ['string', 'null'], description: 'Group by month, plant or line. Default plant.' }
        },
        required: ['from', 'to'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_plan_variance',
      description:
        'Monthly plan vs actual tonnes, variance percentage and cost variance by plant. For a period comparison across plants, use get_production_summary with by="plant" instead.',
      parameters: {
        type: 'object',
        properties: {
          plant: { type: ['string', 'null'], description: 'Plant A, Plant B, Plant C, or null for all.' },
          from: { type: 'string', description: 'Start date YYYY-MM-DD.' },
          to: { type: 'string', description: 'End date YYYY-MM-DD.' }
        },
        required: ['from', 'to'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_5s_summary',
      description:
        '5S scores by plant, zone or month, including each S dimension (0-5 scale).',
      parameters: {
        type: 'object',
        properties: {
          plant: { type: ['string', 'null'], description: 'Plant A, Plant B, Plant C, or null for all.' },
          from: { type: 'string', description: 'Start date YYYY-MM-DD.' },
          to: { type: 'string', description: 'End date YYYY-MM-DD.' },
          by: { type: ['string', 'null'], description: 'Group by plant, zone or month. Default plant.' }
        },
        required: ['from', 'to'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_qcp_summary',
      description:
        'QCP pass/fail counts and pass rate by section, test, machine, month or plant.',
      parameters: {
        type: 'object',
        properties: {
          plant: { type: ['string', 'null'], description: 'Plant A, Plant B, Plant C, or null for all.' },
          from: { type: 'string', description: 'Start date YYYY-MM-DD.' },
          to: { type: 'string', description: 'End date YYYY-MM-DD.' },
          by: { type: ['string', 'null'], description: 'Group by section, test, machine, month or plant. Default test.' }
        },
        required: ['from', 'to'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_breakdown_summary',
      description:
        'Breakdown events, downtime hours, production loss and maintenance cost by machine, category, cause, month or plant.',
      parameters: {
        type: 'object',
        properties: {
          plant: { type: ['string', 'null'], description: 'Plant A, Plant B, Plant C, or null for all.' },
          from: { type: 'string', description: 'Start date YYYY-MM-DD.' },
          to: { type: 'string', description: 'End date YYYY-MM-DD.' },
          by: { type: ['string', 'null'], description: 'Group by machine, category, cause, month or plant. Default machine.' }
        },
        required: ['from', 'to'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_kaizen_summary',
      description:
        'Kaizen counts, completed count and savings by month, category, status, plant or department.',
      parameters: {
        type: 'object',
        properties: {
          plant: { type: ['string', 'null'], description: 'Plant A, Plant B, Plant C, or null for all.' },
          from: { type: 'string', description: 'Start date YYYY-MM-DD.' },
          to: { type: 'string', description: 'End date YYYY-MM-DD.' },
          by: { type: ['string', 'null'], description: 'Group by month, category, status, plant or department. Default month.' }
        },
        required: ['from', 'to'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_kaizen',
      description:
        'Search Kaizen records by keyword to find similar past improvements.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords, e.g. packing, mill, cleaning.' },
          plant: { type: ['string', 'null'], description: 'Plant A, Plant B, Plant C, or null for all.' }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_advice',
      description:
        'Curated best-practice actions for 5S, QCP, production or downtime. Use after diagnosing.',
      parameters: {
        type: 'object',
        properties: {
          area: { type: 'string', description: 'One of: 5s, qcp, production, downtime.' },
          dimension: { type: ['string', 'null'], description: 'For 5S: sort, order, shine, standardize or sustain.' },
          issue: { type: ['string', 'null'], description: 'For QCP/production/downtime: issue keyword.' }
        },
        required: ['area'],
        additionalProperties: false
      }
    }
  }
];

const NAMES = new Set(TOOLS.map((tool) => tool.function.name));

async function runTool(name, args = {}) {
  if (!NAMES.has(name)) throw new Error('Tool not allowed');

  const data = await loadData();
  const plant = plantArg(args.plant);

  const needRange = !['search_kaizen', 'get_advice'].includes(name);
  const from = dateArg(args.from);
  const to = dateArg(args.to);
  if (needRange && (!from || !to)) {
    throw new Error('from and to are required (YYYY-MM-DD)');
  }

  switch (name) {
    case 'get_kpis': {
      const production = data.production.filter(
        (row) => inRange(row.date, from, to) && matchesPlant(row, plant)
      );
      const fiveS = data['5s_audit'].filter(
        (row) => inRange(row.date, from, to) && matchesPlant(row, plant)
      );
      const qcp = data.qcp_audit.filter(
        (row) => inRange(row.date, from, to) && matchesPlant(row, plant)
      );
      const kaizen = data.kaizen.filter(
        (row) => inRange(row.date, from, to) && matchesPlant(row, plant)
      );
      const breakdown = data.breakdown.filter(
        (row) => inRange(row.date, from, to) && matchesPlant(row, plant)
      );

      const planned = production.reduce((s, r) => s + num(r.planned_tonnes), 0);
      const actual = production.reduce((s, r) => s + num(r.actual_tonnes), 0);
      const reject = production.reduce((s, r) => s + num(r.reject_tonnes), 0);
      const pass = qcp.filter((r) => r.status === 'Pass').length;

      return [
        {
          from,
          to,
          plant: plant || 'all',
          planned_tonnes: Math.round(planned),
          actual_tonnes: Math.round(actual),
          plan_attainment_pct: planned ? round((actual / planned) * 100) : null,
          reject_pct: actual ? round((reject / actual) * 100) : null,
          five_s_score: fiveS.length
            ? round(fiveS.reduce((s, r) => s + num(r.score_pct), 0) / fiveS.length)
            : null,
          qcp_pass_rate: qcp.length ? round((pass / qcp.length) * 100) : null,
          qcp_audits: qcp.length,
          kaizen_count: kaizen.length,
          kaizen_savings_usd: Math.round(
            kaizen.reduce((s, r) => s + num(r.savings_usd), 0)
          ),
          downtime_hours: round(
            breakdown.reduce((s, r) => s + num(r.downtime_hours), 0)
          ),
          breakdown_cost_usd: Math.round(
            breakdown.reduce((s, r) => s + num(r.maintenance_cost_usd), 0)
          )
        }
      ];
    }

    case 'get_production_summary': {
      const by = ['month', 'plant', 'line'].includes(args.by) ? args.by : 'plant';
      const rows = data.production.filter(
        (row) => inRange(row.date, from, to) && matchesPlant(row, plant)
      );
      const groups = new Map();

      for (const row of rows) {
        const key =
          by === 'month'
            ? monthOf(row.date)
            : by === 'line'
              ? `${row.plant} / ${row.line}`
              : row.plant;
        const group = groups.get(key) || {
          group: key,
          planned: 0,
          actual: 0,
          good: 0,
          reject: 0,
          downtime: 0
        };
        group.planned += num(row.planned_tonnes);
        group.actual += num(row.actual_tonnes);
        group.good += num(row.good_tonnes);
        group.reject += num(row.reject_tonnes);
        group.downtime += num(row.downtime_hours);
        groups.set(key, group);
      }

      return [...groups.values()]
        .map((g) => ({
          group: g.group,
          planned_tonnes: Math.round(g.planned),
          actual_tonnes: Math.round(g.actual),
          variance_tonnes: Math.round(g.actual - g.planned),
          variance_pct: g.planned ? round(((g.actual - g.planned) / g.planned) * 100) : null,
          good_tonnes: Math.round(g.good),
          reject_pct: g.actual ? round((g.reject / g.actual) * 100) : null,
          downtime_hours: round(g.downtime)
        }))
        .sort((a, b) =>
          by === 'month'
            ? a.group.localeCompare(b.group)
            : (a.variance_pct ?? 0) - (b.variance_pct ?? 0)
        )
        .slice(0, 60);
    }

    case 'get_plan_variance': {
      const rows = data.plan_variance.filter(
        (row) =>
          matchesPlant(row, plant) &&
          row.month >= from.slice(0, 7) &&
          row.month <= to.slice(0, 7)
      );
      return rows
        .map((row) => ({
          month: row.month,
          plant: row.plant,
          planned_tonnes: num(row.planned_tonnes),
          actual_tonnes: num(row.actual_tonnes),
          variance_tonnes: num(row.variance_tonnes),
          variance_pct: num(row.variance_pct),
          planned_cost_usd: num(row.planned_cost_usd),
          actual_cost_usd: num(row.actual_cost_usd),
          cost_variance_pct: num(row.cost_variance_pct)
        }))
        .sort((a, b) => a.month.localeCompare(b.month) || a.plant.localeCompare(b.plant));
    }

    case 'get_5s_summary': {
      const by = ['plant', 'zone', 'month'].includes(args.by) ? args.by : 'plant';
      const rows = data['5s_audit'].filter(
        (row) => inRange(row.date, from, to) && matchesPlant(row, plant)
      );
      const groups = new Map();

      for (const row of rows) {
        const key =
          by === 'month'
            ? monthOf(row.date)
            : by === 'zone'
              ? `${row.plant} / ${row.zone}`
              : row.plant;
        const group = groups.get(key) || {
          group: key,
          audits: 0,
          sort: 0,
          order: 0,
          shine: 0,
          standardize: 0,
          sustain: 0,
          score: 0
        };
        group.audits += 1;
        group.sort += (num(row.sort_removed) + num(row.sort_redtag)) / 2;
        group.order += (num(row.order_location) + num(row.order_labels)) / 2;
        group.shine += (num(row.shine_clean) + num(row.shine_assigned)) / 2;
        group.standardize += num(row.standardize);
        group.sustain += num(row.sustain);
        group.score += num(row.score_pct);
        groups.set(key, group);
      }

      return [...groups.values()]
        .map((g) => ({
          group: g.group,
          audits: g.audits,
          sort: round(g.sort / g.audits),
          order: round(g.order / g.audits),
          shine: round(g.shine / g.audits),
          standardize: round(g.standardize / g.audits),
          sustain: round(g.sustain / g.audits),
          score_pct: round(g.score / g.audits)
        }))
        .sort((a, b) =>
          by === 'month'
            ? a.group.localeCompare(b.group)
            : (a.score_pct ?? 0) - (b.score_pct ?? 0)
        )
        .slice(0, 60);
    }

    case 'get_qcp_summary': {
      const by = ['section', 'test', 'machine', 'month', 'plant'].includes(args.by)
        ? args.by
        : 'test';
      const rows = data.qcp_audit.filter(
        (row) => inRange(row.date, from, to) && matchesPlant(row, plant)
      );
      const groups = new Map();

      for (const row of rows) {
        const key =
          by === 'month'
            ? monthOf(row.date)
            : by === 'section'
              ? row.section
              : by === 'machine'
                ? `${row.plant} / ${row.machine}`
                : by === 'plant'
                  ? row.plant
                  : row.test_name;
        if (!key) continue;
        const group = groups.get(key) || { group: key, audits: 0, pass: 0, fail: 0 };
        group.audits += 1;
        if (row.status === 'Pass') group.pass += 1;
        else group.fail += 1;
        groups.set(key, group);
      }

      return [...groups.values()]
        .map((g) => ({
          group: g.group,
          audits: g.audits,
          pass: g.pass,
          fail: g.fail,
          pass_rate_pct: round((g.pass / g.audits) * 100),
          fail_rate_pct: round((g.fail / g.audits) * 100)
        }))
        .sort((a, b) =>
          by === 'month'
            ? a.group.localeCompare(b.group)
            : b.fail - a.fail || b.fail_rate_pct - a.fail_rate_pct
        )
        .slice(0, 60);
    }

    case 'get_breakdown_summary': {
      const by = ['machine', 'category', 'cause', 'month', 'plant'].includes(args.by)
        ? args.by
        : 'machine';
      const rows = data.breakdown.filter(
        (row) => inRange(row.date, from, to) && matchesPlant(row, plant)
      );
      const groups = new Map();

      for (const row of rows) {
        const key =
          by === 'month'
            ? monthOf(row.date)
            : by === 'category'
              ? row.category
              : by === 'cause'
                ? row.cause
                : by === 'plant'
                  ? row.plant
                  : `${row.plant} / ${row.machine}`;
        if (!key) continue;
        const group = groups.get(key) || {
          group: key,
          events: 0,
          hours: 0,
          loss: 0,
          cost: 0
        };
        group.events += 1;
        group.hours += num(row.downtime_hours);
        group.loss += num(row.production_loss_tonnes);
        group.cost += num(row.maintenance_cost_usd);
        groups.set(key, group);
      }

      return [...groups.values()]
        .map((g) => ({
          group: g.group,
          events: g.events,
          downtime_hours: round(g.hours),
          production_loss_tonnes: Math.round(g.loss),
          maintenance_cost_usd: Math.round(g.cost)
        }))
        .sort((a, b) =>
          by === 'month'
            ? a.group.localeCompare(b.group)
            : b.downtime_hours - a.downtime_hours
        )
        .slice(0, 60);
    }

    case 'get_kaizen_summary': {
      const by = ['month', 'category', 'status', 'plant', 'department'].includes(args.by)
        ? args.by
        : 'month';
      const rows = data.kaizen.filter(
        (row) => inRange(row.date, from, to) && matchesPlant(row, plant)
      );
      const groups = new Map();

      for (const row of rows) {
        const key =
          by === 'month'
            ? monthOf(row.date)
            : by === 'category'
              ? row.category
              : by === 'status'
                ? row.status
                : by === 'plant'
                  ? row.plant
                  : row.department;
        if (!key) continue;
        const group = groups.get(key) || {
          group: key,
          count: 0,
          completed: 0,
          savings: 0
        };
        group.count += 1;
        if (row.status === 'Completed') group.completed += 1;
        group.savings += num(row.savings_usd);
        groups.set(key, group);
      }

      return [...groups.values()]
        .map((g) => ({
          group: g.group,
          kaizen_count: g.count,
          completed: g.completed,
          completion_rate_pct: round((g.completed / g.count) * 100),
          savings_usd: Math.round(g.savings)
        }))
        .sort((a, b) =>
          by === 'month'
            ? a.group.localeCompare(b.group)
            : b.kaizen_count - a.kaizen_count
        )
        .slice(0, 60);
    }

    case 'search_kaizen': {
      const q = term(args.query);
      if (q.length < 2) throw new Error('query must be at least 2 characters');
      return data.kaizen
        .filter((row) => matchesPlant(row, plant))
        .filter((row) =>
          [row.title, row.department, row.category, row.status]
            .map((v) => String(v || '').toLowerCase())
            .some((v) => v.includes(q))
        )
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 12)
        .map((row) => ({
          kaizen_id: row.kaizen_id,
          date: row.date,
          plant: row.plant,
          department: row.department,
          title: row.title,
          category: row.category,
          status: row.status,
          savings_usd: num(row.savings_usd)
        }));
    }

    case 'get_advice': {
      const area = ['5s', 'qcp', 'production', 'downtime'].includes(args.area)
        ? args.area
        : '5s';
      const dimension = String(args.dimension || '').toLowerCase();
      const issue = String(args.issue || '').toLowerCase();
      const bank = KB[area] || {};

      let actions = [];
      let topic = dimension || issue || 'general';

      if (area === '5s') {
        if (dimension && bank.dimensions && bank.dimensions[dimension]) {
          actions = bank.dimensions[dimension];
          topic = dimension;
        } else {
          actions = bank.general || [];
          topic = 'general';
        }
      } else {
        const hit = (bank.topics || []).find((t) =>
          (t.keywords || []).some((k) => issue.includes(k))
        );
        if (hit) {
          actions = hit.actions || [];
          topic = hit.keywords[0];
        } else {
          actions = bank.general || [];
          topic = 'general';
        }
      }

      return {
        area,
        topic,
        disclaimer: 'General best practice; validate with the process owner.',
        actions
      };
    }

    default:
      throw new Error('Tool not allowed');
  }
}

module.exports = { TOOLS, runTool };

/**
 * Vertex Demo Manufacturing — Google Sheets connector
 *
 * Setup:
 * 1. Upload Demo_OPEX_Data.xlsx to Google Drive.
 * 2. Right-click it > Open with > Google Sheets. Keep the tab names:
 *    Production, 5S_Audit, QCP_Audit, Kaizen, Breakdown, Plan_Variance.
 * 3. Extensions > Apps Script, paste this file, save.
 * 4. Deploy > New deployment > Web app.
 *    Execute as: Me. Who has access: Anyone with the link.
 * 5. Copy the web app URL into .env as DEMO_SHEETS_JSON_URL.
 * 6. Restart the demo server.
 */

function doGet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabs = {
    production: 'Production',
    '5s_audit': '5S_Audit',
    qcp_audit: 'QCP_Audit',
    kaizen: 'Kaizen',
    breakdown: 'Breakdown',
    plan_variance: 'Plan_Variance'
  };

  const out = {
    meta: {
      company: 'Vertex Demo Manufacturing',
      department: 'Operational Excellence (OPEX)',
      industry: 'Building materials (demonstration)',
      note: 'Synthetic demo data. All names, figures and events are fictional.',
      source: 'google-sheets',
      generated: new Date().toISOString()
    }
  };

  Object.keys(tabs).forEach(function (key) {
    out[key] = readSheet(ss, tabs[key]);
  });

  if (out.production.length) {
    const dates = out.production.map(function (row) {
      return String(row.date);
    }).sort();
    out.meta.from = dates[0];
    out.meta.to = dates[dates.length - 1];
  }

  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function readSheet(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(function (h) {
    return String(h).trim();
  });

  return values.slice(1)
    .filter(function (row) {
      return row.some(function (cell) {
        return cell !== '' && cell !== null;
      });
    })
    .map(function (row) {
      const obj = {};
      headers.forEach(function (header, index) {
        let value = row[index];
        if (value instanceof Date) {
          value = Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        }
        obj[header] = value;
      });
      return obj;
    });
}

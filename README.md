# Vertex Demo Manufacturing — OPEX Assistant

A chat-only demonstration of an Operational Excellence assistant. The company,
plants, audits and figures are fictional; all data is synthetic.

## Run locally

```bash
npm install
copy .env.example .env
# add LLM_API_KEY to .env (Groq free tier works)
npm start
```

Open http://localhost:3300

Environment variables:

| Variable | Purpose |
|---|---|
| `LLM_BASE_URL` | OpenAI-compatible endpoint (default Groq) |
| `LLM_API_KEY` | Provider API key, server-side only |
| `LLM_MODEL` | Model name |
| `PORT` | Default 3300 |
| `DEMO_SHEETS_JSON_URL` | Optional Google Apps Script web app URL |

## Data

- `data/demo-data.json` — data used by the assistant.
- `data/*.csv` — same data as CSV.
- `Demo_OPEX_Data.xlsx` — workbook with Production, 5S_Audit, QCP_Audit,
  Kaizen, Breakdown and Plan_Variance tabs.
- `google-apps-script.gs` — connector to serve the Google Sheet as JSON.
- `generate_data.py` — regenerates the synthetic data (needs `openpyxl`).

To use a Google Sheet, upload the workbook, open it as a Google Sheet, add the
Apps Script, deploy it as a web app, then set `DEMO_SHEETS_JSON_URL` to the web
app URL and restart.

## Deploy

This app needs a Node server, so GitHub Pages cannot host it. Deploy it on
Render with the included blueprint:

1. Push this repository to GitHub.
2. Open `https://render.com/deploy?repo=https://github.com/<owner>/<repo>`.
3. Set `LLM_API_KEY` when prompted.
4. Deploy.

`render.yaml` configures the free plan, build command and start command.

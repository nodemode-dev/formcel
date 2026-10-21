# NOTICE

FormCel
Copyright 2026 nodemode-ai

Licensed under the Apache License, Version 2.0. See `LICENSE`.

## Code from the form family

FormCel ports code from two sibling repositories by the same owner, both Apache-2.0:

| Source | Version | What FormCel uses |
| --- | --- | --- |
| formdeck (nodemode-ai/formdeck) | 0.23.0 | the pre-paint theme profiles in `frontend/index.html`, the Vite proxy layout, the script suite shape; later the home screen, ribbon, command catalogue, terminal dock, sharing and MCP router |
| form.md (nodemode-ai/form.md) | 0.46.0 | `backend/app/templates/formmd.json`: the rows of its 14 Data and charts and 14 Example projects templates, exported from `internal/templates` with dates resolved to 2026-10-21 and option ids turned into their names; later: chart kinds and drawing, large-table windowing, CSV type guessing |

## Third-party components

| Component | Licence | Where |
| --- | --- | --- |
| Vite | MIT | frontend build tool |
| TypeScript | Apache-2.0 | frontend build tool |
| FastAPI | MIT | engine process |
| Uvicorn | BSD-3-Clause | engine process |
| PyO3 | MIT or Apache-2.0 | Python build of the engine |
| maturin | MIT or Apache-2.0 | builds the Python module |
| openpyxl 3.1.5 | MIT | engine process: reading and writing .xlsx (`backend/app/services/xlsx`) |
| et_xmlfile 2.0.0 | MIT | engine process: XML writing for openpyxl |

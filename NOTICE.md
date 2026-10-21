# NOTICE

FormCel
Copyright 2026 nodemode-ai

Licensed under the Apache License, Version 2.0. See `LICENSE`.

## Code from the form family

FormCel ports code from two sibling repositories by the same owner, both Apache-2.0:

| Source | Version | What FormCel uses |
| --- | --- | --- |
| formdeck (nodemode-ai/formdeck) | 0.23.0 | the pre-paint theme profiles in `frontend/index.html`, the Vite proxy layout, the script suite shape; later the home screen, ribbon, command catalogue, terminal dock, sharing and MCP router |
| form.md (nodemode-ai/form.md) | 0.46.0 | later: chart kinds and drawing, large-table windowing, CSV type guessing, template datasets |

## Third-party components

| Component | Licence | Where |
| --- | --- | --- |
| Vite | MIT | frontend build tool |
| TypeScript | Apache-2.0 | frontend build tool |
| FastAPI | MIT | engine process |
| Uvicorn | BSD-3-Clause | engine process |
| PyO3 | MIT or Apache-2.0 | Python build of the engine |
| maturin | MIT or Apache-2.0 | builds the Python module |

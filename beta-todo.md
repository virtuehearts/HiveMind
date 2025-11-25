# HiveMind Local Chat Beta Checklist

Progress tracker for getting the HiveMind chat running locally with EMUs per the plan and README.

## Completed
- [x] Reviewed `HiveMindplan.md` and `README.md` for architecture and setup expectations.
- [x] Streamlined chat UI with EMU readiness cards, slash-command helper, and local testing prompts.

## To-Do
- [ ] Install prerequisites: Node.js (18+), npm, and [Ollama](https://ollama.com) with GPU/CPU support as available.
- [ ] Pull the local router SLM: `ollama pull qwen2.5:1.5b` (or Phi-3.5 equivalent) to enable intent routing.
- [ ] Install project dependencies: `npm install` (bootstraps backend and Vite frontend packages).
- [ ] Configure environment (e.g., `.env` or config) with any API keys for cloud LLM fallback and ports (server: 4000, web: 5173 by default).
- [ ] Start the backend router/dev server: `npm run dev:server` and verify `http://localhost:4000` responds.
- [ ] Start the frontend chat UI: `npm run dev:web` and confirm the UI connects to the backend router endpoints (`/api/route`, `/api/chat`).
- [ ] Prepare or download sample EMU folder (e.g., `poetry.emu/` containing `vectors.lance`, `metadata.json`, `config.yaml`).
- [ ] Implement or validate EMU mount/unmount/list commands (e.g., `/mount <emu>`, `/unmount <emu>`, `/emus`) in the UI/backend.
- [ ] Test retrieval flow with mounted EMUs: router intent → LanceDB hybrid search across mounted EMUs → graded context → cloud synthesize.
- [ ] Run `/learn <emu> <text|file>` to ingest new content and ensure `metadata.json`/`learn.log` update appropriately.
- [ ] Exercise `/bench <emu>` to record relevance/latency scores and store them in EMU metadata for selection.
- [ ] Log latency/token telemetry during chat sessions to verify performance targets (40–50 tokens/sec on quantized SLMs).
- [ ] Document findings and issues during testing for iterative improvements.

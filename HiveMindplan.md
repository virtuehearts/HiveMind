# HiveMind LLM→Vector→LLM Plan (Node.js MVP)

## Goals
- Deliver a local-first agentic RAG stack that runs on modest hardware (<=16GB RAM, single RTX 6–8GB GPU optional).
- Use EMU directories as portable vector "lobes" that can be mounted/unmounted in-session (e.g., `/mount poetry.emu`).
- Provide a web chat UI and simple slash-commands for mounting, unmounting, tagging, and learning into EMUs.
- Route queries through a lightweight local router SLM and selectively escalate to a cloud LLM for synthesis.

## System Overview
1. **Frontend (Web Chat)**
   - Slash commands: `/mount <emu>`, `/unmount <emu>`, `/emus`, `/learn <emu> <text|file>`, `/tags <emu>`, `/bench <emu>`, `/router-mode <local|cloud>`, `/reset`.
   - Real-time streaming responses; display mounted EMU(s), intent, and which EMU(s) served context.
   - Minimal UI stack: React/Vite + Tailwind (or plain HTML + Alpine) for portability; WebSocket/SSE for streams.

2. **Node.js Backend** (Express/Fastify + TypeScript)
   - **Router SLM client (local)**: call Ollama/vLLM Qwen 2.5 1.5B or Phi-3.5 via HTTP; prompt returns `{intent, needs_context, pii_flags, tags, task_complexity}`.
   - **Cloud LLM client**: OpenRouter/Anthropic/Gemini wrapper with streaming + retry + budget limits.
   - **EMU Manager**:
     - `listEmus()`, `mountEmu(path)`, `unmountEmu(id)`, `currentMounted()`.
     - Maintain session-scoped mounted EMUs; allow multiple mounts with scoring/priority tags.
     - Resolve EMU by name/tag (e.g., language=en, type=poetry) and choose best by benchmark score + tag match.
   - **Retriever**: LanceDB (Node bindings) hybrid search (semantic + keyword) across mounted EMUs; fan-out queries to each mounted EMU and merge top-k.
   - **Grader**: local SLM re-ranks/filters retrieved chunks, removes PII, and compresses context.
   - **Synthesizer**: build final prompt with user query, graded context, router metadata; send to cloud LLM; stream back.
   - **Telemetry/Bench**: simple JSON logs of latency, token counts, retrieval scores; `/bench <emu>` computes average MRR/latency using canned prompts.

3. **EMU Format (per README)**
   - Folder: `vectors.lance`, `metadata.json` (tags: language, domain, type; benchmark score; provenance), `config.yaml` (embedding model, retriever params, chunking schema).
   - Optional `notes.md` for human-readable context and `learn.log` for appended learn events.

## Key Flows
1. **Chat Request**
   - Frontend sends `{messages, slash_cmd?, session_id}`.
   - Router SLM predicts intent + tags + context need.
   - If context not needed → respond locally or cloud (chitchat shortcut).
   - If context needed → Retriever queries mounted EMUs; Grader filters; Synthesizer calls cloud; stream output.

2. **Mount/Unmount**
   - `/mount poetry.emu` → backend loads config/metadata, opens LanceDB handle, registers tags/score in session state.
   - `/unmount poetry.emu` → close handle, drop from session state; fallback to default EMU if none mounted.

3. **Learning / Updating EMU**
   - `/learn poetry.emu "<text>"` or file upload.
   - Pipeline: chunk → embed (all-MiniLM-L6-v2 quantized via transformers.js or server-side Python helper) → append to LanceDB → update metadata.json (version bump, stats) and learn.log.
   - Background job to rebuild/compact LanceDB if fragmentation grows.

4. **Benchmarking EMUs**
   - `/bench <emu>` runs a small eval set per tag (e.g., poetry Q/A); produces relevance and latency scores → stored in metadata.json and used for EMU selection.

## Architecture Decisions
- **Language**: TypeScript for backend; keeps type safety and good LanceDB/Ollama SDK support.
- **Transport**: REST + SSE/WebSocket for chat streaming; simple JWT or API key for auth.
- **State**: Per-session in-memory map (Redis optional) storing mounted EMUs, last intent, last router decision.
- **PII Filter**: Regex + router flags; redact before cloud call.
- **Resource Use**: Keep local models quantized (GGUF) and cap concurrent router calls to fit modest CPUs/GPUs.

## Milestones
1. **MVP Skeleton (Day 1–2)**
   - Scaffolding: Express/Fastify server, chat endpoints, SSE streaming, basic React UI.
   - Implement Router SLM client stub; hardcode intents for smoke test.
   - EMU Manager with list/mount/unmount using LanceDB handles; read metadata/config.
   - Retriever fan-out over mounted EMUs; merge top-k.

2. **Functional RAG (Day 3–4)**
   - Integrate real router SLM via Ollama; add intent prompt template and JSON parsing.
   - Add Grader (local SLM) + PII filter; synthesize prompt and call cloud LLM.
   - Implement `/learn` ingestion (text + file) and update EMU artifacts.
   - Wire frontend slash commands; show mounted EMUs + router decision in UI.

3. **Quality & Bench (Day 5+)**
   - Add `/bench` to score EMUs; store results for selection.
   - Add caching for router outputs and retrieval.
   - Add minimal tests (Jest) for EMU Manager, retriever, router parsing.
   - Observability: logging middleware + simple dashboard of latencies/token counts.

## Risks & Mitigations
- **Local model performance**: fallback to smallest quantized model; allow CPU-only mode with reduced concurrency.
- **LanceDB Node stability**: if bindings are unstable, run ingestion via Python CLI and expose retrieval through a lightweight gRPC/REST bridge.
- **PII leakage**: conservative regex + allow user override to force local-only mode (`/router-mode local`).
- **Large EMUs**: use streaming chunk ingest, periodic compaction, and `k` limits per EMU to control memory.

## Deliverables (for this repo)
- `server/` TypeScript backend with router, retriever, grader, synthesizer modules.
- `web/` frontend with chat UI + slash commands.
- `scripts/emu_ingest.ts` (or Python helper) to build EMUs from docs.
- `docs/commands.md` describing slash commands and EMU lifecycle.
- Sample EMU folder (`poetry.emu/`) for local testing.

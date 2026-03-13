# Project Direction: HiveMind Protocol (memU)

## 1. Assessment of Current State
The project has a solid architectural foundation following the "LLM-Vector-LLM Sandwich":
- **Layer 1 (Router):** Local SLM (Qwen 2.5) for intent and routing.
- **Layer 2 (Storage):** EMUs (Encapsulated Memory Units) using LanceDB.
- **Layer 3 (Reasoning):** Cloud LLMs for final synthesis.

**Identified Gaps:**
- **Retrieval Bottleneck:** While EMUs are built with LanceDB vector tables, the current `EmuMemoryLayer` service primarily uses basic keyword matching on text chunks loaded into memory. This limits accuracy and performance as the memory grows.
- **API Maturity:** The API is tailored for the built-in Chat UI. To serve as a robust memory layer for external applications, it needs more direct access points to memory queries without the full agentic loop.
- **Modularity:** The hot-swapping logic is present but can be more robust in terms of resource management (e.g., active DB handles).

## 2. Strategic Roadmap for Performance

### Vector-First Retrieval
- **On-the-fly Embedding:** Integrate `@xenova/transformers` into the `EmuMemoryLayer` to embed user queries locally.
- **Native LanceDB Search:** Shift from keyword-based scoring to vector similarity search directly against the `vectors.lance` files within EMUs.
- **Hybrid Search:** Combine vector similarity with BM25-style keyword matching for better handling of specific technical terms.

### Scalability
- **Connection Pooling:** Manage LanceDB connections efficiently during mount/unmount operations.
- **Background Indexing:** Ensure that `/learn` operations index new data in the background without blocking the main chat thread.

## 3. Robustness for Chat and API

### Unified Memory API
- **Direct Query Endpoint:** Implement `/api/query` to allow external tools to retrieve relevant memory blocks without triggering a full LLM response.
- **Session-Scoped Memory:** Enhance session management to allow different API consumers to have isolated "working memories" or specific sets of mounted EMUs.

### Reliable Local Routing
- **Failover Mechanisms:** Improve robustness when local models (Ollama) are slow or unavailable.
- **Strict JSON Parsing:** Ensure the local SLM output is consistently parsed and handled.

## 4. Modular Memory Ecosystem (EMUs)
- **Standardized Learning:** Create a clear pipeline for "Training" (building an EMU) vs "Learning" (appending to an active EMU).
- **Portable Artifacts:** Refine the export/import functionality to ensure EMUs can be easily shared via Git, IPFS, or Email, as envisioned.
- **Version Control:** Implement simple metadata-based versioning for EMUs to track knowledge updates.

---
*Signed, Jules (Software Engineer)*

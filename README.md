# 🐝 HiveMind Protocol  
### **A Local-First, Privacy-Preserving Architecture for Agentic RAG**  
by **Virtue_hearts** (Darknet.ca Labs)

---
![HiveMind Architecture](https://github.com/virtuehearts/HiveMind/blob/main/hivemind.jpg?raw=true)



---

# ⚡ Overview  
HiveMind is a **local-first, edge-augmented RAG protocol** that treats memory as **portable, hot-swappable artifacts** called **EMUs (Encapsulated Memory Units)** — instead of giant monolithic vector databases.

This repository is also the framework for **HiveMind LLM 3.0** — a next-generation model designed to compete with xAI and OpenAI and push toward AGI. Explore the roadmap in [Future_HiveMind_LLM.md](./Future_HiveMind_LLM.md).

## 🚀 Quick Setup Guide
1. **Install prerequisites**
   - [Node.js 20+](https://nodejs.org) (includes `npm`)
   - [Ollama](https://ollama.com) for the local router model
2. **Clone the repo**
   ```bash
   git clone https://github.com/virtuehearts/HiveMind.git
   cd HiveMind
   ```
3. **Install dependencies** (backend + Vite frontend)
   ```bash
   npm install
   ```
4. **Download the router model (8GB-friendly)**
   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   # Smallest default: 1.5B parameters
   ollama pull qwen2.5:1.5b-instruct
   ```
5. **Start the backend** (API on http://localhost:4000)
   ```bash
   npm run dev:server
   ```
6. **Start the web UI** in a second terminal (http://localhost:5173)
   ```bash
   npm run dev:web
   ```
7. **Verify connectivity**
   - Open the web UI and confirm the readiness cards for backend URL, router model, and EMU mounts show green.

## 🔑 Configuration prerequisites
- **OpenRouter** – set `OPENROUTER_API_KEY` in your environment (or `.env`) before running enrichment jobs so the backend can stream responses. You can override the default model with `OPENROUTER_MODEL`.
- **Local embeddings** – the EMU builder uses `Xenova/all-MiniLM-L6-v2`. The first run downloads the model to your transformers cache; ensure the machine can reach the model hub or pre-seed the cache (e.g., via `TRANSFORMERS_CACHE`).

## 🐚 One-Command Operations with the `HiveMind` Script
Use the bundled `HiveMind` shell script in the repo root to manage the full stack (Ollama, backend, and web UI). It stores PID files and logs under `.hivemind/` so you can start/stop services cleanly.

```bash
# Install Ollama if needed, pull qwen2.5:1.5b-instruct, and start everything
./HiveMind install

# Start all services (assumes dependencies are already installed)
./HiveMind start

# Check process status (ollama / server / web)
./HiveMind status

# Stop everything
./HiveMind stop
```

Logs live in `.hivemind/logs/` for each component (Ollama, server, and web). Use `./HiveMind help` to see all available commands.

## Getting started (local router + web UI)
1. Install [Ollama](https://ollama.com) locally and pull the lightweight router model: `ollama pull qwen2.5:1.5b-instruct`.
2. Install workspace dependencies: `npm install` (this sets up both the backend and the Vite frontend).
3. Run the backend: `npm run dev:server` (default: http://localhost:4000).
4. In a new terminal, run the frontend: `npm run dev:web` (default: http://localhost:5173).

The frontend uses the backend router endpoints (`/api/route` and `/api/chat`) to exercise the local Qwen2.5 1.5B router before the rest of the RAG stack is added. The compact default keeps RAM use low enough for 8GB laptops while still enabling routing and chat.


It is designed to run on:
✅ **Consumer CPUs (8–16GB RAM)** — Qwen2.5 1.5B stays under ~4GB RAM
✅ **NVIDIA RTX GPUs (6GB VRAM)**
while delivering **40–50 tokens/sec** using quantized SLMs.

## Using the EMU-ready chat UI
- The Chat page shows readiness cards for the backend URL, router model, mounted EMUs, and the three startup steps above.
- Use slash commands directly from the input box: `/emus` to list, `/mount <emu-id>`, `/unmount <emu-id>`, and `/reset`.
- Add folders ending in `.emu` under `emus/`, refresh, then mount and ask questions to see retrieved context in the preview panel.
- Settings allow overriding the API base if your backend is not on `http://localhost:4000`.

HiveMind is the **anti-enterprise RAG**:  
no lock-in, no cloud dependency, no surveillance, no massive vector silos.

---

# 🧠 Why HiveMind Exists  
Current enterprise RAG systems are fundamentally flawed:

❌ **Privacy Risk** — They transmit entire context windows (including PII) to cloud LLMs  
❌ **Latency** — Remote vector DB round-trips slow the entire pipeline  
❌ **Cost** — Tokens wasted on irrelevant noise  
❌ **Vendor Lock-In** — Memory trapped inside proprietary cloud systems  
❌ **Monolithic Databases** — Giant, static vector stores nobody can fork or share

### HiveMind flips the model:

**Local memory. Cloud inference. Zero noise. Maximum privacy.  
Your machine becomes the router, filter, and guardian at the gate.**

---

# 🔥 Core Idea: EMUs  
**Encapsulated Memory Units** are portable, Git-friendly knowledge capsules:

```
my-dataset.emu/
   ├── vectors.lance      # LanceDB file-based embeddings
   ├── metadata.json      # Tags, attribution, version info
   └── config.yaml        # Embedding model + retriever settings
```

### EMUs are:
- 🟩 **Portable** — Share via Git, IPFS, email, S3, or attachments
- 🟩 **Sharable** — Share via hivemind / torrent protocol 
- 🟩 **Hot-Swappable** — Mount/unmount instantly based on query intent  
- 🟩 **Local-First** — Stored on disk, not a cloud DB  
- 🟩 **Version-Controlled** — Branch, diff, roll back  
- 🟩 **Composable** — Mix and match EMUs like software packages

**Knowledge becomes modular.  
Knowledge becomes a file.  
Knowledge becomes yours.**

---

# 🏗 Architecture: The “LLM → Vector → LLM” Sandwich  

### **Layer 1 — Local Orchestrator (Router)**  
Runs entirely on CPU/GPU locally  
Models: **Qwen 2.5 (1.5B–3B)** / **Phi-3.5**  
Tasks:  
- Intent Classification  
- Query Transformation  
- Re-Ranking  
- PII Redaction  
- EMU Selection  

### **Layer 2 — Storage Layer (Memory)**  
- LanceDB (serverless, file-based)  
- Embeddings: **all-MiniLM-L6-v2 (quantized)**  
- Memory = **local disk**, not a remote DB  

### **Layer 3 — Reasoning Layer (Cloud LLM)**  
Gemini / Claude / GPT / OpenRouter  
- Pure inference  
- No persistent state  
- Lowest possible context due to local pre-filtering  

### **90% reduction in cloud token cost**  
because only relevant, cleaned, graded chunks make it upstream.

---

# 🧩 The HiveMind Pipeline (LangGraph Implementation)

```
User Input
   ↓
intent_router (Local SLM)
   ↓ (Context Needed)
retriever (LanceDB Hybrid Search)
   ↓
grader (Local SLM, PII Filter, Relevancy Scoring)
   ↓
synthesizer (Cloud LLM)
   ↓
Client Output
```

A **stategraph** with conditional edges ensures deterministic routing and fine-grained agent control.

---

# 🔥 Key Features

## 1️⃣ Local-First Semantic Firewall  
Before a cloud LLM sees *anything*, HiveMind:  
✔ Runs intent classification locally  
✔ Filters irrelevant retrievals  
✔ Removes PII  
✔ Compresses + rewrites chunks into minimal gold context  

**Cloud LLM only receives clean, tiny, relevant context.**

---

## 2️⃣ EMU Hot-Swapping  
Mount/unmount knowledge in real time:

```
hivemind mount poetry.emu
hivemind mount python-docs.emu
hivemind unmount legal-v1.emu
```

No monolithic DB.  
No global vector mess.  
Zero noise.

---

## 3️⃣ Built for 6GB GPUs & 16GB RAM  
- Quantized Qwen/Phi models  
- LanceDB file-backed retrieval  
- No big corperations having your memories / datasets
- No need for 24gb+ GPU's or Professional hardware.  
- Can run on a **Dell OptiPlex**, **ThinkPad**, or **old gaming PC**

---

# 🛠 Tech Stack

| Layer | Technology | Role |
|------|------------|------|
| Workflow Engine | **LangGraph** | Agentic DAG pipeline |
| Local Inference | **Ollama / vLLM** | SLM execution |
| Vector Store | **LanceDB** | Serverless file-based memory |
| Router SLM | **Qwen 2.5 / Phi-3.5** | Intent classification + routing |
| Cloud LLM | **Gemini 3.0 / Claude / GPT** | Final synthesis |
| Frontend | Web Console / API | Integration layer |

---

# 🧳 EMU Format Example

```yaml
metadata:
  name: "Classic English Poetry"
  version: "v1.2"
  creator: "John Doe"
  timestamp: "2025-11-23T14:00:00Z"

embeddings:
  model: "all-MiniLM-L6-v2"
  dimension: 384

retriever_settings:
  k_neighbors: 5
  max_score_threshold: 0.82
```

EMUs are zipped bundles that run **locally, privately, offline**.

---

# ⚙️ Project Status

| Status | Value |
|--------|-------|
| CPU/GPU Target | **Consumer CPU** or **NVIDIA RTX (6GB)** |
| Throughput | **40–50 tokens/sec** (quantized SLM) |
| Architecture | **Local-First / Edge-Augmented** |
| Core Feature | **EMU Capsules** |

---

# 🚀 Roadmap

### **Phase 1 — Core (MVP)**
✅ EMU file format  
✅ Python EMU mount/unmount  
✅ HiveMind Console  
✅ LangGraph integration  

### **Phase 2 — Sharing (Decentralization)**
⬜ Public EMU Browser  
⬜ EMU Registry  
⬜ IPFS Distribution  
⬜ Torrent-based Swarms  
⬜ Community Knowledge Marketplace  

### **Phase 3 — Learning (Automation)**
⬜ Auto-build EMUs using Gemini  
⬜ Domain-specific EMU builders  
⬜ Self-healing “Teach HiveMind” loops  

---

# 🎯 Mission Statement  
**HiveMind is building the world’s first fully local-first Agentic RAG protocol:**

- Optimized for **RTX 6GB GPUs** and **low-budget workstations**  
- 40–50 TPS SLM pipelines  
- Portable, modular memory containers  
- Cloud only for final reasoning  
- Privacy built in by default  

**Your data stays yours.  
Your memory stays local.  
Your agents become sovereign.**

---

# 👤 Author  
Created by **Warren Kreklo**  
Darknet.ca Labs (Est. 2003)  
📧 admin@darknet.ca  
🐦 @virtue_hearts

# 🐝 HiveMind Protocol

**A Local-First, Privacy-Preserving Architecture for Agentic RAG.**

![HiveMind Architecture]
![HiveMind Architecture](https://github.com/virtuehearts/HiveMind/blob/main/hivemind.jpg?raw=true)



## 🧠 The Problem
Current Enterprise RAG (Retrieval-Augmented Generation) architectures are flawed:
1.  **Privacy Risks:** Sending full context windows to cloud providers leaks PII.
2.  **Latency:** Round-tripping irrelevant data to the cloud is slow.
3.  **Cost:** Token usage on "noise" (irrelevant documents) drains budgets.
4.  **The Monolith:** Vector Databases are treated as massive, static silos.

## 💡 The Solution: HiveMind & EMUs
HiveMind is an edge-cloud hybrid protocol that introduces the concept of **EMUs (Encapsulated Memory Units)**.

### Core Concepts

#### 1. The EMU (Encapsulated Memory Unit)
Instead of a monolithic Vector DB, memory is treated as a **portable artifact**.
* **File-System Based:** Uses LanceDB to store vectors as flat files.
* **Hot-Swappable:** Agents can "mount" specific knowledge bases (e.g., `legal-v1.emu`, `python-docs.emu`) dynamically.
* **Version Controlled:** Memory can be versioned, branched, and rolled back like code.

#### 2. The "Semantic Firewall" (Local Routing)
Before any data hits a Cloud LLM (GPT5.1/Claude/Phi/Gemini 3.0), 
it passes through a local Small Language Model (SLM) gateway.
* **Router Node:** Uses **Qwen 2.5 (Local)** to classify intent.
* **Grader Node:** Evaluates retrieval relevance locally.
* **PII Scrubber:** Redacts sensitive entities on the edge.

## 🏗 Architecture

**User Query** -> **[Local Router]** (Classifies Intent)
   |
   +-> **[EMU Mount]** (Loads specific LanceDB context)
   |
   +-> **[Local Grader]** (Filters noise)
   |
   +-> **[Cloud LLM]** (Synthesizes final answer with sanitized context)

## 🛠 Tech Stack
* **Orchestration:** LangGraph
* **Local Inference:** Ollama / vLLM
* **Vector Store:** LanceDB (Serverless)
* **Routing Model:** Qwen 2.5 1.5B - 2B
* **Optimized to run on consumer grade CPU / 6GB RTX GPU (with goal of 50TPS) 

## 🚀 Roadmap
- [ ] Core EMU Interface (Python)
- [ ] Local Router Logic (LangGraph)
- [ ] "Hot-Swap" Mounting Demo

---
*Concept by Virtue_hearts / admin@darknet.ca 

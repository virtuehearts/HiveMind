# Local Chat + EMU Memory Blocks

The local chat stack now threads EMU memory blocks directly into the system prompt so short-term conversation history and portable knowledge snippets are considered together.

## How EMU blocks flow through the chat path
```mermaid
flowchart TD
    subgraph Client
      U[User message]
    end

    subgraph Server
      R[Router /chat endpoint]
      M[EMU Memory Layer\n(tag + intent match)]
      O[OllamaClient.chat\n(system prompt + history + EMU summaries)]
    end

    U --> R
    R --> M
    M -->|Top-N relevant blocks\n(summary + tags)| R
    R --> O
    O -->|Local reply uses\nconversation + EMUs| U
```

1. The `/chat` endpoint receives a message (and optionally router-provided `intent`, `tags`, and `transformedQuery`).
2. The EMU memory layer scores blocks by tag, intent, and token overlap to pick the top matches.
3. The chosen EMUs are summarized inline and appended to the system prompt so the local model can cite them.
4. Ollama runs the lightweight Qwen router model with this augmented prompt and returns the final reply.

## System prompt adjustments
The chat system prompt now explicitly instructs the model to weave in EMU memory blocks when present, prefer them over re-asking questions, and stay offline/low-latency. The `/chat` handler prepends the selected EMUs to the prompt it sends to Ollama.

## Quick local test (no cloud needed)
You can sanity-check the scoring locally without starting the server:

```bash
npx tsx -e "import os from 'os'; import path from 'path'; import { EmuMemoryLayer } from './server/src/services/emuMemoryLayer'; const store = path.join(os.tmpdir(), 'emu-memory-demo.json'); const layer = new EmuMemoryLayer(store); layer.addBlock({ title: 'Greeting rule', content: 'Always greet local users warmly and mention EMU support.', tags: ['welcome', 'greeting'] }); layer.addBlock({ title: 'Privacy preference', content: 'User hates cloud uploads and wants local-first memory.', tags: ['privacy', 'local-first'] }); console.log(layer.findRelevantBlocks('local-first privacy chat', { tags: ['privacy'] }));"
```

The output shows the top-matching EMU blocks that will be woven into the chat system prompt when similar queries arrive.

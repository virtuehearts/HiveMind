import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import router from './routes/router';
import { config } from './config';

const app = express();

const fallbackHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HiveMind router</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        background: #0c111d;
        color: #e5e7eb;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 48px 16px;
      }
      .card {
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 16px;
        box-shadow: 0 20px 45px rgba(0, 0, 0, 0.35);
        max-width: 720px;
        width: min(720px, 100%);
        padding: 24px;
      }
      h1 {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 8px;
      }
      h2 {
        margin: 8px 0 0;
        font-size: 14px;
        font-weight: 500;
        color: #9ca3af;
      }
      .chat-log {
        margin: 16px 0;
        padding: 16px;
        background: #0b1220;
        border: 1px solid #1f2937;
        border-radius: 12px;
        min-height: 200px;
        max-height: 320px;
        overflow: auto;
        font-size: 14px;
        line-height: 1.5;
        display: grid;
        gap: 8px;
      }
      .bubble {
        padding: 10px 12px;
        border-radius: 10px;
      }
      .bubble.user {
        background: #1d4ed8;
        justify-self: end;
      }
      .bubble.assistant {
        background: #111827;
        border: 1px solid #1f2937;
      }
      form {
        display: flex;
        gap: 8px;
      }
      input {
        flex: 1;
        border-radius: 10px;
        border: 1px solid #1f2937;
        background: #0b1220;
        color: inherit;
        padding: 12px;
      }
      button {
        border: none;
        border-radius: 10px;
        background: linear-gradient(135deg, #fbbf24, #f97316);
        color: #0b1220;
        padding: 0 16px;
        font-weight: 700;
        cursor: pointer;
      }
      .status {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin: 12px 0 0;
        font-size: 12px;
        color: #9ca3af;
      }
      .badge {
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid #1f2937;
        background: #0b1220;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>🐝 HiveMind router</h1>
      <h2>Simple local chat fallback UI</h2>
      <div class="chat-log" id="log"></div>
      <form id="chat-form">
        <input id="prompt" placeholder="Send a local message" autocomplete="off" />
        <button type="submit">Send</button>
      </form>
      <div class="status">
        <span class="badge" id="model"></span>
        <span class="badge" id="state">Idle</span>
      </div>
    </div>
    <script>
      const log = document.getElementById('log');
      const form = document.getElementById('chat-form');
      const input = document.getElementById('prompt');
      const model = document.getElementById('model');
      const state = document.getElementById('state');
      const sessionId = 'sess-' + Math.random().toString(36).slice(2, 8);

      const addMessage = (role, content) => {
        const bubble = document.createElement('div');
        bubble.className = 'bubble ' + role;
        bubble.textContent = content;
        log.appendChild(bubble);
        log.scrollTop = log.scrollHeight;
      };

      const setState = (label) => (state.textContent = label);

      fetch('/api/model')
        .then((res) => res.json())
        .then((info) => {
          model.textContent = info.model + ': ' + (info.available ? 'ready' : 'unavailable');
        })
        .catch(() => (model.textContent = 'Router status unavailable'));

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const prompt = input.value.trim();
        if (!prompt) return;
        addMessage('user', prompt);
        input.value = '';
        try {
          setState('Classifying…');
          const decision = await fetch('/api/route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: prompt, sessionId })
          }).then((r) => r.json());

          setState('Responding…');
          const reply = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: prompt, sessionId, transformedQuery: decision.transformedQuery })
          }).then((r) => r.json());

          addMessage('assistant', reply.reply || 'Router responded without text.');
        } catch (err) {
          addMessage('assistant', 'Unable to reach local router. Ensure the backend is running.');
        } finally {
          setState('Idle');
        }
      });
    </script>
  </body>
</html>`;

app.use(express.json());
app.use(
  cors({
    origin: config.allowOrigins,
    credentials: true
  })
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', routerModel: config.routerModel });
});

app.use('/api', router);

const webRoot = path.resolve(__dirname, '..', '..', 'web', 'dist');

if (fs.existsSync(webRoot)) {
  app.use(express.static(webRoot));

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'Route not found' });
      return;
    }

    res.sendFile(path.join(webRoot, 'index.html'));
  });
} else {
  console.warn(
    `Web UI build directory not found at ${webRoot}. ` +
      'Run "npm run build" (or "npm --workspace web run build") so the frontend can be served.'
  );

  app.get('/', (_req, res) => {
    res.type('html').send(fallbackHtml);
  });
}

app.listen(config.port, () => {
  console.log(`HiveMind backend listening on port ${config.port}`);
});

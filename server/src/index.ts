import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import router from './routes/router';
import { config } from './config';
import emuRoutes from './routes/emu';
import retrieverRoutes from './routes/retriever';

const app = express();

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
app.use('/api', emuRoutes);
app.use('/api', retrieverRoutes);

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
}

app.listen(config.port, () => {
  console.log(`HiveMind backend listening on port ${config.port}`);
});

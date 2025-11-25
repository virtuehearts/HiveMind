import cors from 'cors';
import express from 'express';
import router from './routes/router';
import { config } from './config';

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

app.listen(config.port, () => {
  console.log(`HiveMind backend listening on port ${config.port}`);
});

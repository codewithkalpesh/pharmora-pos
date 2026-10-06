import app from './app.js';
import env from './config/env.js';
import { startNotificationScheduler } from './services/notificationScheduler.js';

app.listen(env.port, '0.0.0.0', () => {
  console.log(`Pharmora POS API running on port ${env.port} (0.0.0.0)`);
  startNotificationScheduler();
});


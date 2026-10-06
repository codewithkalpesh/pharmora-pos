import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, message: 'Pharmora POS API is running' });
});

export default router;

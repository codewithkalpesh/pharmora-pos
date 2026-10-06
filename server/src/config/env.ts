import dotenv from 'dotenv';

dotenv.config();

const clientUrls = (process.env.CLIENT_URL ?? 'http://localhost:5173')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-local-secret-change-me',
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/pharmora_pos?schema=public',
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  allowedOrigins: Array.from(
    new Set([
      ...clientUrls,
      'http://localhost:5173',
      'http://localhost:4173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:4173',
      'http://localhost',
      'https://localhost',
      'capacitor://localhost',
    ]),
  ),
};

export default env;


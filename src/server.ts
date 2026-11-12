import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import express from 'express';
import { z } from 'zod';
import { createApp, errorHandler } from './app.ts';
import { Store } from './store.ts';

const env = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
  APP_ORIGIN: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().default('./data/santa.sqlite'),
  GROUP_INVITE_CODE: z.string().regex(/^\d{6}$/, 'GROUP_INVITE_CODE must be exactly 6 digits, e.g. 482913.'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  FACEBOOK_CLIENT_ID: z.string().default(''),
  FACEBOOK_CLIENT_SECRET: z.string().default(''),
  FACEBOOK_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v24.0'),
}).parse(process.env);
const production = env.NODE_ENV === 'production';
const origin = new URL(env.APP_ORIGIN);
if (origin.origin !== env.APP_ORIGIN || (production && origin.protocol !== 'https:')) {
  throw new Error('APP_ORIGIN must be an origin without a trailing slash; production requires HTTPS.');
}
for (const [id, secret] of [[env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET], [env.FACEBOOK_CLIENT_ID, env.FACEBOOK_CLIENT_SECRET]]) {
  if (Boolean(id) !== Boolean(secret)) throw new Error('Each OAuth provider needs both its client ID and client secret.');
}
if (production && !env.GOOGLE_CLIENT_ID && !env.FACEBOOK_CLIENT_ID) throw new Error('Configure at least one sign-in provider before production startup.');
mkdirSync(dirname(resolve(env.DATABASE_PATH)), { recursive: true, mode: 0o700 });
const store = new Store(env.DATABASE_PATH);
store.prune();
const pruneTimer = setInterval(() => store.prune(), 60 * 60 * 1000);
pruneTimer.unref();
const app = createApp({
  origin: env.APP_ORIGIN, production, inviteCode: env.GROUP_INVITE_CODE,
  google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
  facebook: { clientId: env.FACEBOOK_CLIENT_ID, clientSecret: env.FACEBOOK_CLIENT_SECRET },
  facebookVersion: env.FACEBOOK_GRAPH_VERSION,
}, store);
app.use(express.static(resolve('dist'), { index: false }));
app.get('/', (_req, res) => res.sendFile(resolve('dist/index.html')));
app.use(errorHandler);
const server = app.listen(env.PORT, '0.0.0.0', () => console.log(`Secret Santa listening on port ${env.PORT}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(pruneTimer);
    server.close(() => { store.db.close(); process.exit(0); });
  });
}

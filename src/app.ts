import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { nameSchema, wishlistSchema } from './domain.ts';
import { Store } from './store.ts';
import { infoPage } from './pages.ts';

type Provider = 'google' | 'facebook';
type Credentials = { clientId: string; clientSecret: string };
export type AppConfig = {
  origin: string;
  production: boolean;
  inviteCode: string;
  google: Credentials;
  facebook: Credentials;
  facebookVersion: string;
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
function cookie(req: Request, name: string): string {
  return req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
}

export function createApp(config: AppConfig, store: Store) {
  const app = express();
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1);
  app.use(helmet({ referrerPolicy: { policy: 'no-referrer' } }));
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(['/api', '/auth'], rateLimit({
    windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a minute and try again.' },
  }));
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Please try again in 15 minutes.' },
  });
  const sessionName = config.production ? '__Host-santa' : 'santa';
  const oauthName = config.production ? '__Host-santa-oauth' : 'santa-oauth';
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax' as const, path: '/' };
  const providers = {
    google: Boolean(config.google.clientId && config.google.clientSecret),
    facebook: Boolean(config.facebook.clientId && config.facebook.clientSecret),
  };
  function currentUser(req: Request) {
    const session = z.object({ user_id: z.string() }).optional().parse(
      store.db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires > ?').get(hash(cookie(req, sessionName)), Date.now()),
    );
    return session ? store.getUser(session.user_id) : null;
  }
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.origin) {
      res.status(403).json({ error: 'Request origin was not accepted. Reload the website and try again.' });
      return;
    }
    next();
  });
  app.get('/api/session', (req, res) => res.json({ user: currentUser(req), providers }));
  app.post('/api/logout', (req, res) => {
    store.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(cookie(req, sessionName)));
    res.clearCookie(sessionName, cookieOptions).json({ ok: true });
  });
  app.delete('/api/account', (req, res) => {
    const user = currentUser(req);
    if (!user) { res.status(401).json({ error: 'Please sign in first.' }); return; }
    store.deleteUser(user.id);
    res.clearCookie(sessionName, cookieOptions).json({ ok: true });
  });
  // Per-account cap on wrong invite codes, in addition to the per-IP limit, so rotating IPs doesn't buy more guesses.
  const inviteLimiter = rateLimit({
    windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    skip: req => !currentUser(req),
    keyGenerator: req => `user:${currentUser(req)?.id}`,
    requestWasSuccessful: (_req, res) => res.statusCode !== 403,
    skipSuccessfulRequests: true,
    message: { error: 'Too many incorrect invite codes. Please check with your organiser and try again in an hour.' },
  });
  app.put('/api/profile', loginLimiter, inviteLimiter, (req, res) => {
    const user = currentUser(req);
    if (!user) { res.status(401).json({ error: 'Please sign in first.' }); return; }
    const parsed = z.object({ shortName: nameSchema, inviteCode: z.string().max(200).optional() }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
    const inviteCode = (parsed.data.inviteCode ?? '').replace(/\s/g, '');
    if (!user.member && !timingSafeEqual(Buffer.from(hash(inviteCode)), Buffer.from(hash(config.inviteCode)))) {
      res.status(403).json({ error: 'That invite code is not correct. Ask your organiser for the group code.' });
      return;
    }
    if (store.nameTaken(parsed.data.shortName, user.id)) {
      res.status(409).json({ error: 'Someone in the group already uses that name. Please choose a different one.' });
      return;
    }
    store.join(user.id, parsed.data.shortName);
    res.json({ user: store.getUser(user.id) });
  });
  app.get('/api/members', (req, res) => {
    const user = currentUser(req);
    if (!user?.member) { res.status(user ? 403 : 401).json({ error: 'Join the group to see wishlists.' }); return; }
    res.json({ members: store.members() });
  });
  app.put('/api/wishlist', (req, res) => {
    const user = currentUser(req);
    if (!user?.member) { res.status(user ? 403 : 401).json({ error: 'Join the group before saving gifts.' }); return; }
    const parsed = wishlistSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
    store.saveGifts(user.id, parsed.data);
    res.json({ user: store.getUser(user.id) });
  });

  function providerFrom(value: string): Provider | null {
    return value === 'google' || value === 'facebook' ? value : null;
  }
  app.get('/auth/:provider', loginLimiter, (req, res) => {
    const provider = providerFrom(String(req.params.provider));
    if (!provider || !providers[provider]) { res.status(503).send('This sign-in provider has not been configured.'); return; }
    const state = token();
    const browser = token();
    const verifier = token();
    store.prune();
    store.db.prepare('INSERT INTO oauth_states VALUES (?, ?, ?, ?, ?)').run(hash(state), hash(browser), provider, verifier, Date.now() + 600_000);
    res.cookie(oauthName, browser, { ...cookieOptions, maxAge: 600_000 });
    const redirectUri = `${config.origin}/auth/${provider}/callback`;
    const url = new URL(provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : `https://www.facebook.com/${config.facebookVersion}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: config[provider].clientId, redirect_uri: redirectUri, response_type: 'code', state,
      scope: provider === 'google' ? 'openid profile' : 'public_profile',
      ...(provider === 'google' ? { code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' } : {}),
    }).toString();
    res.redirect(url.href);
  });
  app.get('/auth/:provider/callback', loginLimiter, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const provider = providerFrom(String(req.params.provider));
    const query = z.object({ state: z.string().min(1).max(200), code: z.string().max(4096).optional(), error: z.string().optional() }).safeParse(req.query);
    if (!provider || !providers[provider] || !query.success) { res.status(400).send('Invalid sign-in callback. Please start sign-in again.'); return; }
    const state = z.object({ verifier: z.string() }).optional().parse(
      store.db.prepare('SELECT verifier FROM oauth_states WHERE state_hash = ? AND browser_hash = ? AND provider = ? AND expires > ?')
        .get(hash(query.data.state), hash(cookie(req, oauthName)), provider, Date.now()),
    );
    if (!state) { res.status(400).send('Sign-in expired or could not be verified. Please start sign-in again.'); return; }
    store.db.prepare('DELETE FROM oauth_states WHERE state_hash = ?').run(hash(query.data.state));
    res.clearCookie(oauthName, cookieOptions);
    if (query.data.error || !query.data.code) { res.redirect('/?authError=cancelled'); return; }
    const redirectUri = `${config.origin}/auth/${provider}/callback`;
    const tokenUrl = provider === 'google' ? 'https://oauth2.googleapis.com/token' : `https://graph.facebook.com/${config.facebookVersion}/oauth/access_token`;
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        client_id: config[provider].clientId, client_secret: config[provider].clientSecret,
        code: query.data.code, redirect_uri: redirectUri, grant_type: 'authorization_code',
        ...(provider === 'google' ? { code_verifier: state.verifier } : {}),
      }),
    });
    if (!tokenResponse.ok) throw new Error(`${provider} token exchange failed (${tokenResponse.status})`);
    const access = z.object({ access_token: z.string().min(1) }).parse(await tokenResponse.json());
    const identityUrl = new URL(provider === 'google' ? 'https://openidconnect.googleapis.com/v1/userinfo' : `https://graph.facebook.com/${config.facebookVersion}/me`);
    if (provider === 'facebook') {
      identityUrl.searchParams.set('fields', 'id');
      identityUrl.searchParams.set('appsecret_proof', createHmac('sha256', config.facebook.clientSecret).update(access.access_token).digest('hex'));
    }
    const identityResponse = await fetch(identityUrl, {
      headers: { Authorization: `Bearer ${access.access_token}` }, signal: AbortSignal.timeout(10_000),
    });
    if (!identityResponse.ok) throw new Error(`${provider} identity lookup failed (${identityResponse.status})`);
    const identity = await identityResponse.json();
    const providerId = provider === 'google'
      ? z.object({ sub: z.string().min(1) }).parse(identity).sub
      : z.object({ id: z.string().min(1) }).parse(identity).id;
    const userId = store.findOrCreateUser(provider, providerId);
    const session = token();
    const maxAge = 30 * 24 * 60 * 60 * 1000;
    store.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(cookie(req, sessionName)));
    store.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash(session), userId, Date.now() + maxAge);
    res.cookie(sessionName, session, { ...cookieOptions, maxAge });
    res.redirect('/');
  });
  app.get('/privacy', (_req, res) => { res.type('html').send(infoPage('privacy')); });
  app.get('/data-deletion', (_req, res) => { res.type('html').send(infoPage('deletion')); });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use('/auth', (_req, res) => res.status(404).send('Sign-in route not found.'));
  return app;
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 413) {
    res.status(413).json({ error: 'Request is too large.' });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'Invalid JSON request.' });
    return;
  }
  console.error('Request failed:', error instanceof Error ? error.message : 'Unknown server error');
  if (req.path.startsWith('/auth/')) { res.redirect('/?authError=failed'); return; }
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
}

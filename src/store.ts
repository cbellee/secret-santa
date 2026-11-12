import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { nameKey, wishlistSchema } from './domain.ts';
import type { CurrentUser, Member, Gift } from './domain.ts';

const userRow = z.object({
  id: z.string(),
  short_name: z.string().nullable(),
  member: z.number(),
  gifts: z.string(),
});

export class Store {
  db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_id TEXT NOT NULL,
        short_name TEXT, member INTEGER NOT NULL DEFAULT 0,
        gifts TEXT NOT NULL DEFAULT '[]', UNIQUE(provider, provider_id)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_states (
        state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, provider TEXT NOT NULL,
        verifier TEXT NOT NULL, expires INTEGER NOT NULL
      );
    `);
  }

  getUser(id: string): CurrentUser | null {
    const raw = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!raw) return null;
    const row = userRow.parse(raw);
    return {
      id: row.id, shortName: row.short_name, member: row.member === 1,
      gifts: wishlistSchema.parse(JSON.parse(row.gifts)),
    };
  }

  findOrCreateUser(provider: string, providerId: string): string {
    this.db.prepare('INSERT OR IGNORE INTO users (id, provider, provider_id) VALUES (?, ?, ?)')
      .run(randomUUID(), provider, providerId);
    return z.object({ id: z.string() }).parse(
      this.db.prepare('SELECT id FROM users WHERE provider = ? AND provider_id = ?').get(provider, providerId),
    ).id;
  }

  nameTaken(name: string, exceptId: string): boolean {
    const key = nameKey(name);
    return this.db.prepare('SELECT short_name FROM users WHERE member = 1 AND id != ?').all(exceptId)
      .some(row => nameKey(z.object({ short_name: z.string() }).parse(row).short_name) === key);
  }

  join(id: string, name: string) {
    this.db.prepare('UPDATE users SET short_name = ?, member = 1 WHERE id = ?').run(name, id);
  }

  saveGifts(id: string, gifts: Gift[]) {
    this.db.prepare('UPDATE users SET gifts = ? WHERE id = ?').run(JSON.stringify(gifts), id);
  }

  deleteUser(id: string) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  members(): Member[] {
    return this.db.prepare('SELECT * FROM users WHERE member = 1 ORDER BY short_name COLLATE NOCASE').all().map(raw => {
      const row = userRow.parse(raw);
      return { id: row.id, shortName: z.string().parse(row.short_name), gifts: wishlistSchema.parse(JSON.parse(row.gifts)) };
    });
  }

  prune() {
    this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    this.db.prepare('DELETE FROM oauth_states WHERE expires <= ?').run(Date.now());
  }
}

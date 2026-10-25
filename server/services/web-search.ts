import type { Express } from 'express';
import type { Store } from '../db.ts';
import { config } from '../config.ts';
import { AppError } from '../domain.ts';
import { encryptSecret, readableSecret } from './model-settings.ts';

export function webSearchKey(db: Store, owner: string) {
  const row = db.get<{ mode: string; secret: string }>(
    'SELECT mode,secret FROM web_settings WHERE owner=?',
    owner,
  );
  return row?.mode === 'personal' ? readableSecret(row.secret) : config.tavilyKey;
}
function summary(db: Store, owner: string) {
  const row = db.get<{ mode: string; secret: string }>(
    'SELECT mode,secret FROM web_settings WHERE owner=?',
    owner,
  );
  return {
    mode: row?.mode || 'site',
    hasKey: Boolean(row?.secret && readableSecret(row.secret)),
    siteConfigured: Boolean(config.tavilyKey),
    configured: Boolean(webSearchKey(db, owner)),
  };
}
export function installWebSettings(app: Express, db: Store) {
  app.get('/api/web-settings', (req, res) => res.json(summary(db, req.owner)));
  app.put('/api/web-settings', (req, res) => {
    const { mode, key } = req.body;
    if (
      !['site', 'personal'].includes(mode) ||
      (key !== undefined && (typeof key !== 'string' || key.length > 512))
    )
      throw new AppError(422, '请检查 Tavily 配置。');
    const previous = db.get<{ secret: string }>('SELECT secret FROM web_settings WHERE owner=?', req.owner);
    const secret = key?.trim() ? encryptSecret(key.trim()) : previous?.secret || '';
    if (mode === 'personal' && !secret) throw new AppError(422, '请填写你的 Tavily API Key。');
    db.run(
      'INSERT INTO web_settings(owner,mode,secret) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET mode=excluded.mode,secret=excluded.secret',
      req.owner,
      mode,
      secret,
    );
    res.json(summary(db, req.owner));
  });
  app.delete('/api/web-settings', (req, res) => {
    db.run('DELETE FROM web_settings WHERE owner=?', req.owner);
    res.json(summary(db, req.owner));
  });
}
export async function searchWeb(query: string, key: string) {
  const response = await fetch(config.tavilyUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: query.slice(0, 600),
      search_depth: 'basic',
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Tavily 返回 ${response.status}，请检查 Key 或额度。`);
  const data = (await response.json()) as { results?: { title: string; url: string; content: string }[] };
  return (data.results || [])
    .filter(
      (row) =>
        typeof row.title === 'string' && typeof row.content === 'string' && /^https?:\/\//.test(row.url),
    )
    .slice(0, 5)
    .map((row) => ({ title: row.title.slice(0, 500), url: row.url, content: row.content.slice(0, 4000) }));
}

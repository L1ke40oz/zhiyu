import { AsyncLocalStorage } from 'node:async_hooks';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as safeFetch } from 'undici';
import { config, enabled } from '../config.ts';
import { AppError } from '../domain.ts';
import type { Store } from '../db.ts';
import type { ModelKind } from '../../shared/types.ts';

export type ModelService = { base: string; key: string; model: string; personal?: boolean };
type SettingsRow = { mode: string; base: string; model: string; secret: string };
const context = new AsyncLocalStorage<Record<ModelKind, ModelService>>();
export const currentChatService = (): ModelService => context.getStore()?.chat || config.llm;
export const currentEmbeddingService = (): ModelService => context.getStore()?.embedding || config.embedding;
export const currentVisionService = (): ModelService => context.getStore()?.vision || config.vision;
export const siteService = (kind: ModelKind) => (kind === 'chat' ? config.llm : config[kind]);
export function readModelSettings(db: Store, owner: string, kind: ModelKind = 'chat') {
  return kind === 'chat'
    ? db.get<SettingsRow>('SELECT * FROM model_settings WHERE owner=?', owner)
    : db.get<SettingsRow>('SELECT * FROM service_model_settings WHERE owner=? AND kind=?', owner, kind);
}
let master: Buffer | undefined;
function masterKey() {
  if (master) return master;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const filename = path.join(config.dataDir, 'api-encryption.key');
  try {
    fs.writeFileSync(filename, randomBytes(32), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  master = fs.readFileSync(filename);
  if (master.length !== 32) throw new Error('Invalid API encryption key file');
  return master;
}
export function encryptSecret(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}
function decryptSecret(value: string) {
  if (!value) return '';
  const bytes = Buffer.from(value, 'base64'),
    decipher = createDecipheriv('aes-256-gcm', masterKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}
export function readableSecret(value: string) {
  try {
    return decryptSecret(value);
  } catch {
    return '';
  } // A missing/corrupt encryption file must not lock the owner out of settings.
}
export function settingsSummary(db: Store, owner: string, kind: ModelKind = 'chat') {
  const row = readModelSettings(db, owner, kind);
  const hasKey = Boolean(row?.secret && readableSecret(row.secret));
  return {
    mode: row?.mode || 'site',
    base: row?.base || '',
    model: row?.model || '',
    hasKey,
    siteConfigured: enabled(siteService(kind)),
    configured:
      row?.mode === 'personal' ? Boolean(row.base && row.model && hasKey) : enabled(siteService(kind)),
  };
}
export function ownerService(db: Store, owner: string, kind: ModelKind = 'chat'): ModelService {
  const row = readModelSettings(db, owner, kind);
  if (row?.mode !== 'personal') return siteService(kind);
  const key = readableSecret(row.secret);
  return { base: key ? row.base : '', model: row.model, key, personal: true };
}
export function withOwnerModel<T>(db: Store, owner: string, fn: () => T): T {
  return context.run(
    {
      chat: ownerService(db, owner),
      embedding: ownerService(db, owner, 'embedding'),
      vision: ownerService(db, owner, 'vision'),
    },
    fn,
  );
}
export function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  // Only global unicast IPv6; rejects mapped IPv4 and local/special ranges.
  return (
    isIP(address) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^2001:(?:0*:|db8:)/i.test(address) &&
    !/^2002:/i.test(address)
  );
}
export function normalizeBase(value: unknown, origin = config.publicOrigin) {
  if (typeof value !== 'string' || value.length > 500) throw new AppError(422, '请填写 API 服务地址。');
  let url: URL;
  try {
    url = new URL(value.trim(), origin || undefined);
  } catch {
    throw new AppError(422, '请填写完整 HTTPS 地址，或本站的反向代理路径。');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443')
  )
    throw new AppError(422, '个人 API 请使用 HTTPS 地址，不包含账号、查询参数或非标准端口。');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    (!hostname.includes('.') && !isIP(hostname)) ||
    (isIP(hostname) && !publicAddress(hostname))
  )
    throw new AppError(422, '个人 API 需要使用公开的 HTTPS 服务地址。');
  return url.href.replace(/\/+$/, '');
}
export function modelBase(value: string) {
  return value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(?:embeddings|chat\/completions)$/, '');
}
export async function modelFetch(service: ModelService, route: string, init: RequestInit) {
  const url = `${modelBase(service.base)}/${route}`;
  if (!service.personal) return fetch(url, { ...init, redirect: 'error' });
  const normalized = new URL(normalizeBase(service.base)),
    hostname = normalized.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address)))
    throw new AppError(422, 'API 地址解析到了非公开网络，请使用公开的 HTTPS 服务。');
  const pinned = addresses[0];
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [pinned]);
        else callback(null, pinned.address, pinned.family);
      },
    },
  });
  try {
    const response = await safeFetch(url, {
      method: init.method,
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
      signal: init.signal,
      redirect: 'error',
      dispatcher,
    });
    // Consume before closing the request-scoped dispatcher; never reuse a personal credential connection.
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' },
    });
  } finally {
    await dispatcher.close();
  }
}

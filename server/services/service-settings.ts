import type { Express, RequestHandler } from 'express';
import { createCanvas } from '@napi-rs/canvas';
import type { Store } from '../db.ts';
import { config, enabled } from '../config.ts';
import { AppError } from '../domain.ts';
import { embeddings, describePage } from './ai.ts';
import {
  encryptSecret,
  modelBase,
  normalizeBase,
  ownerService,
  readModelSettings,
  settingsSummary,
} from './model-settings.ts';

// Chat settings keep their existing API and table so deployed profiles remain compatible.
export function installServiceSettings(app: Express, db: Store, modelLimit: RequestHandler) {
  for (const kind of ['embedding', 'vision'] as const) {
    const endpoint = `/api/model-settings/${kind}`;
    const resetIndex = (owner: string, before: { base: string; model: string }) => {
      const after = ownerService(db, owner, kind);
      if (
        kind !== 'embedding' ||
        (modelBase(before.base) === modelBase(after.base) && before.model === after.model)
      )
        return 0;
      // Vectors from different models cannot be compared, even when their dimensions match.
      return Number(
        db.run(
          'UPDATE chunks SET embedding=NULL WHERE embedding IS NOT NULL AND document_id IN (SELECT id FROM documents WHERE owner=?)',
          owner,
        ).changes,
      );
    };
    app.get(endpoint, (req, res) => res.json(settingsSummary(db, req.owner, kind)));
    app.put(endpoint, (req, res) => {
      const { mode, base, model, key } = req.body;
      if (!['site', 'personal'].includes(mode)) throw new AppError(422, '请选择站点默认或个人 API。');
      const old = readModelSettings(db, req.owner, kind);
      const normalized = base
        ? modelBase(normalizeBase(base, config.publicOrigin || `${req.protocol}://${req.get('host')}`))
        : old?.base || '';
      const modelName = typeof model === 'string' ? model.trim() : old?.model || '';
      if (modelName.length > 160 || /[\r\n]/.test(modelName)) throw new AppError(422, '模型名称无效。');
      if (key != null && (typeof key !== 'string' || key.length > 4096 || /[\r\n]/.test(key)))
        throw new AppError(422, 'API Key 格式无效。');
      if (old?.secret && normalized !== old.base && !key?.trim())
        throw new AppError(422, '更换服务地址时，请重新填写对应的 API Key。');
      const secret = key?.trim() ? encryptSecret(key.trim()) : old?.secret || '';
      if (mode === 'personal' && (!normalized || !modelName || !secret))
        throw new AppError(422, '请填写服务地址、模型名称和 API Key。');
      const before = ownerService(db, req.owner, kind);
      const indexReset = db.transaction(() => {
        db.run(
          'INSERT INTO service_model_settings(owner,kind,mode,base,model,secret) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,kind) DO UPDATE SET mode=excluded.mode,base=excluded.base,model=excluded.model,secret=excluded.secret',
          req.owner,
          kind,
          mode,
          normalized,
          modelName,
          secret,
        );
        return resetIndex(req.owner, before);
      });
      res.json({ ...settingsSummary(db, req.owner, kind), indexReset });
    });
    app.delete(endpoint, (req, res) => {
      const before = ownerService(db, req.owner, kind);
      const indexReset = db.transaction(() => {
        db.run('DELETE FROM service_model_settings WHERE owner=? AND kind=?', req.owner, kind);
        return resetIndex(req.owner, before);
      });
      res.json({ ...settingsSummary(db, req.owner, kind), indexReset });
    });
    app.post(`${endpoint}/test`, modelLimit, async (req, res) => {
      const service = ownerService(db, req.owner, kind);
      if (!enabled(service)) throw new AppError(422, '请先保存完整的模型配置。');
      if (kind === 'embedding') {
        const vectors = await embeddings(['知屿连接测试'], service);
        res.json({ ok: true, dimensions: vectors![0].length });
      } else {
        const canvas = createCanvas(32, 32);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 32, 32);
        const result = await describePage(canvas.toBuffer('image/png'), service);
        if (!result?.trim()) throw new AppError(502, '视觉服务未返回识别结果，请确认模型支持图片输入。');
        res.json({ ok: true });
      }
    });
  }
}

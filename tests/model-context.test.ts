import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.ts';
import { config } from '../server/config.ts';
import {
  withOwnerModel,
  currentChatService,
  normalizeBase,
  publicAddress,
  modelFetch,
} from '../server/services/model-settings.ts';

test('并发异步任务保留各自模型上下文，后续站点任务不继承个人配置', async () => {
  const db = openDatabase(':memory:');
  try {
    for (const owner of ['a', 'b']) {
      db.run('INSERT INTO profiles VALUES(?,?,?)', owner, '{}', 'now');
      db.run(
        "INSERT INTO model_settings(owner,mode,base,model) VALUES(?,'personal',?,?)",
        owner,
        `https://${owner}.example.com/v1`,
        owner,
      );
    }
    const results = await Promise.all(
      ['a', 'b', 'a', 'b'].map((owner, index) =>
        withOwnerModel(db, owner, async () => {
          await new Promise((resolve) => setTimeout(resolve, (4 - index) * 5));
          return currentChatService().model;
        }),
      ),
    );
    assert.deepEqual(results, ['a', 'b', 'a', 'b']);
    assert.equal(currentChatService(), config.llm);
    assert.equal(
      withOwnerModel(db, 'site-owner', () => currentChatService()),
      config.llm,
    );
  } finally {
    db.close();
  }
});
test('个人网关地址支持本站 HTTPS 路径，拒绝内网、凭据、跳转和明文协议', async () => {
  assert.equal(
    normalizeBase('/model-api/v1', 'https://study.example.com'),
    'https://study.example.com/model-api/v1',
  );
  for (const value of [
    'http://example.com/v1',
    'https://127.0.0.1/v1',
    'https://10.0.0.1/v1',
    'https://[::1]/v1',
    'https://[::ffff:127.0.0.1]/v1',
    'https://localhost/v1',
    'https://user:pass@example.com/v1',
    'https://example.com/v1?token=secret',
  ])
    assert.throws(() => normalizeBase(value));
  for (const ip of [
    '10.0.0.1',
    '172.16.1.1',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
  ])
    assert.equal(publicAddress(ip), false);
  assert.equal(publicAddress('8.8.8.8'), true);
  await assert.rejects(
    () =>
      modelFetch(
        { base: 'https://127.0.0.1/v1', key: 'fixture', model: 'fixture', personal: true },
        'models',
        {},
      ),
    /公开/,
  );
});

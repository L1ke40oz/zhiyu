import { useEffect, useState } from 'react';
import { Button } from 'animal-island-ui';
import type { ModelSettings as Settings, ModelKind } from '../../shared/types';
import { api, post, messageOf } from '../api';
import { ErrorNote } from './Shared';

const descriptions = {
  chat: {
    title: '我的 AI 伙伴',
    intro: '默认使用站点提供的 AI，也可以带上自己的模型。个人设置用于共读问答、知识点整理与复习出题。',
    protocol: '兼容 OpenAI Chat Completions，例如 NewAPI。',
    placeholder: '填写服务商提供的模型 ID',
    unavailable: '站点 AI 尚未配置，目前仍可阅读课件、检索原文和进行原文小测。',
  },
  embedding: {
    title: 'Embedding 向量模型',
    intro: '用于资料建立索引和语义检索，找出意思相近的课件内容。可以使用自己的向量模型。',
    protocol: '兼容 OpenAI Embeddings，硅基流动填 https://api.siliconflow.cn/v1。',
    placeholder: '例如 BAAI/bge-m3',
    unavailable: '站点向量模型尚未配置，目前使用原文关键词检索。',
  },
  vision: {
    title: '视觉模型',
    intro: '用于识别课件图片，以及在共读中上传习题图片让 AI 解答。请使用支持图片输入的模型。',
    protocol: '兼容 OpenAI Chat Completions 的多模态图片消息。',
    placeholder: '填写支持图片输入的模型 ID',
    unavailable: '站点视觉模型尚未配置，配置后可上传习题图片。',
  },
};
export default function ModelSettings({
  active,
  onChanged,
  kind = 'chat',
}: {
  active: boolean;
  onChanged: () => void;
  kind?: ModelKind;
}) {
  const endpoint = kind === 'chat' ? '/model-settings' : `/model-settings/${kind}`;
  const copy = descriptions[kind];
  const [settings, setSettings] = useState<Settings | null>(null),
    [mode, setMode] = useState<'site' | 'personal'>('site');
  const [base, setBase] = useState(''),
    [model, setModel] = useState(''),
    [key, setKey] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  function apply(value: Settings) {
    setSettings(value);
    setMode(value.mode);
    setBase(value.base);
    setModel(value.model);
    setKey('');
  }
  useEffect(() => {
    if (!active) return;
    let live = true;
    api<Settings>(endpoint)
      .then((value) => {
        if (live) apply(value);
      })
      .catch((error) => {
        if (live) setError(messageOf(error));
      });
    return () => {
      live = false;
    };
  }, [active, endpoint]);
  return (
    <section className="model-settings preferences" aria-label={copy.title}>
      <div className="section-line">
        <h2>{copy.title}</h2>
        <span>{settings?.configured ? '已配置' : '待连接'}</span>
      </div>
      <p className="quiet-copy">{copy.intro}</p>
      <div className="segmented" aria-label="模型服务来源">
        <button
          className={mode === 'site' ? 'selected' : ''}
          onClick={() => {
            setMode('site');
            setNotice('');
          }}
        >
          站点默认
        </button>
        <button
          className={mode === 'personal' ? 'selected' : ''}
          onClick={() => {
            setMode('personal');
            setNotice('');
          }}
        >
          个人 API
        </button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          setNotice('');
          try {
            const saved = await api<Settings & { indexReset?: number }>(endpoint, {
              method: 'PUT',
              body: JSON.stringify({ mode, base, model, key }),
            });
            apply(saved);
            setNotice(
              (mode === 'site' ? '已切换到站点默认。' : '个人 API 已保存。') +
                (saved.indexReset
                  ? ' 已切换向量模型，请到课件共读点击「更新资料检索索引」；更新前仍可使用关键词检索。'
                  : ''),
            );
            onChanged();
          } catch (error) {
            setError(messageOf(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {mode === 'personal' ? (
          <div className="model-fields">
            <label>
              API 地址
              <input
                aria-label="API 地址"
                placeholder="https://api.example.com/v1"
                value={base}
                onChange={(event) => setBase(event.target.value)}
                required
                autoComplete="off"
                maxLength={500}
              />
            </label>
            <small>{copy.protocol} 填写基础地址（通常到 /v1），也支持本站 HTTPS 代理路径。</small>
            <label>
              模型名称
              <input
                aria-label="模型名称"
                placeholder={copy.placeholder}
                value={model}
                onChange={(event) => setModel(event.target.value)}
                required
                autoComplete="off"
                maxLength={160}
              />
            </label>
            <label>
              API Key
              <input
                aria-label="API Key"
                type="password"
                placeholder={settings?.hasKey ? '已保存，留空保留原 Key' : '只在这里填写，不会回显'}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                required={!settings?.hasKey}
                autoComplete="new-password"
                maxLength={4096}
              />
            </label>
            <small>Key 加密保存在服务器，只属于当前学习空间；更换 API 地址时需要重新填写。</small>
            {kind === 'embedding' ? (
              <small>更换向量模型后，请到课件共读逐份点击「更新资料检索索引」，无需重新上传课件。</small>
            ) : null}
          </div>
        ) : (
          <p className="model-site-note">
            {settings?.siteConfigured ? '站点默认模型已配置，可测试连接。' : copy.unavailable}
          </p>
        )}
        <ErrorNote>{error}</ErrorNote>
        {notice ? (
          <p className="success-note" role="status">
            {notice}
          </p>
        ) : null}
        <div className="model-buttons">
          <Button type="primary" htmlType="submit" size="small" loading={busy}>
            保存设置
          </Button>
          <button
            type="button"
            className="text-button"
            disabled={busy || !settings?.configured}
            onClick={async () => {
              setBusy(true);
              setError('');
              setNotice('');
              try {
                const result = await post<{ modelListed?: boolean; dimensions?: number }>(
                  `${endpoint}/test`,
                  {},
                );
                setNotice(
                  kind === 'embedding'
                    ? `向量请求成功，返回 ${result.dimensions} 维向量。`
                    : kind === 'vision'
                      ? '图片请求成功，视觉模型已返回识别结果。'
                      : result.modelListed
                        ? '连接成功，当前模型在可用列表中。'
                        : '已连接服务；模型列表未列出当前名称，请核对服务商配置。',
                );
              } catch (error) {
                setError(messageOf(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            测试已保存的连接
          </button>
          {settings?.hasKey ? (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const cleared = await api<Settings & { indexReset?: number }>(endpoint, {
                    method: 'DELETE',
                  });
                  apply(cleared);
                  setNotice(
                    '个人配置已清除，已恢复站点默认。' +
                      (cleared.indexReset ? ' 请在课件共读更新资料检索索引。' : ''),
                  );
                  onChanged();
                } catch (error) {
                  setError(messageOf(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              清除个人配置
            </button>
          ) : null}
        </div>
      </form>
      {kind !== 'chat' ? (
        <small className="quiet-copy">
          测试使用已保存的配置，会发送一次{kind === 'embedding' ? '短文本向量' : '小图片识别'}请求。
        </small>
      ) : null}
    </section>
  );
}

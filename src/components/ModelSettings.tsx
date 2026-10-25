import { useEffect, useState } from 'react';
import { Button } from 'animal-island-ui';
import type { ModelSettings as Settings } from '../../shared/types';
import { api, post, messageOf } from '../api';
import { ErrorNote } from './Shared';

export default function ModelSettings({ active, onChanged }: { active: boolean; onChanged: () => void }) {
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
    api<Settings>('/model-settings')
      .then((value) => {
        if (live) apply(value);
      })
      .catch((error) => {
        if (live) setError(messageOf(error));
      });
    return () => {
      live = false;
    };
  }, [active]);
  return (
    <section className="model-settings preferences">
      <div className="section-line">
        <h2>我的 AI 伙伴</h2>
        <span>{settings?.configured ? '已配置' : '待连接'}</span>
      </div>
      <p className="quiet-copy">
        默认使用站点提供的 AI，也可以带上自己的模型。个人设置用于共读问答、知识点整理与复习出题。
      </p>
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
            apply(
              await api<Settings>('/model-settings', {
                method: 'PUT',
                body: JSON.stringify({ mode, base, model, key }),
              }),
            );
            setNotice(mode === 'site' ? '已切换到站点默认 AI。' : '个人 API 已保存。');
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
            <small>
              兼容 OpenAI Chat Completions，例如 NewAPI。填写到 /v1，也支持已启用 HTTPS 的本站代理路径。
            </small>
            <label>
              模型名称
              <input
                aria-label="模型名称"
                placeholder="填写服务商提供的模型 ID"
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
            <small>
              Key 加密保存在服务器，只属于当前学习空间；更换 API 地址时需要重新填写。OCR
              与向量检索沿用站点配置。
            </small>
          </div>
        ) : (
          <p className="model-site-note">
            {settings?.siteConfigured
              ? '站点默认 AI 已就绪。'
              : '站点 AI 尚未配置，目前仍可阅读课件、检索原文和进行原文小测。'}
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
                const result = await post<{ modelListed: boolean }>('/model-settings/test', {});
                setNotice(
                  result.modelListed
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
                  apply(await api<Settings>('/model-settings', { method: 'DELETE' }));
                  setNotice('个人配置已清除，已恢复站点默认。');
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
    </section>
  );
}

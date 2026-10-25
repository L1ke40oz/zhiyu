import { useEffect, useState } from 'react';
import { api, messageOf } from '../api';
import { ErrorNote } from './Shared';

interface Settings {
  mode: 'site' | 'personal';
  hasKey: boolean;
  siteConfigured: boolean;
  configured: boolean;
}
export default function WebSearchSettings({ active }: { active: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null),
    [mode, setMode] = useState<'site' | 'personal'>('site');
  const [key, setKey] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!active) return;
    let live = true;
    api<Settings>('/web-settings')
      .then((value) => {
        if (live) {
          setSettings(value);
          setMode(value.mode);
        }
      })
      .catch((error) => {
        if (live) setError(messageOf(error));
      });
    return () => {
      live = false;
    };
  }, [active]);
  async function save(clear = false) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await api<Settings>(
        '/web-settings',
        clear ? { method: 'DELETE' } : { method: 'PUT', body: JSON.stringify({ mode, key }) },
      );
      setSettings(value);
      setMode(value.mode);
      setKey('');
      setNotice(clear ? '已清除个人 Key，恢复站点设置。' : '联网搜索设置已保存。');
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="web-search-settings">
      <h2>联网搜索</h2>
      <p>
        允许共读伙伴自主调用 Tavily 联网搜索，也可以直接说「帮我联网搜一下」。聊天会显示工具调用和网页来源。
      </p>
      <div className="segmented" aria-label="联网搜索来源">
        <button
          type="button"
          className={mode === 'site' ? 'selected' : ''}
          onClick={() => {
            setMode('site');
            setNotice('');
          }}
        >
          站点默认
        </button>
        <button
          type="button"
          className={mode === 'personal' ? 'selected' : ''}
          onClick={() => {
            setMode('personal');
            setNotice('');
          }}
        >
          我的 Tavily Key
        </button>
      </div>
      {mode === 'personal' ? (
        <label className="web-key-label">
          Tavily API Key
          <input
            type="password"
            autoComplete="off"
            aria-label="Tavily API Key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={settings?.hasKey ? '已保存，留空保留原 Key' : 'tvly-…'}
            maxLength={512}
          />
        </label>
      ) : (
        <p className="web-config-status">
          {settings?.siteConfigured
            ? '站点已配置 Tavily，可直接使用。'
            : '站点尚未配置，可以填写自己的 Tavily Key。'}
        </p>
      )}
      <ErrorNote>{error}</ErrorNote>
      {notice ? (
        <p className="success-note" role="status">
          {notice}
        </p>
      ) : null}
      <div className="web-settings-actions">
        <button type="button" className="mini-action" disabled={busy} onClick={() => void save()}>
          保存联网设置
        </button>
        {settings?.hasKey ? (
          <button
            type="button"
            className="text-button quiet-danger"
            disabled={busy}
            onClick={() => void save(true)}
          >
            清除个人 Key
          </button>
        ) : null}
      </div>
    </section>
  );
}

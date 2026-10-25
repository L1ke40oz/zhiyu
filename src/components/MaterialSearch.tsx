import { useEffect, useRef, useState } from 'react';
import type { SearchResult, Source } from '../../shared/types';
import { api, messageOf } from '../api';
import { ErrorNote } from './Shared';

export default function MaterialSearch({
  courseId,
  documentId,
  onSource,
}: {
  courseId: string;
  documentId: string;
  onSource: (source: Source) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const [scope, setScope] = useState('course'),
    [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    request.current?.abort();
    setResult(null);
    setError('');
    setBusy(false);
  }, [documentId, scope]);
  async function search() {
    if (!query.trim()) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setResult(null);
    const params = new URLSearchParams({ q: query.trim() });
    if (scope === 'document' && documentId) params.set('documentId', documentId);
    try {
      const data = await api<SearchResult>(`/courses/${courseId}/search?${params}`, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setResult(data);
    } catch (error) {
      if (!controller.signal.aborted) setError(messageOf(error));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="material-search" aria-label="资料检索">
      <button
        type="button"
        className="text-button material-search-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="2" />
          <path d="m10 10 4 4" stroke="currentColor" strokeWidth="2" />
        </svg>
        检索资料 <span>{open ? '收起' : '找原文、查页码'}</span>
      </button>
      {open ? (
        <div className="material-search-body">
          <form
            className="material-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <input
              aria-label="检索内容"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入概念、关键词或想找的问题…"
              maxLength={300}
              required
            />
            <select aria-label="检索范围" value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="course">当前课程全部资料</option>
              {documentId ? <option value="document">当前课件</option> : null}
            </select>
            <button type="submit" className="mini-action" disabled={busy || !query.trim()}>
              {busy ? '检索中…' : '检索'}
            </button>
          </form>
          <ErrorNote>{error}</ErrorNote>
          {result ? (
            <>
              <p className="search-summary">
                {result.mode === 'hybrid' ? '关键词 + 向量检索' : '关键词检索'} · 找到 {result.sources.length}{' '}
                个片段
              </p>
              {result.warning ? <p className="search-warning">{result.warning}</p> : null}
              {!result.sources.length ? (
                <p className="search-empty">没有找到匹配片段，试试换个关键词，或扩大检索范围。</p>
              ) : (
                <div className="search-results">
                  {result.sources.map((source) => (
                    <article className="search-result" key={source.id}>
                      <button type="button" className="text-button" onClick={() => onSource(source)}>
                        {source.documentName} · 第 {source.page} 页 ↗
                      </button>
                      <p>{source.text}</p>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="search-empty">
              直接查找当前课程的原文片段，不需要先问 AI。向量索引就绪时会结合语义检索。
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

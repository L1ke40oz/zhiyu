import { useEffect, useRef, useState } from 'react';
import { Button } from 'animal-island-ui';
import { ChatIcon } from 'naive-icons/icons/ChatIcon';
import { SendIcon } from 'naive-icons/icons/SendIcon';
import { BookmarkIcon } from 'naive-icons/icons/BookmarkIcon';
import { ChevronLeftIcon } from 'naive-icons/icons/ChevronLeftIcon';
import { ChevronRightIcon } from 'naive-icons/icons/ChevronRightIcon';
import type {
  Capabilities,
  ChatMessage,
  Course,
  DocumentPage,
  DocumentRecord,
  KnowledgePoint,
  Source,
  ReadingQuote,
  Highlight,
} from '../../shared/types';
import { api, post, messageOf, uid } from '../api';
import { useCourseDetail } from '../hooks';
import {
  PageHeading,
  CourseSelect,
  Empty,
  ErrorNote,
  UploadButton,
  UploadDropArea,
  statusText,
} from '../components/Shared';
import ReadingBubble from '../components/ReadingBubble';

function highlightedText(text: string, highlights: Highlight[], onSelect: (quote: Highlight) => void) {
  const spans = highlights
    .filter((item) => text.slice(item.start, item.end) === item.text)
    .sort((a, b) => a.start - b.start);
  const ranges: { start: number; end: number; quote: Highlight }[] = [];
  for (const item of spans) {
    const last = ranges.at(-1);
    if (last && item.start < last.end) last.end = Math.max(last.end, item.end);
    else ranges.push({ start: item.start, end: item.end, quote: item });
  }
  const merged = (range: { start: number; end: number; quote: Highlight }) => ({
    ...range.quote,
    start: range.start,
    end: range.end,
    text: text.slice(range.start, range.end),
  });
  let offset = 0;
  const nodes = [];
  for (const range of ranges) {
    nodes.push(text.slice(offset, range.start));
    nodes.push(
      <mark
        key={range.start}
        tabIndex={0}
        role="button"
        aria-label={`已划线：${text.slice(range.start, range.end)}`}
        onClick={() => onSelect(merged(range))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSelect(merged(range));
        }}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    offset = range.end;
  }
  nodes.push(text.slice(offset));
  return nodes;
}

export interface ReadingTarget {
  courseId: string;
  documentId?: string;
  page?: number;
  nonce: number;
}
export default function Reader({
  courses,
  capabilities,
  target,
  active,
  onCreate,
  onChanged,
  onQuiz,
}: {
  courses: Course[];
  capabilities: Capabilities;
  target: ReadingTarget | null;
  active: boolean;
  onCreate: () => void;
  onChanged: () => void;
  onQuiz: (point: KnowledgePoint) => void;
}) {
  const [courseId, setCourseId] = useState(''),
    [documentId, setDocumentId] = useState(''),
    [pages, setPages] = useState<DocumentPage[]>([]),
    [currentDoc, setCurrentDoc] = useState<DocumentRecord | null>(null);
  const [page, setPage] = useState(1),
    [mode, setMode] = useState<'document' | 'chat'>('document'),
    [view, setView] = useState<'original' | 'text'>('original');
  const [messages, setMessages] = useState<ChatMessage[]>([]),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [selection, setSelection] = useState<ReadingQuote | null>(null),
    [highlights, setHighlights] = useState<Highlight[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [noting, setNoting] = useState(false),
    [noteText, setNoteText] = useState(''),
    [notePointId, setNotePointId] = useState('');
  const { detail, error: detailError, refresh } = useCourseDetail(courseId || null);
  const readingRef = useRef<HTMLElement>(null),
    chatEnd = useRef<HTMLDivElement>(null),
    requestSerial = useRef(0),
    jumpPage = useRef<number | null>(null),
    positionReady = useRef(false);
  const draft = drafts[courseId] || '';
  const currentCourseRef = useRef(courseId);
  currentCourseRef.current = courseId;
  useEffect(() => {
    if (active && courseId) void refresh();
  }, [active, courseId, refresh]);
  useEffect(() => {
    if (!courses.some((course) => course.id === courseId)) setCourseId(courses[0]?.id || '');
  }, [courses, courseId]);
  useEffect(() => {
    if (!target) return;
    setCourseId(target.courseId);
    if (target.documentId) {
      setDocumentId(target.documentId);
      jumpPage.current = target.page || 1;
      if (target.documentId === documentId) {
        setPage(target.page || 1);
        jumpPage.current = null;
      }
    }
    setMode('document');
    clearSelection();
  }, [target]);
  useEffect(() => {
    if (!detail) return;
    if (!detail.documents.some((doc) => doc.id === documentId)) setDocumentId(detail.documents[0]?.id || '');
  }, [detail, documentId]);
  useEffect(() => {
    if (!courseId || !active) return;
    let live = true;
    api<ChatMessage[]>(`/courses/${courseId}/messages`)
      .then((data) => {
        if (live) setMessages(data);
      })
      .catch((error) => {
        if (live) setError(messageOf(error));
      });
    return () => {
      live = false;
    };
  }, [courseId, active]);
  const selectedStatus = detail?.documents.find((doc) => doc.id === documentId)?.status;
  useEffect(() => {
    const serial = ++requestSerial.current;
    positionReady.current = false;
    if (!documentId || !detail?.documents.some((doc) => doc.id === documentId)) {
      setCurrentDoc(null);
      setPages([]);
      return;
    }
    setError('');
    setHighlights([]);
    clearSelection();
    Promise.all([
      api<{ document: DocumentRecord; pages: DocumentPage[]; position: number }>(`/documents/${documentId}`),
      api<Highlight[]>(`/documents/${documentId}/highlights`),
    ])
      .then(([data, marks]) => {
        if (serial !== requestSerial.current) return;
        setCurrentDoc(data.document);
        setPages(data.pages);
        setHighlights(marks);
        setPage(Math.min(data.document.pageCount || 1, jumpPage.current || data.position));
        jumpPage.current = null;
        positionReady.current = true;
      })
      .catch((error) => {
        if (serial === requestSerial.current) setError(messageOf(error));
      });
  }, [documentId, selectedStatus]);
  useEffect(() => {
    if (!documentId || !pages.length || !positionReady.current) return;
    const timer = setTimeout(() => {
      void api(`/documents/${documentId}/position`, { method: 'PUT', body: JSON.stringify({ page }) }).catch(
        () => {},
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [documentId, page, pages.length]);
  useEffect(() => {
    const viewport = chatEnd.current?.parentElement;
    if (mode === 'chat' && viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [messages, mode]);
  const currentPage = pages.find((item) => item.number === page);
  // only PDFs and images have rendered page pictures (text and PPTX do not)
  const hasOriginal =
    Boolean(currentDoc && (currentDoc.mime === 'application/pdf' || currentDoc.mime.startsWith('image/'))) &&
    Boolean(currentPage);
  const point = detail?.points.find((point) => point.sourceChunkIds.length) || null;
  const selectionSource = useRef<'text' | 'mark' | null>(null);
  const [chip, setChip] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const clearSelection = () => {
    selectionSource.current = null;
    setSelection(null);
    setChip(null);
    window.getSelection()?.removeAllRanges();
  };
  const pickMark = (quote: ReadingQuote | null) => {
    selectionSource.current = quote ? 'mark' : null;
    setChip(null);
    setSelection(quote);
  };
  const selectText = () => {
    const selected = window.getSelection(),
      root = readingRef.current?.querySelector('.document-text');
    const valid =
      selected?.rangeCount &&
      root &&
      selected.toString().trim() &&
      root.contains(selected.getRangeAt(0).startContainer) &&
      root.contains(selected.getRangeAt(0).endContainer);
    if (!valid) {
      // Deselecting inside the page hides the tools; focusing the question box keeps the quote.
      const typing = document.activeElement?.matches('input, textarea, select');
      if (selectionSource.current === 'text' && !typing) {
        selectionSource.current = null;
        setSelection(null);
        setChip(null);
      }
      return;
    }
    const range = selected.getRangeAt(0);
    const prefix = range.cloneRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(range.startContainer, range.startOffset);
    const raw = range.toString(),
      start = prefix.toString().length + (raw.length - raw.trimStart().length),
      text = raw.trim().slice(0, 1200);
    selectionSource.current = 'text';
    setSelection({ documentId, page, start, end: start + text.length, text });
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
    const first = rects[0] || range.getBoundingClientRect(),
      last = rects[rects.length - 1] || first;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    // Touch devices show their own menu above the selection, so the chip goes below it.
    const anchor = coarse ? last : first;
    setChip({
      x: Math.min(
        window.innerWidth - 90,
        Math.max(90, anchor.left + (coarse ? anchor.width : first.width) / 2),
      ),
      y: coarse ? anchor.bottom + 10 : Math.max(8, anchor.top - 46),
      below: coarse,
    });
  };
  useEffect(() => {
    if (!active) return;
    const listener = () => {
      window.setTimeout(selectText, 0);
    };
    const onScroll = () => {
      if (selectionSource.current === 'text') selectText();
    };
    document.addEventListener('selectionchange', listener);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('selectionchange', listener);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
    };
  }, [active, documentId, page]);
  useEffect(() => {
    if (!active) setChip(null);
  }, [active]);
  async function reloadHighlights(docId = documentId) {
    const marks = await api<Highlight[]>(`/documents/${docId}/highlights`);
    if (docId === documentId) setHighlights(marks);
  }
  async function saveHighlight() {
    if (!selection) return;
    await post<Highlight>(`/documents/${selection.documentId}/highlights`, selection);
    window.getSelection()?.removeAllRanges();
    await reloadHighlights(selection.documentId);
  }
  // marks touched by the current selection; any overlap counts
  const overlapping = selection
    ? highlights.filter(
        (item) =>
          item.documentId === selection.documentId &&
          item.page === selection.page &&
          item.start < selection.end &&
          item.end > selection.start,
      )
    : [];
  const covered = Boolean(
    selection && overlapping.some((item) => item.start <= selection.start && item.end >= selection.end),
  );
  async function highlightOnly() {
    try {
      await saveHighlight();
      setNotice(overlapping.length ? '划线已扩展。' : '划线已保存，点击标记可以继续提问。');
      clearSelection();
    } catch (error) {
      setError(messageOf(error));
    }
  }
  async function askAboutSelection() {
    const quote = selection;
    if (!quote) return;
    try {
      if (!covered) await saveHighlight();
      setChip(null);
      setMode('chat');
      void ask('请解释我划线的这段内容，指出关键概念和容易混淆的地方。', quote);
    } catch (error) {
      setError(messageOf(error));
    }
  }
  async function removeMarks() {
    if (!selection) return;
    const { documentId: docId, page: markPage, start, end } = selection;
    try {
      await api(`/documents/${docId}/highlights?page=${markPage}&start=${start}&end=${end}`, {
        method: 'DELETE',
      });
      clearSelection();
      await reloadHighlights(docId);
      setNotice('划线已取消。');
    } catch (error) {
      setError(messageOf(error));
    }
  }
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => setConfirmRemove(false), [documentId]);
  async function removeDocument() {
    const name = currentDoc?.name || '这份课件';
    setBusy(true);
    setError('');
    try {
      await api(`/documents/${documentId}`, { method: 'DELETE' });
      clearSelection();
      setDocumentId('');
      setConfirmRemove(false);
      setNotice(`「${name}」已删除。`);
      await refresh();
      onChanged();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  async function reprocessDocument() {
    setBusy(true);
    setError('');
    try {
      await post(`/documents/${documentId}/reprocess`, {});
      clearSelection();
      setNotice('正在按最新规则重新整理，学习进度会保留，划线会按原句重新定位。');
      await refresh();
      onChanged();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  async function ask(question = draft, quote = selection) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    const requestedCourse = courseId;
    try {
      await post(`/courses/${courseId}/ask`, {
        question: question.slice(0, 1500),
        quote,
        documentId: documentId || null,
        page: currentPage ? page : null,
      });
      const data = await api<ChatMessage[]>(`/courses/${requestedCourse}/messages`);
      if (requestedCourse === currentCourseRef.current) {
        setMessages(data);
        setDrafts((old) => ({ ...old, [requestedCourse]: '' }));
        clearSelection();
      }
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  function jump(source: Source) {
    setDocumentId(source.documentId);
    if (documentId === source.documentId) setPage(source.page);
    else jumpPage.current = source.page;
    setMode('document');
  }
  return (
    <main className="feature-page reader-page">
      <PageHeading title="课件共读" subtitle="一起读，也一起把不懂的地方想明白。" />
      {!courses.length ? (
        <Empty title="先选一门想一起学的课">
          创建课程岛后，就能把课件带到这里。
          <span className="empty-inline-action">
            <Button type="primary" onClick={onCreate}>
              新建课程岛
            </Button>
          </span>
        </Empty>
      ) : (
        <UploadDropArea
          courseId={courseId}
          onUploaded={(doc) => {
            setDocumentId(doc.id);
            void refresh();
            onChanged();
          }}
        >
          <div className="reader-toolbar">
            <CourseSelect
              courses={courses}
              value={courseId}
              onChange={(value) => {
                setCourseId(value);
                setDocumentId('');
                setMessages([]);
                clearSelection();
                setError('');
              }}
            />
            <UploadButton
              compact
              courseId={courseId}
              onUploaded={(doc) => {
                setDocumentId(doc.id);
                void refresh();
                onChanged();
              }}
            />
          </div>
          {detail?.documents.length ? (
            <>
              <div className="document-bar">
                <select
                  className="document-select"
                  aria-label="选择课件"
                  value={documentId}
                  onChange={(event) => {
                    setDocumentId(event.target.value);
                    clearSelection();
                  }}
                >
                  {detail.documents.map((doc) => (
                    <option value={doc.id} key={doc.id}>
                      {doc.name} · {statusText[doc.status]}
                    </option>
                  ))}
                </select>
                {documentId && !['uploaded', 'parsing', 'indexing'].includes(selectedStatus || '') ? (
                  confirmRemove ? (
                    <span className="confirm-inline">
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={() => void removeDocument()}
                      >
                        确认删除
                      </button>
                      <button className="text-button" onClick={() => setConfirmRemove(false)}>
                        取消
                      </button>
                    </span>
                  ) : (
                    <span className="document-actions">
                      <button
                        className="text-button"
                        disabled={busy}
                        title="按最新的清洗规则重新提取文字；学习进度保留，划线会按原句重新定位"
                        onClick={() => void reprocessDocument()}
                      >
                        重新整理
                      </button>
                      <button className="text-button quiet-danger" onClick={() => setConfirmRemove(true)}>
                        删除
                      </button>
                    </span>
                  )
                ) : null}
              </div>
              {capabilities.embeddings && pages.length ? (
                <button
                  className="text-button reindex-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await post(`/documents/${documentId}/reindex`, {});
                      setNotice('这份资料的检索索引已更新。');
                    } catch (error) {
                      setError(messageOf(error));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  更新资料检索索引
                </button>
              ) : null}
            </>
          ) : null}
          <ErrorNote>{error || detailError}</ErrorNote>
          {notice ? (
            <p className="success-note" role="status">
              {notice}
            </p>
          ) : null}
          {!detail?.documents.length ? (
            <div className="reader-empty-upload">
              <Empty title="把第一份课件带来">PDF、PPTX、清晰图片或 UTF-8 文本都可以。</Empty>
              {courseId ? (
                <UploadDropArea
                  courseId={courseId}
                  box
                  large
                  onUploaded={(doc) => {
                    setDocumentId(doc.id);
                    void refresh();
                    onChanged();
                  }}
                />
              ) : null}
            </div>
          ) : (
            <>
              <p className="reading-tip">
                选中课件文字可以划线，点右下角气泡随时提问。
                {hasOriginal && view === 'original' ? ' 划线请先切换到「查看文字」。' : ''}
              </p>
              <div className="reading-workspace bubble-workspace">
                <section className="document-pane" aria-label="课件阅读区域">
                  {currentPage ? (
                    <>
                      <div className="document-controls">
                        <button
                          className="icon-button"
                          aria-label="上一页"
                          disabled={page <= 1}
                          onClick={() => {
                            setPage((value) => value - 1);
                            clearSelection();
                          }}
                        >
                          <ChevronLeftIcon size={21} />
                        </button>
                        <span>
                          第 {page} / {pages.length} 页
                        </span>
                        <button
                          className="icon-button"
                          aria-label="下一页"
                          disabled={page >= pages.length}
                          onClick={() => {
                            setPage((value) => value + 1);
                            clearSelection();
                          }}
                        >
                          <ChevronRightIcon size={21} />
                        </button>
                        {hasOriginal ? (
                          <button
                            className="text-button"
                            onClick={() => setView((value) => (value === 'original' ? 'text' : 'original'))}
                          >
                            {view === 'original' ? '查看文字' : '查看原图'}
                          </button>
                        ) : null}
                      </div>
                      {currentPage.warning ? <p className="recognition-note">{currentPage.warning}</p> : null}
                      <article
                        className="page-paper"
                        ref={readingRef}
                        onMouseUp={selectText}
                        onTouchEnd={() => {
                          setTimeout(selectText, 200);
                        }}
                      >
                        {hasOriginal && view === 'original' ? (
                          <img
                            src={`/api/documents/${documentId}/pages/${page}/image`}
                            alt={`${currentDoc?.name} 第 ${page} 页原图`}
                          />
                        ) : currentPage.text ? (
                          <div className="document-text">
                            {highlightedText(
                              currentPage.text,
                              highlights.filter((item) => item.page === page),
                              pickMark,
                            )}
                          </div>
                        ) : (
                          <p>本页暂未识别出可用文字，请查看原图。</p>
                        )}
                      </article>
                      {selection && active ? (
                        <div
                          className="selection-note selection-bar"
                          role="toolbar"
                          aria-label="划线工具"
                          onMouseDown={(event) => event.preventDefault()}
                        >
                          <span>
                            已选：{selection.text.slice(0, 90)}
                            {selection.text.length > 90 ? '…' : ''}
                          </span>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => void askAboutSelection()}
                          >
                            划线并问 AI
                          </button>
                          {overlapping.length ? (
                            <button className="text-button" onClick={() => void removeMarks()}>
                              取消划线
                            </button>
                          ) : null}
                          {!covered ? (
                            <button className="text-button" onClick={() => void highlightOnly()}>
                              {overlapping.length ? '扩展划线' : '只划线'}
                            </button>
                          ) : null}
                          <button className="text-button" onClick={clearSelection}>
                            取消
                          </button>
                        </div>
                      ) : null}
                      {selection && chip && active ? (
                        <div
                          className={`selection-chip ${chip.below ? 'below' : ''}`}
                          style={{ left: chip.x, top: chip.y }}
                          onMouseDown={(event) => event.preventDefault()}
                        >
                          {overlapping.length ? (
                            <button onClick={() => void removeMarks()} aria-label="取消划线">
                              <i className="chip-pen off" />
                              取消划线
                            </button>
                          ) : (
                            <button onClick={() => void highlightOnly()} aria-label="划线">
                              <i className="chip-pen" />
                              划线
                            </button>
                          )}
                          <button
                            onClick={() => void askAboutSelection()}
                            disabled={busy}
                            aria-label="划线并问 AI"
                          >
                            问 AI
                          </button>
                        </div>
                      ) : null}
                      <div className="reading-actions">
                        <Button
                          size="small"
                          icon={<BookmarkIcon size={17} />}
                          onClick={() => {
                            setNoting(!noting);
                            setNoteText(selection?.text || `第 ${page} 页：`);
                            setNotePointId('');
                          }}
                        >
                          这里不懂
                        </Button>
                        {point ? (
                          <button className="text-button" onClick={() => onQuiz(point)}>
                            做道小测
                          </button>
                        ) : null}
                      </div>
                      {noting ? (
                        <form
                          className="stuck-form reading-note-form"
                          onSubmit={async (event) => {
                            event.preventDefault();
                            setBusy(true);
                            setError('');
                            try {
                              await post(`/courses/${courseId}/stuck`, {
                                text: noteText,
                                pointId: notePointId || null,
                                documentId,
                                page,
                              });
                              setNoting(false);
                              setNotice('卡点已记下，并放进了这门课的知识图谱。');
                              await refresh();
                              onChanged();
                            } catch (error) {
                              setError(messageOf(error));
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          <textarea
                            aria-label="记下课件卡点"
                            placeholder="这里为什么……？"
                            maxLength={1000}
                            required
                            value={noteText}
                            onChange={(event) => setNoteText(event.target.value)}
                          />
                          <select
                            aria-label="卡点关联知识点"
                            value={notePointId}
                            onChange={(event) => setNotePointId(event.target.value)}
                          >
                            <option value="">先记录，稍后再关联知识点</option>
                            {detail?.points.map((point) => (
                              <option key={point.id} value={point.id}>
                                {point.title}
                              </option>
                            ))}
                          </select>
                          <div>
                            <Button htmlType="submit" type="primary" size="small" loading={busy}>
                              记下来
                            </Button>
                            <button type="button" className="text-button" onClick={() => setNoting(false)}>
                              取消
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </>
                  ) : (
                    <div className="reading-processing">
                      <span className="loading-leaf" />
                      <h3>{currentDoc ? statusText[currentDoc.status] : '正在读取资料'}</h3>
                      <p>{currentDoc?.error || '资料整理完成后，会在这里展示页面与来源。'}</p>
                      {currentDoc?.status === 'failed' ? (
                        <Button
                          onClick={async () => {
                            try {
                              await post(`/documents/${documentId}/retry`, {});
                              await refresh();
                            } catch (error) {
                              setError(messageOf(error));
                            }
                          }}
                        >
                          重新处理
                        </Button>
                      ) : null}
                    </div>
                  )}
                </section>
                <ReadingBubble
                  open={mode === 'chat'}
                  onToggle={() => setMode((old) => (old === 'chat' ? 'document' : 'chat'))}
                >
                  <section className="chat-pane" aria-label="共读问答区域">
                    <div className="chat-capability">
                      <span className="live-dot" />
                      {capabilities.chat ? 'AI 共读伙伴' : '原文检索已就绪'}
                      <small>{capabilities.chat ? '回答会标明资料依据' : '连接 AI 后可获得进一步讲解'}</small>
                    </div>
                    <ErrorNote>{error}</ErrorNote>
                    <div className="chat-messages">
                      {!messages.length ? (
                        <div className="chat-welcome">
                          <ChatIcon size={35} />
                          <h3>不懂的地方，可以慢慢问。</h3>
                          <p>
                            {capabilities.chat
                              ? '试着问一个概念，或者选中一段课件一起讨论。'
                              : '先输入资料中的关键词，看看相关原文。AI 服务稍后可由项目配置启用。'}
                          </p>
                          {currentPage?.text ? (
                            <button
                              className="suggestion"
                              onClick={() =>
                                setDrafts((old) => ({
                                  ...old,
                                  [courseId]:
                                    currentPage.text
                                      .split(/[\n。]/)
                                      .find((value) => value.trim().length > 3)
                                      ?.slice(0, 45) || '这页讲了什么？',
                                }))
                              }
                            >
                              从当前页开始
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        messages.map((message) =>
                          message.role === 'user' ? (
                            <div className="user-message" key={message.id}>
                              {message.text}
                            </div>
                          ) : (
                            <article className="assistant-message" key={message.id}>
                              <div className="assistant-caption">
                                <span className="tiny-leaf" />
                                {message.mode === 'extractive' ? '找到这些资料摘录' : '一起看看'}
                              </div>
                              {message.sections.map((section, index) => (
                                <div className="answer-section" key={index}>
                                  <span className={`basis-label ${section.basis}`}>
                                    {section.basis === 'course_material' ? '课程资料' : '通用补充 · 请核实'}
                                  </span>
                                  <p>{section.text}</p>
                                  {section.sourceChunkIds.map((sourceId) => {
                                    const source = message.sources.find((source) => source.id === sourceId);
                                    return source ? (
                                      <button
                                        className="source-link"
                                        key={sourceId}
                                        onClick={() => jump(source)}
                                      >
                                        {source.documentName} · 第 {source.page} 页
                                      </button>
                                    ) : null;
                                  })}
                                </div>
                              ))}
                            </article>
                          ),
                        )
                      )}
                      {busy ? (
                        <div className="thinking" role="status">
                          <i />
                          <i />
                          <i />
                          <span>正在查找资料…</span>
                        </div>
                      ) : null}
                      <div ref={chatEnd} />
                    </div>
                    <form
                      className="chat-composer"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void ask();
                      }}
                    >
                      {selection ? (
                        <div className="quoted-selection">
                          第 {selection.page} 页：{selection.text.slice(0, 80)}
                          <button className="text-button" type="button" onClick={clearSelection}>
                            取消
                          </button>
                        </div>
                      ) : null}
                      <textarea
                        aria-label="向共读伙伴提问"
                        value={draft}
                        onChange={(event) => setDrafts((old) => ({ ...old, [courseId]: event.target.value }))}
                        maxLength={1000}
                        placeholder="问一个概念，或说说你卡在哪里…"
                        rows={2}
                      />
                      <button
                        className="send-button"
                        aria-label="发送问题"
                        disabled={!draft.trim() || busy || !pages.length}
                      >
                        <SendIcon size={21} />
                      </button>
                    </form>
                    {messages.length ? (
                      <button
                        className="complete-reading text-button"
                        onClick={async () => {
                          try {
                            await post(`/courses/${courseId}/reading-complete`, { sessionId: uid() });
                            setNotice('这次共读已记录，去个人中心看看足迹吧。');
                            onChanged();
                          } catch (error) {
                            setError(messageOf(error));
                          }
                        }}
                      >
                        记录这次共读
                      </button>
                    ) : null}
                  </section>
                </ReadingBubble>
              </div>
            </>
          )}
        </UploadDropArea>
      )}
    </main>
  );
}

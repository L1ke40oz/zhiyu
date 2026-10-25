import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from 'animal-island-ui';
import type { ChatMessage, ReadingSession, Source } from '../../shared/types';
import { api, post, messageOf } from '../api';
import { Empty, ErrorNote, Sheet } from './Shared';
import ChatMessages from './ChatMessages';

export default function ReadingSessions({
  courseId,
  messages,
  busy,
  onFinished,
  onSource,
}: {
  courseId: string;
  messages: ChatMessage[];
  busy: boolean;
  onFinished: (saved: boolean) => void;
  onSource: (source: Source) => void;
}) {
  const [dialog, setDialog] = useState<'finish' | 'history' | null>(null);
  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [selected, setSelected] = useState<ReadingSession | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    if (dialog !== 'history') return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const endpoint = `/courses/${courseId}/reading-sessions${selected ? `/${selected.id}` : ''}`;
    api<ReadingSession[] | ChatMessage[]>(endpoint, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (selected) setHistory(data as ChatMessage[]);
        else setSessions(data as ReadingSession[]);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(messageOf(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [courseId, dialog, selected]);
  function open(value: 'finish' | 'history') {
    setSelected(null);
    setHistory([]);
    setError('');
    setDialog(value);
  }
  async function finish(action: 'save' | 'discard') {
    setSaving(true);
    setError('');
    try {
      await post(`/courses/${courseId}/reading-sessions`, { action, lastMessageId: messages.at(-1)?.id });
      setDialog(null);
      setNotice(
        action === 'save' ? '已保存到历史共读，新的会话开始啦。' : '本次聊天已删除，新的会话开始啦。',
      );
      onFinished(action === 'save');
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      {notice && !messages.length ? (
        <p className="reading-session-notice" role="status">
          {notice}
        </p>
      ) : null}
      <div className="reading-session-actions">
        {messages.length ? (
          <button className="text-button" disabled={busy || saving} onClick={() => open('finish')}>
            记录这次共读
          </button>
        ) : (
          <small>当前会话</small>
        )}
        <button className="text-button" onClick={() => open('history')}>
          历史共读
        </button>
      </div>
      {dialog === 'finish'
        ? createPortal(
            <Sheet
              title="收好这次共读"
              className="reading-finish-sheet"
              onClose={() => {
                if (!saving) setDialog(null);
              }}
            >
              <div className="reading-session-body">
                <p>要把这次聊天收进历史共读吗？保存后会清空当前窗口，开始一段新的对话。</p>
                <p className="quiet-copy">图片、课件引用和工具记录一起保存，之后可从「历史共读」查看。</p>
                <ErrorNote>{error}</ErrorNote>
                <div className="reading-finish-actions">
                  <Button
                    type="primary"
                    loading={saving}
                    disabled={saving}
                    onClick={() => void finish('save')}
                  >
                    保存并新开会话
                  </Button>
                  <button
                    className="text-button quiet-danger"
                    disabled={saving}
                    onClick={() => void finish('discard')}
                  >
                    不保留，直接删除
                  </button>
                  <button className="text-button" disabled={saving} onClick={() => setDialog(null)}>
                    取消，继续聊天
                  </button>
                </div>
              </div>
            </Sheet>,
            document.body,
          )
        : null}
      {dialog === 'history'
        ? createPortal(
            <Sheet
              title={selected ? selected.title : '历史共读'}
              className="reading-history-sheet"
              onClose={() => setDialog(null)}
            >
              <div className="reading-session-body">
                {selected ? (
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelected(null);
                      setHistory([]);
                    }}
                  >
                    返回会话列表
                  </button>
                ) : (
                  <p className="quiet-copy">这里保存着这门课已经收好的对话，当前会话会继续保留在聊天窗口。</p>
                )}
                <ErrorNote>{error}</ErrorNote>
                {loading ? (
                  <p role="status">正在翻开共读记录…</p>
                ) : selected ? (
                  <div className="chat-messages history-messages">
                    <ChatMessages
                      messages={history}
                      onSource={(source) => {
                        onSource(source);
                        setDialog(null);
                      }}
                    />
                  </div>
                ) : sessions.length ? (
                  <div className="reading-history-list">
                    {sessions.map((session) => (
                      <button
                        className="reading-history-item"
                        key={session.id}
                        onClick={() => {
                          setHistory([]);
                          setSelected(session);
                        }}
                      >
                        <strong>{session.title}</strong>
                        <span>
                          {new Date(session.createdAt).toLocaleString('zh-CN', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          · {session.messageCount} 条消息
                        </span>
                      </button>
                    ))}
                  </div>
                ) : !error ? (
                  <Empty title="还没有收好的共读">聊完后点「记录这次共读」，就能把对话留在这里。</Empty>
                ) : null}
              </div>
            </Sheet>,
            document.body,
          )
        : null}
    </>
  );
}

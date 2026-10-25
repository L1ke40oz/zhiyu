import { useState } from 'react';
import { Button, Input } from 'animal-island-ui';
import { BookIcon } from 'naive-icons/icons/BookIcon';
import { LeafIcon } from 'naive-icons/icons/LeafIcon';
import { PlusIcon } from 'naive-icons/icons/PlusIcon';
import { useCourseDetail } from '../hooks';
import { api, patch, post, messageOf } from '../api';
import { Sheet, UploadButton, UploadDropArea, ErrorNote, Empty, statusText, dayLabel } from './Shared';
import type { KnowledgePoint } from '../../shared/types';
import KnowledgeGraph from './KnowledgeGraph';

export default function CourseSheet({
  courseId,
  onClose,
  onRead,
  onQuiz,
  onChanged,
  onDeleted,
}: {
  onDeleted: (name: string) => void;
  courseId: string;
  onClose: () => void;
  onRead: (courseId: string, documentId?: string) => void;
  onQuiz: (point: KnowledgePoint) => void;
  onChanged: () => void;
}) {
  const { detail, error, refresh } = useCourseDetail(courseId);
  const [note, setNote] = useState(''),
    [pointId, setPointId] = useState(''),
    [saving, setSaving] = useState(false),
    [localError, setLocalError] = useState(''),
    [adding, setAdding] = useState(false),
    [editingPoint, setEditingPoint] = useState<string | null>(null),
    [pointTitle, setPointTitle] = useState(''),
    [confirmDoc, setConfirmDoc] = useState<string | null>(null),
    [confirmCourse, setConfirmCourse] = useState(false),
    [removing, setRemoving] = useState(false),
    [tab, setTab] = useState<'materials' | 'graph'>('materials'),
    [notice, setNotice] = useState('');
  const openStuck = detail?.stuck.filter((note) => !note.resolved) || [];
  const graphCount =
    (detail?.points.filter((point) => point.unfamiliar || openStuck.some((note) => note.pointId === point.id))
      .length || 0) +
    openStuck.filter((note) => !note.pointId || !detail?.points.some((point) => point.id === note.pointId))
      .length;
  async function resolveStuck(id: string) {
    try {
      await patch(`/stuck/${id}`, { resolved: true });
      await changed();
    } catch (error) {
      setLocalError(messageOf(error));
    }
  }
  /** "already familiar": unflag the point and close its open stuck notes */
  async function unmarkPoint(point: KnowledgePoint) {
    try {
      await patch(`/points/${point.id}`, { unfamiliar: false });
      for (const note of detail?.stuck.filter((item) => item.pointId === point.id && !item.resolved) || [])
        await patch(`/stuck/${note.id}`, { resolved: true });
      await changed();
    } catch (error) {
      setLocalError(messageOf(error));
    }
  }
  async function markUnfamiliar(point: KnowledgePoint, unfamiliar: boolean) {
    try {
      await patch(`/points/${point.id}`, { unfamiliar });
      await refresh();
    } catch (error) {
      setLocalError(messageOf(error));
    }
  }
  const changed = async () => {
    await refresh();
    onChanged();
  };
  return (
    <Sheet title={detail?.course.name || '课程小岛'} onClose={onClose} className="course-sheet">
      <div className="sheet-content course-sheet-content">
        <ErrorNote>{error || localError}</ErrorNote>
        {detail ? (
          <>
            <div className="sheet-tabs" role="tablist" aria-label="课程视图">
              <button
                role="tab"
                aria-selected={tab === 'materials'}
                className={tab === 'materials' ? 'active' : ''}
                onClick={() => setTab('materials')}
              >
                课程资料
              </button>
              <button
                role="tab"
                aria-selected={tab === 'graph'}
                className={tab === 'graph' ? 'active' : ''}
                onClick={() => setTab('graph')}
              >
                知识图谱
                {graphCount ? <em>{graphCount}</em> : null}
              </button>
            </div>
            <div
              className="course-tab-panel"
              role="tabpanel"
              aria-label={tab === 'graph' ? '知识图谱' : '课程资料'}
              key={tab}
            >
              {tab === 'graph' ? (
                <KnowledgeGraph
                  courseName={detail.course.name}
                  palette={detail.course.palette}
                  points={detail.points}
                  stuck={detail.stuck}
                  onQuiz={onQuiz}
                  onUnmark={(point) => void unmarkPoint(point)}
                  onResolve={(note) => void resolveStuck(note.id)}
                />
              ) : (
                <>
                  <div className="course-summary">
                    <span>
                      <b>{detail.points.length}</b> 个知识点
                    </span>
                    <span>
                      <b>{detail.course.masteredCount}</b> 个已掌握知识点
                    </span>
                    <span>
                      <b>{detail.course.stuckCount}</b> 个卡点
                    </span>
                  </div>
                  <label className="exam-field">
                    考试日期
                    <input
                      type="date"
                      aria-label="考试日期"
                      value={detail.course.examDate || ''}
                      onChange={async (event) => {
                        try {
                          await patch(`/courses/${courseId}`, { examDate: event.target.value || null });
                          await changed();
                        } catch (error) {
                          setLocalError(messageOf(error));
                        }
                      }}
                    />
                  </label>
                  <section className="content-section">
                    <UploadDropArea
                      courseId={courseId}
                      onUploaded={() => {
                        void changed();
                      }}
                      box
                    >
                      <div className="section-line">
                        <h3>
                          <BookIcon size={19} /> 课程资料
                        </h3>
                        <UploadButton
                          compact
                          courseId={courseId}
                          onUploaded={() => {
                            void changed();
                          }}
                        />
                      </div>
                      {notice ? (
                        <p className="sheet-notice" role="status">
                          {notice}
                        </p>
                      ) : null}
                      {!detail.documents.length ? (
                        <p className="quiet-copy">上传第一份课件，开始建设这座岛。</p>
                      ) : (
                        <div className="document-list">
                          {detail.documents.map((doc) => (
                            <div key={doc.id} className="document-row">
                              <button className="row-main" onClick={() => onRead(courseId, doc.id)}>
                                <span className="document-glyph">
                                  <BookIcon size={19} />
                                </span>
                                <span>
                                  <b>{doc.name}</b>
                                  <small>
                                    {statusText[doc.status]}
                                    {['parsing', 'indexing'].includes(doc.status)
                                      ? ` ${doc.progress}%`
                                      : doc.pageCount
                                        ? ` · ${doc.pageCount} 页`
                                        : ''}
                                  </small>
                                </span>
                              </button>
                              {confirmDoc === doc.id ? (
                                <span className="confirm-inline">
                                  <button
                                    className="text-button danger"
                                    disabled={removing}
                                    onClick={async () => {
                                      setRemoving(true);
                                      setLocalError('');
                                      try {
                                        await api(`/documents/${doc.id}`, { method: 'DELETE' });
                                        setConfirmDoc(null);
                                        await changed();
                                      } catch (error) {
                                        setLocalError(messageOf(error));
                                      } finally {
                                        setRemoving(false);
                                      }
                                    }}
                                  >
                                    确认删除
                                  </button>
                                  <button className="text-button" onClick={() => setConfirmDoc(null)}>
                                    取消
                                  </button>
                                </span>
                              ) : (
                                <button
                                  className="text-button quiet-danger"
                                  aria-label={`删除资料 ${doc.name}`}
                                  disabled={['parsing', 'indexing'].includes(doc.status)}
                                  title={
                                    ['parsing', 'indexing'].includes(doc.status)
                                      ? '整理完成后才能删除'
                                      : undefined
                                  }
                                  onClick={() => setConfirmDoc(doc.id)}
                                >
                                  删除
                                </button>
                              )}
                              {!['uploaded', 'parsing', 'indexing'].includes(doc.status) &&
                              confirmDoc !== doc.id ? (
                                <button
                                  className="text-button"
                                  aria-label={`重新整理 ${doc.name}`}
                                  title="按最新的清洗规则重新提取文字；学习进度保留，划线会按原句重新定位"
                                  onClick={async () => {
                                    setLocalError('');
                                    try {
                                      await post(`/documents/${doc.id}/reprocess`, {});
                                      setNotice(`「${doc.name}」正在按最新规则重新整理，学习进度会保留。`);
                                      await changed();
                                    } catch (error) {
                                      setLocalError(messageOf(error));
                                    }
                                  }}
                                >
                                  {doc.status === 'failed' ? '重试' : '重新整理'}
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </UploadDropArea>
                  </section>
                  <section className="content-section">
                    <div className="section-line">
                      <h3>
                        <LeafIcon size={19} /> 岛上正在生长
                      </h3>
                    </div>
                    {!detail.points.length ? (
                      <Empty title="留一块地，等知识发芽">资料整理好后，知识点会出现在这里。</Empty>
                    ) : (
                      <div className="point-list">
                        {detail.points.map((point) => (
                          <div className="point-row" key={point.id}>
                            <span className={`point-dot ${point.state}`} />
                            <div className="point-body">
                              {editingPoint === point.id ? (
                                <form
                                  onSubmit={async (event) => {
                                    event.preventDefault();
                                    try {
                                      await patch(`/points/${point.id}`, { title: pointTitle });
                                      setEditingPoint(null);
                                      await changed();
                                    } catch (error) {
                                      setLocalError(messageOf(error));
                                    }
                                  }}
                                >
                                  <Input
                                    value={pointTitle}
                                    onChange={(event) => setPointTitle(event.target.value)}
                                    maxLength={80}
                                    autoFocus
                                  />
                                  <button className="text-button" type="submit">
                                    保存名称
                                  </button>
                                </form>
                              ) : (
                                <button
                                  className="point-title"
                                  title="修改知识点名称"
                                  onClick={() => {
                                    setEditingPoint(point.id);
                                    setPointTitle(point.title);
                                  }}
                                >
                                  {point.title}
                                </button>
                              )}
                              <small>
                                {point.state === 'unexplored'
                                  ? '待探索'
                                  : point.state === 'developing'
                                    ? '正在巩固'
                                    : '已掌握'}
                                {point.nextReviewAt ? ` · ${dayLabel(point.nextReviewAt)}回访` : ''}
                              </small>
                            </div>
                            <button
                              className={`mini-action unfamiliar-toggle ${point.unfamiliar ? 'on' : ''}`}
                              aria-pressed={point.unfamiliar}
                              title={
                                point.unfamiliar ? '已记入知识图谱，点击移出' : '标记为不熟，记入知识图谱'
                              }
                              onClick={() => void markUnfamiliar(point, !point.unfamiliar)}
                            >
                              {point.unfamiliar ? '已标不熟' : '不熟'}
                            </button>
                            <button className="mini-action" onClick={() => onQuiz(point)}>
                              复习
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                  <section className="content-section">
                    <div className="section-line">
                      <h3>这里还没想明白</h3>
                      <button className="text-button" onClick={() => setAdding(!adding)}>
                        <PlusIcon size={16} /> 记个卡点
                      </button>
                    </div>
                    {adding ? (
                      <form
                        className="stuck-form"
                        onSubmit={async (event) => {
                          event.preventDefault();
                          setSaving(true);
                          setLocalError('');
                          try {
                            await post(`/courses/${courseId}/stuck`, {
                              text: note,
                              pointId: pointId || null,
                            });
                            setNote('');
                            setAdding(false);
                            await changed();
                          } catch (error) {
                            setLocalError(messageOf(error));
                          } finally {
                            setSaving(false);
                          }
                        }}
                      >
                        <textarea
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          placeholder="随手记一句：这里为什么……？"
                          maxLength={1000}
                          required
                        />
                        <select
                          aria-label="关联知识点"
                          value={pointId}
                          onChange={(event) => setPointId(event.target.value)}
                        >
                          <option value="">暂不关联知识点</option>
                          {detail.points.map((point) => (
                            <option key={point.id} value={point.id}>
                              {point.title}
                            </option>
                          ))}
                        </select>
                        <Button type="primary" htmlType="submit" size="small" loading={saving}>
                          记下来
                        </Button>
                      </form>
                    ) : null}
                    {!detail.stuck.length && !adding ? (
                      <p className="quiet-copy">不懂的地方，先记下来。下次复习会帮你找回来。</p>
                    ) : (
                      detail.stuck.map((stuck) => (
                        <div className={`stuck-row ${stuck.resolved ? 'resolved' : ''}`} key={stuck.id}>
                          <button
                            aria-label={stuck.resolved ? '标记为未解决' : '标记为已解决'}
                            className={`stuck-check ${stuck.resolved ? 'checked' : ''}`}
                            role="checkbox"
                            aria-checked={stuck.resolved}
                            onClick={async () => {
                              try {
                                await patch(`/stuck/${stuck.id}`, { resolved: !stuck.resolved });
                                await changed();
                              } catch (error) {
                                setLocalError(messageOf(error));
                              }
                            }}
                          ></button>
                          <span>{stuck.text}</span>
                        </div>
                      ))
                    )}
                  </section>
                </>
              )}
              {tab === 'materials' ? (
                <section className="danger-zone">
                  {confirmCourse ? (
                    <>
                      <p>
                        拆掉「{detail.course.name}
                        」后，这块地会变回空地：资料、知识点、划线、卡点和对话都会删除，无法恢复。学习热力图里的记录会保留。
                      </p>
                      <div className="danger-actions">
                        <button
                          className="danger-button"
                          disabled={removing}
                          onClick={async () => {
                            setRemoving(true);
                            setLocalError('');
                            try {
                              await api(`/courses/${courseId}`, { method: 'DELETE' });
                              onDeleted(detail.course.name);
                            } catch (error) {
                              setLocalError(messageOf(error));
                              setRemoving(false);
                            }
                          }}
                        >
                          {removing ? '正在拆除…' : '确认拆除这门课'}
                        </button>
                        <button className="text-button" onClick={() => setConfirmCourse(false)}>
                          再想想
                        </button>
                      </div>
                    </>
                  ) : (
                    <button className="text-button quiet-danger" onClick={() => setConfirmCourse(true)}>
                      删除这门课程
                    </button>
                  )}
                </section>
              ) : null}
            </div>
            <div className="course-sheet-footer">
              <Button type="primary" block icon={<BookIcon size={18} />} onClick={() => onRead(courseId)}>
                进入课件共读
              </Button>
            </div>
          </>
        ) : (
          <p className="loading-copy">正在靠近这座小岛…</p>
        )}
      </div>
    </Sheet>
  );
}

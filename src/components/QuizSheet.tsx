import { useState } from 'react';
import { Button } from 'animal-island-ui';
import { LeafIcon } from 'naive-icons/icons/LeafIcon';
import type { KnowledgePoint, Quiz, QuizResult, Source } from '../../shared/types';
import { post, messageOf, uid } from '../api';
import { Sheet, ErrorNote, dayLabel } from './Shared';

export default function QuizSheet({
  point,
  quiz,
  loading,
  error,
  onClose,
  onRead,
  onFinished,
  onNext,
}: {
  point: KnowledgePoint;
  quiz: Quiz | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRead: (source: Source, courseId: string) => void;
  onFinished: () => void;
  onNext: () => void;
}) {
  const [selection, setSelection] = useState(''),
    [hinted, setHinted] = useState(false),
    [hintOpen, setHintOpen] = useState(false),
    [result, setResult] = useState<QuizResult | null>(null),
    [busy, setBusy] = useState(false),
    [localError, setLocalError] = useState('');
  return (
    <Sheet title="回访一个知识点" onClose={onClose}>
      <div className="sheet-content quiz-content">
        <p className="quiz-topic">
          <LeafIcon size={16} />
          {point.title}
        </p>
        <ErrorNote>{error || localError}</ErrorNote>
        {loading ? (
          <div className="quiz-loading">
            <span className="loading-leaf" />
            <p>正在整理一道有资料依据的小题…</p>
          </div>
        ) : quiz ? (
          <>
            <span className="subtle-label">
              {quiz.mode === 'source_cloze' ? '原文回忆 · 无需连接 AI' : '理解小测'}
            </span>
            <h3 className="quiz-prompt">{quiz.prompt}</h3>
            <div className="quiz-options">
              {quiz.options.map((option) => (
                <button
                  key={option.id}
                  disabled={Boolean(result) || busy}
                  className={`quiz-option ${selection === option.id ? 'selected' : ''} ${result && option.id === result.correctOptionId ? 'correct' : ''} ${result && selection === option.id && !result.correct ? 'incorrect' : ''}`}
                  onClick={() => setSelection(option.id)}
                >
                  <span>{option.id}</span>
                  {option.text}
                </button>
              ))}
            </div>
            {!result ? (
              <>
                <button
                  className="text-button hint-button"
                  onClick={() => {
                    setHinted(true);
                    setHintOpen(!hintOpen);
                  }}
                >
                  {hintOpen ? '收起资料提示' : '想不起来？看看资料提示'}
                </button>
                {hintOpen ? (
                  <div className="source-hint">
                    {quiz.sources.map((source) => (
                      <p key={source.id}>{source.text}</p>
                    ))}
                  </div>
                ) : null}
                <Button
                  type="primary"
                  block
                  disabled={!selection}
                  loading={busy}
                  onClick={async () => {
                    setBusy(true);
                    setLocalError('');
                    try {
                      const response = await post<QuizResult>(`/quizzes/${quiz.id}/submit`, {
                        optionId: selection,
                        hinted,
                        requestId: uid(),
                      });
                      setResult(response);
                      onFinished();
                    } catch (error) {
                      setLocalError(messageOf(error));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  确认答案
                </Button>
              </>
            ) : (
              <div className={`quiz-result ${result.correct ? 'success' : ''}`}>
                <h3>
                  {result.correct
                    ? hinted
                      ? '借助提示，也往前走了一步'
                      : '答对了，小岛又生长了一点'
                    : '找到一个卡点，下次更有方向'}
                </h3>
                <p className="preserve-lines">{result.explanation}</p>
                <small>
                  下次回访：{dayLabel(result.nextReviewAt)}。
                  {result.after === 'mastered'
                    ? '不同题目都独立答对了，这个知识点已掌握。'
                    : '再积累一些独立作答证据，让理解更稳。'}
                </small>
                <div className="quiz-end-actions">
                  <Button type="primary" onClick={onClose}>
                    完成复习
                  </Button>
                  <Button onClick={onNext}>再练一道</Button>
                </div>
              </div>
            )}
            <div className="quiz-sources">
              {quiz.sources.map((source) => (
                <button
                  key={source.id}
                  className="source-link"
                  onClick={() => {
                    if (!result) setHinted(true);
                    onRead(source, point.courseId);
                  }}
                >
                  {source.documentName} · 第 {source.page} 页
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

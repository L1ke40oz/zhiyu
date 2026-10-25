import { useEffect, useState } from 'react';
import { Button } from 'animal-island-ui';
import { CalendarIcon } from 'naive-icons/icons/CalendarIcon';
import { ClockIcon } from 'naive-icons/icons/ClockIcon';
import { api, post, messageOf } from '../api';
import type { Course, KnowledgePoint, Profile, ReviewTask, Source } from '../../shared/types';
import { PageHeading, Empty, ErrorNote, dayLabel } from '../components/Shared';

export default function Review({
  courses,
  profile,
  revision,
  active,
  onCreate,
  onQuiz,
  onRead,
}: {
  courses: Course[];
  profile: Profile;
  revision: number;
  active: boolean;
  onCreate: () => void;
  onQuiz: (point: KnowledgePoint) => void;
  onRead: (courseId: string, documentId?: string, page?: number) => void;
}) {
  const [tasks, setTasks] = useState<ReviewTask[]>([]),
    [tab, setTab] = useState<'today' | 'later'>('today'),
    [error, setError] = useState('');
  useEffect(() => {
    if (!active) return;
    let live = true;
    api<ReviewTask[]>('/reviews')
      .then((data) => {
        if (live) {
          setTasks(data);
          setError('');
        }
      })
      .catch((error) => {
        if (live) setError(messageOf(error));
      });
    return () => {
      live = false;
    };
  }, [active, revision]);
  const due = tasks.filter((task) => task.due || task.stuck);
  const first = tasks.filter((task) => task.point.state === 'unexplored');
  const budget = Math.max(1, Math.floor(profile.dailyMinutes / 3));
  const today = (due.length ? due : first).slice(0, Math.min(6, budget));
  const future = tasks
    .filter((task) => !task.due && task.point.nextReviewAt)
    .sort((a, b) => a.point.nextReviewAt!.localeCompare(b.point.nextReviewAt!));
  return (
    <main className="feature-page review-page">
      <PageHeading title="复习计划" subtitle="每天回访一点，让知识慢慢扎根。" />
      <div className="segmented">
        <button className={tab === 'today' ? 'selected' : ''} onClick={() => setTab('today')}>
          今日复习{due.length ? <span>{due.length}</span> : null}
        </button>
        <button className={tab === 'later' ? 'selected' : ''} onClick={() => setTab('later')}>
          后续安排
        </button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!courses.length ? (
        <Empty title="先为一门课留一座岛">
          登记课程、上传课件，就能开始安排复习。
          <span className="empty-inline-action">
            <Button type="primary" onClick={onCreate}>
              新建课程岛
            </Button>
          </span>
        </Empty>
      ) : tab === 'today' ? (
        <>
          <div className="daily-note">
            <CalendarIcon size={28} />
            <div>
              <h2>
                {due.length ? '今天，去这些地方看看' : first.length ? '从这里开始探索' : '今天的小岛很安静'}
              </h2>
              <p>
                {today.length
                  ? `${today.length} 个知识点，约 ${today.length * 3} 分钟。完成后就回来看看小岛。`
                  : '暂时没有待复习任务。可以继续共读，或提前回访。'}
              </p>
            </div>
          </div>
          <div className="review-list">
            {today.map((task, index) => (
              <article className="review-item" key={task.point.id}>
                <span className="review-number">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <small>{task.courseName}</small>
                  <h3>{task.point.title}</h3>
                  {task.source ? (
                    <button
                      className="review-source text-button"
                      onClick={() => onRead(task.point.courseId, task.source!.documentId, task.source!.page)}
                    >
                      {task.source.documentName} · 第 {task.source.page} 页 ↗
                    </button>
                  ) : null}
                  <p>{task.reason}</p>
                  <div className="review-actions">
                    <Button type="primary" size="small" onClick={() => onQuiz(task.point)}>
                      开始复习
                    </Button>
                    {task.due ? (
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            await post(`/points/${task.point.id}/postpone`, {});
                            setTasks(await api('/reviews'));
                          } catch (error) {
                            setError(messageOf(error));
                          }
                        }}
                      >
                        明天再看
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!tasks.length ? (
            <Empty title="资料还在等你带来">在课程岛上传课件，整理好的知识点会出现在这里。</Empty>
          ) : null}
        </>
      ) : future.length ? (
        <div className="future-list">
          {future.map((task) => (
            <button className="future-item" key={task.point.id} onClick={() => onQuiz(task.point)}>
              <span className="future-date">
                <ClockIcon size={17} />
                {dayLabel(task.point.nextReviewAt!, profile.timezone)}
              </span>
              <span>
                <small>{task.courseName}</small>
                <b>{task.point.title}</b>
              </span>
              <span className="mini-action">提前复习</span>
            </button>
          ))}
        </div>
      ) : (
        <Empty title="下一次相遇，学完再安排">完成一次小测后，会根据本次表现安排下次回访。</Empty>
      )}
      <p className="page-footnote">
        每日预算 {profile.dailyMinutes} 分钟，可在个人中心调整。考试日期在课程岛详情中设置。
      </p>
    </main>
  );
}

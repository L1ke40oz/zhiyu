import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeftIcon } from 'naive-icons/icons/ChevronLeftIcon';
import { ChevronRightIcon } from 'naive-icons/icons/ChevronRightIcon';
import type {
  Capabilities,
  Course,
  KnowledgePoint,
  Profile as ProfileType,
  Quiz,
  Source,
} from '../shared/types';
import { api, patch, post, messageOf } from './api';
import CreateIsland from './components/CreateIsland';
import IslandEmblem from './components/IslandEmblem';
import CourseSheet from './components/CourseSheet';
import QuizSheet from './components/QuizSheet';
import { COURSES_PER_SEA, MAX_COURSES } from '../shared/ocean-layout';
import PixelIsland from './components/PixelIsland';
import { PixelEmblem, PixelIcon } from './components/PixelIcon';
import Review from './pages/Review';
import Reader, { type ReadingTarget } from './pages/Reader';
import Profile from './pages/Profile';
import Party from './pages/Party';
import { setSeaAudio } from './audio';

type Tab = 'review' | 'read' | 'islands' | 'party' | 'profile';
interface Bootstrap {
  courses: Course[];
  profile: ProfileType;
  capabilities: Capabilities;
}
const navigation = [
  { id: 'review', title: '复习计划', icon: 'review' },
  { id: 'read', title: '课件共读', icon: 'read' },
  { id: 'islands', title: '我的岛屿', icon: null },
  { id: 'party', title: '派对码头', icon: 'party' },
  { id: 'profile', title: '个人中心', icon: 'profile' },
] as const;

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null),
    [error, setError] = useState(''),
    [tab, setTab] = useState<Tab>('islands'),
    [sea, setSea] = useState(0),
    [create, setCreate] = useState<{ sea: number | null; slot: number | null } | null>(null),
    [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [readingTarget, setReadingTarget] = useState<ReadingTarget | null>(null),
    [revision, setRevision] = useState(0),
    [toast, setToast] = useState('');
  const [quizPoint, setQuizPoint] = useState<KnowledgePoint | null>(null),
    [quiz, setQuiz] = useState<Quiz | null>(null),
    [quizLoading, setQuizLoading] = useState(false),
    [quizError, setQuizError] = useState(''),
    [quizKey, setQuizKey] = useState(0);
  const [systemReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const quizOrigin = useRef<{ tab: Tab; sea: number; courseId: string | null }>({
    tab: 'islands',
    sea: 0,
    courseId: null,
  });
  const quizRequest = useRef(0);
  const refresh = useCallback(async () => {
    const bootstrap = await api<Bootstrap>('/bootstrap');
    setData(bootstrap);
    setRevision((value) => value + 1);
    setError('');
  }, []);
  useEffect(() => {
    void refresh().catch((error) => setError(messageOf(error)));
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  const courses = data?.courses;
  const currentCourses = useMemo(
    () => courses?.filter((course) => course.seaId === sea) || [],
    [courses, sea],
  );
  const reducedMotion = Boolean(data?.profile.reducedMotion || systemReduced);
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
  }, [reducedMotion]);
  const changed = () => {
    void refresh().catch((error) => setToast(messageOf(error)));
  };
  function read(courseId: string, documentId?: string, page?: number) {
    setSelectedCourse(null);
    setQuizPoint(null);
    setReadingTarget({ courseId, documentId, page, nonce: Date.now() });
    setTab('read');
  }
  async function startQuiz(point: KnowledgePoint) {
    if (!quizPoint) quizOrigin.current = { tab, sea, courseId: selectedCourse };
    const request = ++quizRequest.current;
    setSelectedCourse(null);
    setQuizPoint(point);
    setQuiz(null);
    setQuizError('');
    setQuizLoading(true);
    setQuizKey((value) => value + 1);
    try {
      const generated = await post<Quiz>(`/courses/${point.courseId}/quiz`, { pointId: point.id });
      if (request === quizRequest.current) setQuiz(generated);
    } catch (error) {
      if (request === quizRequest.current) setQuizError(messageOf(error));
    } finally {
      if (request === quizRequest.current) setQuizLoading(false);
    }
  }
  function finished() {
    changed();
    setToast('这次学习已记下，小岛正在慢慢生长。');
  }
  const lastSea = Math.max(0, ...(courses || []).map((course) => course.seaId));
  const lastSeaFull = (courses || []).filter((course) => course.seaId === lastSea).length >= COURSES_PER_SEA;
  const seaCount = Math.min(MAX_COURSES / COURSES_PER_SEA, lastSea + 1 + (lastSeaFull ? 1 : 0));
  return (
    <div
      className={`app-shell ${tab === 'islands' ? 'at-sea' : ''}`}
      onPointerDown={() => {
        if (data?.profile.seaSound) setSeaAudio(true);
      }}
    >
      {data ? (
        <>
          <div className="ocean-page" hidden={tab !== 'islands'}>
            <div className="ocean-surface pixel-ocean">
              <PixelIsland
                courses={currentCourses}
                sea={sea}
                reducedMotion={reducedMotion}
                active={tab === 'islands'}
                onSelect={(id) => setSelectedCourse(id)}
                onCreate={(slot) => setCreate(slot === null ? { sea: null, slot: null } : { sea, slot })}
              />
              {!currentCourses.length ? (
                <div className="px-hint">点一块空地，登记这学期的第一门课</div>
              ) : null}
              <div className="sea-pagination px-pagination" aria-label="岛屿切换">
                <button
                  className="px-arrow"
                  aria-label="上一座岛"
                  disabled={sea === 0}
                  onClick={() => setSea((value) => value - 1)}
                >
                  <ChevronLeftIcon size={18} />
                </button>
                <span>
                  第 {sea + 1} / {seaCount} 座岛
                  <small>
                    已开垦 {currentCourses.length} / {COURSES_PER_SEA} 块地
                  </small>
                </span>
                <button
                  className="px-arrow"
                  aria-label="下一座岛"
                  disabled={sea >= seaCount - 1}
                  onClick={() => setSea((value) => value + 1)}
                >
                  <ChevronRightIcon size={18} />
                </button>
              </div>
              <div className="sea-signature px-signature" aria-hidden="true">
                知屿<span>每门课程，都是岛上的一块地</span>
              </div>
            </div>
          </div>
          <div className="feature-container" hidden={tab !== 'review'}>
            <Review
              onRead={read}
              courses={data.courses}
              profile={data.profile}
              revision={revision}
              active={tab === 'review'}
              onCreate={() => setCreate({ sea: null, slot: null })}
              onQuiz={(point) => {
                void startQuiz(point);
              }}
            />
          </div>
          <div className="feature-container" hidden={tab !== 'read'}>
            <Reader
              courses={data.courses}
              capabilities={data.capabilities}
              target={readingTarget}
              active={tab === 'read'}
              onCreate={() => setCreate({ sea: null, slot: null })}
              onChanged={changed}
              onQuiz={(point) => {
                void startQuiz(point);
              }}
            />
          </div>
          <div className="feature-container" hidden={tab !== 'party'}>
            <Party capabilities={data.capabilities} />
          </div>
          <div className="feature-container" hidden={tab !== 'profile'}>
            <Profile
              onChanged={changed}
              courses={data.courses}
              capabilities={data.capabilities}
              profile={data.profile}
              active={tab === 'profile'}
              revision={revision}
              onUpdate={async (value) => {
                const profile = await patch<ProfileType>('/profile', value);
                setData((old) => (old ? { ...old, profile } : old));
              }}
            />
          </div>
          <nav className="bottom-nav" aria-label="主功能导航">
            {navigation.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${item.id === 'islands' ? 'nav-islands' : ''} ${tab === item.id ? 'active' : ''}`}
                onClick={() => {
                  setTab(item.id);
                  setSelectedCourse(null);
                }}
                aria-current={tab === item.id ? 'page' : undefined}
              >
                {item.icon ? (
                  <PixelIcon name={item.icon} size={26} />
                ) : (
                  <span className="nav-island-circle">
                    <PixelEmblem size={32} />
                  </span>
                )}
                <span>{item.title}</span>
              </button>
            ))}
          </nav>
          <CreateIsland
            open={create !== null}
            plot={create?.slot != null && create.sea != null ? { seaId: create.sea, slotId: create.slot } : null}
            onClose={() => setCreate(null)}
            onCreated={(course) => {
              setCreate(null);
              setSea(course.seaId);
              setTab('islands');
              changed();
              setSelectedCourse(course.id);
              setToast(`${course.name}的小屋盖好了，带上第一份课件吧。`);
            }}
          />
          {selectedCourse ? (
            <CourseSheet
              courseId={selectedCourse}
              onClose={() => setSelectedCourse(null)}
              onDeleted={(name) => {
                setSelectedCourse(null);
                changed();
                setToast(`「${name}」已拆除，这块地空出来了。`);
              }}
              onRead={read}
              onQuiz={(point) => {
                void startQuiz(point);
              }}
              onChanged={changed}
            />
          ) : null}
          {quizPoint ? (
            <QuizSheet
              key={quizKey}
              point={quizPoint}
              quiz={quiz}
              loading={quizLoading}
              error={quizError}
              onClose={() => {
                quizRequest.current++;
                setQuizPoint(null);
                setTab(quizOrigin.current.tab);
                setSea(quizOrigin.current.sea);
                setSelectedCourse(quizOrigin.current.courseId);
              }}
              onRead={(source: Source, courseId) => read(courseId, source.documentId, source.page)}
              onFinished={finished}
              onNext={() => {
                void startQuiz(quizPoint);
              }}
            />
          ) : null}
        </>
      ) : (
        <div className="startup-state">
          <IslandEmblem />
          <p>{error || '正在打开这片学习海域…'}</p>
          {error ? (
            <button
              onClick={() => {
                void refresh().catch((error) => setError(messageOf(error)));
              }}
            >
              再试一次
            </button>
          ) : null}
        </div>
      )}
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

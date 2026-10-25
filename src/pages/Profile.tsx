import { useEffect, useMemo, useState } from 'react';
import { Switch } from 'animal-island-ui';
import { LeafIcon } from 'naive-icons/icons/LeafIcon';
import { VolumeIcon } from 'naive-icons/icons/VolumeIcon';
import { SunIcon } from 'naive-icons/icons/SunIcon';
import type { ActivityDay, Capabilities, Course, Profile as ProfileType } from '../../shared/types';
import { api, messageOf } from '../api';
import { PageHeading, ErrorNote } from '../components/Shared';
import { playClickSound, setSeaAudio } from '../audio';
import IslandEmblem from '../components/IslandEmblem';
import ModelSettings from '../components/ModelSettings';
import WebSearchSettings from '../components/WebSearchSettings';

export default function Profile({
  courses,
  profile,
  capabilities,
  active,
  revision,
  onUpdate,
  onChanged,
  onReplayIntro,
}: {
  onReplayIntro: () => void;
  courses: Course[];
  profile: ProfileType;
  capabilities: Capabilities;
  active: boolean;
  revision: number;
  onUpdate: (patch: Partial<ProfileType>) => Promise<void>;
  onChanged: () => void;
}) {
  const [activity, setActivity] = useState<ActivityDay[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    if (!active) return;
    let live = true;
    api<ActivityDay[]>('/activity')
      .then((data) => {
        if (live) setActivity(data);
      })
      .catch((error) => {
        if (live) setError(messageOf(error));
      });
    return () => {
      live = false;
    };
  }, [active, revision]);
  const days = useMemo(() => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: profile.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const end = new Date(`${today}T12:00:00Z`);
    // End at the current week's Saturday, leaving future cells muted and uncounted.
    end.setUTCDate(end.getUTCDate() + 6 - end.getUTCDay());
    return Array.from({ length: 84 }, (_, index) => {
      const date = new Date(end.getTime() - (83 - index) * 86400000).toISOString().slice(0, 10);
      const day = activity.find((day) => day.date === date);
      return { date, future: date > today, count: day?.count || 0, events: day?.events || [] };
    });
  }, [activity, profile.timezone]);
  const selectedDay = days.find((day) => day.date === selected);
  async function update(value: Partial<ProfileType>) {
    setError('');
    try {
      await onUpdate(value);
    } catch (error) {
      setError(messageOf(error));
    }
  }
  return (
    <main className="feature-page profile-page">
      <PageHeading title="个人中心" subtitle="每一次回来，都在这里留下一点绿色。" />
      <div className="profile-intro">
        <span className="profile-avatar">
          <IslandEmblem />
        </span>
        <div>
          <h2>学习中的岛主</h2>
          <p>{courses.length ? `正在照料 ${courses.length} 座课程岛` : '准备好，让第一座岛靠岸'}</p>
        </div>
      </div>
      <div className="profile-stats">
        <div>
          <b>{activity.filter((day) => day.count).length}</b>
          <span>近百日学习天数</span>
        </div>
        <div>
          <b>{courses.reduce((sum, course) => sum + course.masteredCount, 0)}</b>
          <span>已掌握知识点</span>
        </div>
        <div>
          <b>{activity.reduce((sum, day) => sum + day.count, 0)}</b>
          <span>有效学习记录</span>
        </div>
      </div>
      <section className="activity-section">
        <div className="section-line">
          <h2>
            <LeafIcon size={20} /> 学习足迹
          </h2>
          <span>近 12 周</span>
        </div>
        <p className="quiet-copy">完成复习或记录共读，让今天亮起一格。</p>
        <div className="heatmap-wrap">
          <div className="heatmap-weekdays">
            <span>日</span>
            <span>二</span>
            <span>四</span>
            <span>六</span>
          </div>
          <div className="heatmap" aria-label="学习记录日历">
            {days.map((day) => (
              <button
                key={day.date}
                disabled={day.future}
                title={`${day.date}，${day.count} 次学习`}
                aria-label={`${day.date}，${day.count} 次学习`}
                className={`heat-cell level-${day.count === 0 ? 0 : day.count === 1 ? 1 : day.count < 4 ? 2 : 3} ${day.future ? 'future' : ''} ${selected === day.date ? 'chosen' : ''}`}
                onClick={() => setSelected(day.date)}
              />
            ))}
          </div>
        </div>
        <div className="heatmap-legend">
          <span>少</span>
          {[0, 1, 2, 3].map((level) => (
            <i key={level} className={`heat-cell level-${level}`} />
          ))}
          <span>多</span>
        </div>
        {selectedDay ? (
          <div className="day-detail">
            <b>{selectedDay.date}</b>
            {selectedDay.events.length ? (
              <ul>
                {selectedDay.events.map((event, index) => (
                  <li key={index}>
                    {event.type === 'review' ? '复习' : '共读'}：{event.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p>这天还没有留下学习记录。</p>
            )}
          </div>
        ) : null}
      </section>
      <ErrorNote>{error}</ErrorNote>
      <section className="preferences">
        <h2>按自己的节奏</h2>
        <label className="preference-row">
          <span>
            <VolumeIcon size={20} />
            <span>
              <b>点击音效</b>
              <small>点图标时，听一声轻轻的「啵」</small>
            </span>
          </span>
          <Switch
            aria-label="点击音效"
            checked={profile.clickSound}
            onChange={(value) => {
              if (value) playClickSound('toggle');
              void update({ clickSound: value });
            }}
          />
        </label>
        <label className="preference-row">
          <span>
            <VolumeIcon size={20} />
            <span>
              <b>海浪音效</b>
              <small>一点轻轻的海声，默认静音</small>
            </span>
          </span>
          <Switch
            aria-label="海浪音效"
            checked={profile.seaSound}
            onChange={(value) => {
              setSeaAudio(value);
              void update({ seaSound: value });
            }}
          />
        </label>
        <label className="preference-row">
          <span>
            <SunIcon size={20} />
            <span>
              <b>减少动态效果</b>
              <small>保留功能，让画面安静一些</small>
            </span>
          </span>
          <Switch
            aria-label="减少动态效果"
            checked={profile.reducedMotion}
            onChange={(value) => {
              void update({ reducedMotion: value });
            }}
          />
        </label>
        <div className="preference-row">
          <span>
            <SunIcon size={20} />
            <span>
              <b>开场引导</b>
              <small>再看一次云雾散开和功能介绍</small>
            </span>
          </span>
          <button type="button" className="mini-action" onClick={onReplayIntro}>
            重新播放
          </button>
        </div>
        <label className="preference-row">
          <span>
            <LeafIcon size={20} />
            <span>
              <b>每日复习预算</b>
              <small>为今天留一点能完成的时间</small>
            </span>
          </span>
          <select
            aria-label="每日复习预算"
            value={profile.dailyMinutes}
            onChange={(event) => {
              void update({ dailyMinutes: Number(event.target.value) });
            }}
          >
            {[5, 10, 15, 20, 30, 45, 60].map((value) => (
              <option value={value} key={value}>
                {value} 分钟
              </option>
            ))}
          </select>
        </label>
      </section>
      <ModelSettings active={active} onChanged={onChanged} />
      <WebSearchSettings active={active} />
      <section className="connection-status">
        <h3>共读能力</h3>
        <p>
          <i className={capabilities.chat ? 'available' : ''} />
          {capabilities.chat ? 'AI 讲解已连接' : 'AI 讲解尚未启用，原文检索可用'}
        </p>
        <p>
          <i className={capabilities.ocr ? 'available' : ''} />
          {capabilities.ocr ? '本地图片文字识别已开启' : '本地图片文字识别已关闭'}
        </p>
        <small>这台浏览器会保存你的匿名身份。清除站点 Cookie 后，会进入新的学习空间。</small>
      </section>
      <footer className="profile-footer">
        <span>知屿</span>
        <p>让学习，一点点生长。</p>
        <div className="profile-contact">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 1.71 2.64 1.22 3.28.93.1-.73.39-1.23.71-1.51-2.5-.29-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.8 10.8 0 0 1 5.64 0c2.15-1.46 3.1-1.15 3.1-1.15.61 1.55.23 2.69.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.63 5.27-5.14 5.55.4.35.76 1.04.76 2.1v3.1c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z" />
          </svg>
          <a href="https://github.com/L1ke40oz/zhiyu" target="_blank" rel="noreferrer">
            联系我们
          </a>
        </div>
      </footer>
    </main>
  );
}

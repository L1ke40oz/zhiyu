import { useState } from 'react';
import { Button, Input } from 'animal-island-ui';
import { AnchorIcon } from 'naive-icons/icons/AnchorIcon';
import { UsersIcon } from 'naive-icons/icons/UsersIcon';
import type { Capabilities } from '../../shared/types';
import { PageHeading } from '../components/Shared';

export default function Party({ capabilities }: { capabilities: Capabilities }) {
  const [code, setCode] = useState('');
  const base = capabilities.partyUrl.replace(/\/?$/, '/');
  return (
    <main className="feature-page party-page">
      <PageHeading title="派对码头" subtitle="学习间隙，和身边的人一起出发。" />
      <div className="party-illustration" aria-hidden="true">
        <span className="party-sun" />
        <span className="party-wave wave-one" />
        <span className="party-wave wave-two" />
        <span className="party-dock">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="party-flag">
          <AnchorIcon size={30} />
        </span>
        <span className="party-boat">
          <i />
          <i />
        </span>
      </div>
      <div className="party-intro">
        <span className="pill-note">
          <UsersIcon size={16} />
          最多 8 人 · 扫码即玩
        </span>
        <h2>
          手机变手柄，
          <br />
          快乐一起靠岸。
        </h2>
      </div>
      {capabilities.party ? (
        <div className="party-actions">
          <Button
            type="primary"
            block
            size="large"
            onClick={() => {
              window.location.href = `${base}host`;
            }}
          >
            我是主持人，创建房间
          </Button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (/^[A-Z2-9]{4}$/.test(code))
                window.location.href = `${base}?room=${encodeURIComponent(code)}`;
            }}
          >
            <Input
              aria-label="派对房间号"
              placeholder="输入 4 位房间号"
              value={code}
              maxLength={4}
              pattern="[A-Z2-9]{4}"
              required
              onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))}
            />
            <Button htmlType="submit">加入派对</Button>
          </form>
        </div>
      ) : (
        <p className="quiet-copy">派对游戏尚未接入，学习功能可以照常使用。</p>
      )}
      <p className="page-footnote">
        请通过 HTTPS 域名访问，才能正常使用摄像头、麦克风和动作传感器。
        授权后，画面与声音只在手机本地处理；派对房间在服务重启后结束。
      </p>
    </main>
  );
}

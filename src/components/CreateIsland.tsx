import { useEffect, useRef, useState } from 'react';
import { Button, Input, Modal } from 'animal-island-ui';
import { LeafIcon } from 'naive-icons/icons/LeafIcon';
import { post, messageOf, uid } from '../api';
import type { Course, IslandShape, Palette } from '../../shared/types';
import { ErrorNote } from './Shared';
import { roofColors } from '../island-config';
import { BUILDING_LABEL, buildingKindFor, buildingSprite } from '../pixel/sprites';

function BuildingPreview({ name, palette }: { name: string; palette: Palette }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const kind = buildingKindFor(name || '小岛', [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const sprite = buildingSprite(kind, palette);
    const scale = 3;
    canvas.width = 40 * scale;
    canvas.height = 40 * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#8fc86a';
    ctx.fillRect(4 * scale, 30 * scale, 32 * scale, 6 * scale);
    ctx.fillStyle = '#77b65b';
    ctx.fillRect(4 * scale, 36 * scale, 32 * scale, 1 * scale);
    ctx.fillStyle = '#cfae7f';
    ctx.fillRect(4 * scale, 37 * scale, 32 * scale, 3 * scale);
    ctx.drawImage(sprite.canvas, (20 - sprite.ax) * scale, (33 - sprite.ay) * scale, sprite.w * scale, sprite.h * scale);
  }, [kind, palette]);
  return (
    <div className="px-preview">
      <canvas ref={ref} aria-hidden="true" />
      <span>
        <b>{BUILDING_LABEL[kind]}</b>
        <small>建筑按课程名自动挑选，知识点越熟，地块越繁茂</small>
      </span>
    </div>
  );
}

export default function CreateIsland({
  open,
  onClose,
  onCreated,
  plot,
}: {
  plot?: { seaId: number; slotId: number } | null;
  open: boolean;
  onClose: () => void;
  onCreated: (course: Course) => void;
}) {
  const [name, setName] = useState(''),
    shape: IslandShape = 'bean',
    [palette, setPalette] = useState<Palette>('apricot'),
    [date, setDate] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [requestId, setRequestId] = useState(uid);
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      variant="game"
      title={
        <>
          <LeafIcon size={21} /> {plot ? `开垦第 ${plot.slotId + 1} 号地` : '登记一门新课'}
        </>
      }
      typewriter={false}
      width={440}
      footer={null}
      className="create-island-modal"
    >
      <form
        className="island-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const result = await post<Course>('/courses', {
              name: name.trim(),
              shape,
              palette,
              examDate: date || null,
              requestId,
              ...(plot ? { seaId: plot.seaId, slotId: plot.slotId } : {}),
            });
            onCreated(result);
            setName('');
            setDate('');
            setRequestId(uid());
          } catch (error) {
            setError(messageOf(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="form-intro">
          {plot
            ? `这门课会住进第 ${plot.seaId + 1} 座岛的 ${plot.slotId + 1} 号空地。`
            : '每座岛有六块地，课程会住进最近的一块空地；满了就去下一座岛。'}
        </p>
        <label className="field-label">
          这块地留给哪门课？
          <Input
            autoFocus
            placeholder="例如：高等数学"
            value={name}
            maxLength={30}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <BuildingPreview name={name.trim()} palette={palette} />
        <fieldset>
          <legend>屋顶和旗帜的颜色</legend>
          <div className="palette-options">
            {(Object.keys(roofColors) as Palette[]).map((value, index) => (
              <button
                type="button"
                key={value}
                className={`palette-option ${palette === value ? 'selected' : ''}`}
                style={{ '--swatch': roofColors[value] } as React.CSSProperties}
                aria-label={['暖杏色', '鼠尾草绿', '浅丁香紫', '雾蓝色'][index]}
                aria-pressed={palette === value}
                onClick={() => setPalette(value)}
              />
            ))}
          </div>
        </fieldset>
        <label className="field-label">
          考试日期 <span className="optional">选填</span>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <ErrorNote>{error}</ErrorNote>
        <Button htmlType="submit" type="primary" block loading={busy}>
          盖好小屋
        </Button>
      </form>
    </Modal>
  );
}

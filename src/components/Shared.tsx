import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from 'animal-island-ui';
import { UploadIcon } from 'naive-icons/icons/UploadIcon';
import { CloseIcon } from 'naive-icons/icons/CloseIcon';
import { ChevronRightIcon } from 'naive-icons/icons/ChevronRightIcon';
import { api, messageOf } from '../api';
import type { Course, DocumentRecord } from '../../shared/types';

export function ErrorNote({ children }: { children: ReactNode }) {
  return children ? (
    <p className="error-note" role="alert">
      {children}
    </p>
  ) : null;
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-sprout" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function PageHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </header>
  );
}
export function CourseSelect({
  courses,
  value,
  onChange,
}: {
  courses: Course[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="select-wrap">
      <span className="sr-only">选择课程</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {courses.map((course) => (
          <option key={course.id} value={course.id}>
            {course.name}
          </option>
        ))}
      </select>
    </label>
  );
}
export const UPLOAD_ACCEPT = '.pdf,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md,.markdown';
const UPLOAD_LIMIT = 20 * 1024 * 1024;
/** Uploads one or more files in turn; reports the first problem per file. */
function useUploader(courseId: string, onUploaded: (doc: DocumentRecord) => void) {
  const [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  async function upload(files: File[]) {
    if (!files.length || busy) return 0;
    setError('');
    const problems: string[] = [];
    for (const [index, file] of files.entries()) {
      if (/\.ppt$/i.test(file.name)) {
        problems.push(`${file.name}：旧版 .ppt 请另存为 .pptx 或导出 PDF。`);
        continue;
      }
      if (file.size > UPLOAD_LIMIT) {
        problems.push(`${file.name}：超过 20MB，请压缩或拆分。`);
        continue;
      }
      setBusy(files.length > 1 ? `正在上传 ${index + 1}/${files.length}` : '正在上传');
      const form = new FormData();
      form.append('file', file);
      try {
        onUploaded(
          await api<DocumentRecord>(`/courses/${courseId}/documents`, { method: 'POST', body: form }),
        );
      } catch (error) {
        problems.push(`${file.name}：${messageOf(error)}`);
      }
    }
    setBusy('');
    setError(problems.join('\n'));
    return problems.length;
  }
  return { upload, busy, error };
}
const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
export function UploadButton({
  courseId,
  onUploaded,
  compact = false,
}: {
  courseId: string;
  onUploaded: (doc: DocumentRecord) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="upload-control">
      <Button
        type={compact ? 'default' : 'primary'}
        size={compact ? 'small' : 'middle'}
        icon={<UploadIcon size={18} />}
        onClick={() => setOpen(true)}
      >
        上传资料
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        variant="game"
        title={
          <>
            <UploadIcon size={20} /> 上传课程资料
          </>
        }
        typewriter={false}
        width={460}
        footer={null}
        className="upload-modal"
      >
        <UploadDropArea
          courseId={courseId}
          onUploaded={onUploaded}
          box
          large
          onFinished={(problems) => {
            if (!problems) setOpen(false);
          }}
        />
      </Modal>
    </div>
  );
}
/**
 * Lets files be dropped anywhere on `children`. With `box`, also renders a
 * dashed drop box that opens the file picker when clicked.
 */
export function UploadDropArea({
  courseId,
  onUploaded,
  children,
  box,
  large,
  label = '把课件拖到这里，或点击选择',
  onFinished,
}: {
  courseId: string;
  onUploaded: (doc: DocumentRecord) => void;
  children?: ReactNode;
  box?: boolean;
  /** taller box with a separate "open file explorer" button */
  large?: boolean;
  label?: string;
  onFinished?: (problems: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    depth = useRef(0);
  const [over, setOver] = useState(false);
  const { upload: send, busy, error } = useUploader(courseId, onUploaded);
  const upload = async (files: File[]) => {
    if (!files.length) return;
    onFinished?.(await send(files));
  };
  // nested areas (dialog inside the reader page) must not upload the same drop twice
  const own = (event: React.DragEvent) => {
    if (!hasFiles(event)) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };
  return (
    <div
      className={`upload-drop-area ${over ? 'dragging' : ''} ${large ? 'large' : ''}`}
      onDragEnter={(event) => {
        if (!own(event)) return;
        depth.current++;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!own(event)) return;
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!own(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(event) => {
        if (!own(event)) return;
        depth.current = 0;
        setOver(false);
        void upload(Array.from(event.dataTransfer.files));
      }}
    >
      {children}
      {box ? (
        <>
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            accept={UPLOAD_ACCEPT}
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = '';
              void upload(files);
            }}
          />
          {large ? (
            <div className={`upload-drop-box large ${busy ? 'busy' : ''}`}>
              <span className="upload-drop-art" aria-hidden="true">
                <UploadIcon size={30} />
              </span>
              <b>{busy ? `${busy}…` : '把课件拖到这个框里'}</b>
              <small>PDF、PPTX、图片或文本，可一次放多份，单份最多 20MB</small>
              <span className="upload-drop-or">或者</span>
              <Button type="primary" disabled={Boolean(busy)} onClick={() => input.current?.click()}>
                从电脑中选择文件
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="upload-drop-box"
              disabled={Boolean(busy)}
              onClick={() => input.current?.click()}
            >
              <UploadIcon size={20} />
              <b>{busy || label}</b>
              <small>PDF、PPTX、图片或文本，可一次放多份，单份最多 20MB</small>
            </button>
          )}
        </>
      ) : null}
      {over ? (
        <div className="upload-drop-overlay" aria-hidden="true">
          <UploadIcon size={26} />
          松手就上传
        </div>
      ) : null}
      {busy && !box ? <p className="upload-drop-status">{busy}…</p> : null}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Native dialog semantics and focus containment are implemented without clipping long content.
  const lastFocused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    lastFocused.current = document.activeElement as HTMLElement;
    return () => lastFocused.current?.focus();
  }, []);
  return (
    <div
      className="sheet-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
          lastFocused.current?.focus();
        }
        if (event.key === 'Tab') {
          const targets = ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,textarea,select,a[href],[tabindex="0"]',
          );
          if (!targets?.length) return;
          const first = targets[0],
            last = targets[targets.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <section ref={ref} className="detail-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" />
        <header className="sheet-heading">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭" autoFocus>
            <CloseIcon size={23} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export const Arrow = () => <ChevronRightIcon size={19} />;
export const statusText: Record<DocumentRecord['status'], string> = {
  uploaded: '等待处理',
  parsing: '正在读取',
  indexing: '正在整理',
  ready: '可以共读',
  partial: '部分可读',
  failed: '处理未完成',
};
export function dayLabel(date: string, timezone = 'Asia/Singapore') {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', timeZone: timezone }).format(
    new Date(date),
  );
}

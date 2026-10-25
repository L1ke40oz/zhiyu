import type { ToolActivity as Activity } from '../../shared/types';
export default function ToolActivity({ tools }: { tools: Activity[] }) {
  if (!tools.length) return null;
  return (
    <div className="tool-activity" aria-label="工具执行记录">
      {tools.map((tool) => (
        <details
          key={tool.id}
          className={`tool-step ${tool.status}`}
          open={tool.status === 'running' || undefined}
        >
          <summary>
            <span className="tool-step-icon" aria-hidden="true">
              {tool.status === 'running'
                ? '◌'
                : tool.status === 'error'
                  ? '!'
                  : tool.id === 'web' || tool.id === 'course'
                    ? '⌕'
                    : '✓'}
            </span>
            {tool.label}
          </summary>
          {tool.pages?.length ? (
            <ul>
              {tool.pages.map((page) => (
                <li key={page.url}>
                  <a href={page.url} target="_blank" rel="noreferrer">
                    {page.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      ))}
    </div>
  );
}

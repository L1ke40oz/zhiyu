import type { ChatMessage, Source } from '../../shared/types';
import ToolActivity from './ToolActivity';

export default function ChatMessages({
  messages,
  onSource,
}: {
  messages: ChatMessage[];
  onSource: (source: Source) => void;
}) {
  return messages.map((message) =>
    message.role === 'user' ? (
      <div className="user-message" key={message.id}>
        {message.images?.map((image) => (
          <a href={image.url} target="_blank" rel="noreferrer" key={image.id}>
            <img className="chat-question-image" src={image.url} alt={image.name} />
          </a>
        ))}
        {message.text}
      </div>
    ) : (
      <article className="assistant-message" key={message.id}>
        <ToolActivity tools={message.tools || []} />
        <div className="assistant-caption">
          <span className="tiny-leaf" />
          {message.mode === 'extractive'
            ? '找到这些资料摘录'
            : message.mode === 'vision'
              ? '看图解题'
              : '一起看看'}
        </div>
        {message.sections.map((section, index) => (
          <div className="answer-section" key={index}>
            <span className={`basis-label ${section.basis}`}>
              {section.basis === 'course_material'
                ? '课程资料'
                : section.basis === 'web'
                  ? '联网补充 · 网页来源'
                  : message.mode === 'vision'
                    ? '图片分析与解题 · 请核实'
                    : '通用补充 · 请核实'}
            </span>
            <p>{section.text}</p>
            {section.externalSources.map((source) => (
              <a
                className="source-link web-source-link"
                href={source.url}
                target="_blank"
                rel="noreferrer"
                key={source.url}
              >
                {source.title} ↗
              </a>
            ))}
            {section.sourceChunkIds.map((sourceId) => {
              const source = message.sources.find((item) => item.id === sourceId);
              return source ? (
                <button className="source-link" key={sourceId} onClick={() => onSource(source)}>
                  {source.documentName} · 第 {source.page} 页
                </button>
              ) : null;
            })}
          </div>
        ))}
      </article>
    ),
  );
}

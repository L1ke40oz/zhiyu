import { randomUUID } from 'node:crypto';
import type { ToolActivity } from '../../shared/types.ts';
import type { Store } from '../db.ts';

const jobs = new Map<string, { owner: string; status: string; tools: ToolActivity[]; updated: number }>();
export async function runAssistantWork<T>(
  owner: string,
  requestId: unknown,
  work: (notify: (tools: ToolActivity[]) => void) => Promise<T>,
) {
  for (const [key, job] of jobs) if (Date.now() - job.updated > 300000) jobs.delete(key);
  const id = typeof requestId === 'string' && /^[a-f0-9-]{36}$/i.test(requestId) ? requestId : randomUUID();
  const job = { owner, status: 'running', tools: [] as ToolActivity[], updated: Date.now() };
  jobs.set(id, job);
  try {
    const result = await work((tools) => {
      job.tools = [...tools];
      job.updated = Date.now();
    });
    job.status = 'done';
    return result;
  } catch (error) {
    job.status = 'error';
    throw error;
  }
}
export function assistantWork(owner: string, id: string) {
  const job = jobs.get(id);
  return job && job.owner !== owner ? null : { status: job?.status || 'waiting', tools: job?.tools || [] };
}
export function messageTools(db: Store, courseId: string) {
  return new Map(
    db
      .all<{ message_id: string; events: string }>(
        'SELECT t.message_id,t.events FROM message_tools t JOIN messages m ON m.id=t.message_id WHERE m.course_id=?',
        courseId,
      )
      .map((row) => [row.message_id, JSON.parse(row.events) as ToolActivity[]]),
  );
}

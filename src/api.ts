export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
const inFlight = new Map<string, Promise<unknown>>();
export function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  if ((!options.method || options.method === 'GET') && !options.signal) {
    const existing = inFlight.get(url);
    if (existing) return existing as Promise<T>;
    const pending = request<T>(url, options).finally(() => inFlight.delete(url));
    inFlight.set(url, pending);
    return pending;
  }
  return request<T>(url, options);
}
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${url}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    credentials: 'same-origin',
  });
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new ApiError('服务暂未就绪，请稍后重试。', response.status);
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || '操作未完成，请重试。', response.status, data.code);
  return data;
}
export const post = <T>(url: string, data: unknown) =>
  api<T>(url, { method: 'POST', body: JSON.stringify(data) });
export const patch = <T>(url: string, data: unknown) =>
  api<T>(url, { method: 'PATCH', body: JSON.stringify(data) });
export const uid = () => crypto.randomUUID();
export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : '操作未完成，请重试。';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + url, {
    method,
    credentials: 'same-origin',
    headers: { 'X-EEOS': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error ?? msg; } catch { /* not JSON */ }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T = unknown>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T = unknown>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T = unknown>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
};

/** Stream a text response (used by the AI Copilot). */
export async function streamText(url: string, body: unknown, onChunk: (text: string) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch('/api' + url, {
    method: 'POST', credentials: 'same-origin', signal,
    headers: { 'X-EEOS': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    let msg = res.statusText;
    try { msg = (await res.json()).error ?? msg; } catch { /* not JSON */ }
    throw new ApiError(res.status, msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}

export function downloadFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

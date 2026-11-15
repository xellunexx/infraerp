// Thin API client. Every call goes to the same origin; errors carry the server's Bulgarian message.
export class ApiError extends Error { status: number; data: any; constructor(status: number, message: string, data: any) { super(message); this.status = status; this.data = data; } }

async function call<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch('/api' + url, { method, credentials: 'same-origin', headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('synchro:unauthorized'));
    throw new ApiError(res.status, data?.error || `Грешка ${res.status}`, data);
  }
  return data as T;
}
export const api = {
  get: <T = any>(url: string) => call<T>('GET', url),
  post: <T = any>(url: string, body: unknown = {}, idempotencyKey?: string) => call<T>('POST', url, body, idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
  put: <T = any>(url: string, body: unknown) => call<T>('PUT', url, body),
  patch: <T = any>(url: string, body: unknown) => call<T>('PATCH', url, body),
  del: <T = any>(url: string) => call<T>('DELETE', url),
};

export type Perm = { read: boolean; write: boolean; approve: boolean };
export type User = { id: number; username: string; full_name: string; department: string; role: string; perms: Record<string, Perm> };
export type Dept = { code: string; name: string; color: string };
export type AuthState = { needs_setup: boolean; user: User | null; departments: Dept[]; settings: Record<string, string> };

export const fmtMoney = (n: number | null | undefined, cur = '') => n == null ? '—' : new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + (cur ? ' ' + cur : '');
export const fmtNum = (n: number | null | undefined, d = 2) => n == null ? '—' : new Intl.NumberFormat('bg-BG', { maximumFractionDigits: d }).format(n);
export const fmtDate = (s?: string | null) => { if (!s) return '—'; const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s.replace(' ', 'T') + (s.includes('Z') || s.includes('T') ? '' : 'Z')); return isNaN(+d) ? s : d.toLocaleDateString('bg-BG'); };
export const fmtDateTime = (s?: string | null) => { if (!s) return '—'; const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z'); return isNaN(+d) ? s : d.toLocaleString('bg-BG', { dateStyle: 'short', timeStyle: 'short' }); };
export const today = () => new Date().toISOString().slice(0, 10);
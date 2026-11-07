import { supabase } from './supabase.js';

export interface ApiErrorPayload {
  code: string;
  message: string;
  details: unknown[];
}

export class RelayApiError extends Error {
  status: number;
  code: string;
  details: unknown[];

  constructor(status: number, error: ApiErrorPayload) {
    super(error.message);
    this.name = 'RelayApiError';
    this.status = status;
    this.code = error.code;
    this.details = error.details || [];
  }
}

export interface PaginatedResult<T> {
  data: T;
  page?: {
    nextCursor: string | null;
    hasMore: boolean;
  };
  requestId: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  // 1. Get current Supabase Auth session token
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const errorPayload: ApiErrorPayload = body?.error || {
      code: response.status === 404 ? 'NOT_FOUND' : 'API_ERROR',
      message: response.statusText || 'Request failed',
      details: [],
    };
    throw new RelayApiError(response.status, errorPayload);
  }

  return (body?.data ?? body) as T;
}

export async function apiFetchPaginated<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<PaginatedResult<T>> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const errorPayload: ApiErrorPayload = body?.error || {
      code: response.status === 404 ? 'NOT_FOUND' : 'API_ERROR',
      message: response.statusText || 'Request failed',
      details: [],
    };
    throw new RelayApiError(response.status, errorPayload);
  }

  return body as PaginatedResult<T>;
}

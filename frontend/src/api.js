import axios from 'axios';

// /api works in development (Vite proxy) and on Vercel (service rewrite).
// Set VITE_API_URL only for a split deployment on a different origin.
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

// The session lives in an httpOnly cookie, so every request must include
// credentials. Same-origin requests send cookies automatically, but this keeps
// a split frontend/API deployment working too.
const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

/**
 * Turn any Axios/network error into a human-readable string.
 *
 * Vercel's platform errors look like {"error":{"code":"500","message":"..."}}
 * while our API returns {"error":"..."} or a plain string. Returning an object
 * from here used to crash React (#31: objects are not valid as a child), so
 * this function must always return a string.
 */
export function apiErrorMessage(err, fallback = 'Something went wrong. Please try again.') {
  if (!err) return fallback;

  if (!err.response) {
    return err.message || 'Cannot reach the server. Check your connection and try again.';
  }

  const data = err.response.data;
  const candidates = [data, data?.error, data?.message, data?.error?.message];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    if (candidate && typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message;
    }
  }

  if (err.response.status === 401) return 'Session expired. Please sign in again.';
  if (err.response.status === 503) return 'The service is temporarily unavailable. Please try again.';
  if (err.response.status >= 500) return 'The server could not complete that request. Please try again.';
  return fallback;
}

export default api;

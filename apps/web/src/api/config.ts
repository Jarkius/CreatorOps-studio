import type { AuthMode } from './session.js';

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export const AUTH_MODE: AuthMode = import.meta.env.VITE_AUTH_MODE === 'mock' ? 'mock' : 'none';

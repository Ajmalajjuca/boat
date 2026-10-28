import type { AuthOptions, MePayload } from '@boat/domain/api'
import { api } from './client'

// All but changePassword are public: a 401 from them is an answer, not a session that ended.
const open = { public: true }
export const fetchMe = () => api.get<MePayload>('/auth/me', open)
// Whether Google sign-in is set up; the sign-in screen offers it when it is.
export const fetchAuthOptions = () => api.get<AuthOptions>('/auth/options', open)
// A full-page navigation: the server sends the browser on to Google and back.
export const googleSignInUrl = '/api/v1/auth/google/start'
// The backup admin's password sign-in (FR-11.6).
export const login = (email: string, password: string) =>
  api.post<MePayload>('/auth/login', { email, password }, open)
export const logout = () => api.post<void>('/auth/logout', undefined, open)
// Starts a new session (with a new CSRF token) and ends the user's others.
export const changePassword = (currentPassword: string, newPassword: string) =>
  api.patch<MePayload>('/auth/me/password', { currentPassword, newPassword })

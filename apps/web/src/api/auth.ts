import type { MePayload } from '@boat/domain/api'
import { api } from './client'

// All but changePassword are public: a 401 from them is an answer, not a session that ended.
const open = { public: true }
export const fetchMe = () => api.get<MePayload>('/auth/me', open)
export const login = (email: string, password: string) =>
  api.post<MePayload>('/auth/login', { email, password }, open)
export const logout = () => api.post<void>('/auth/logout', undefined, open)
export const acceptInvite = (token: string, password: string) =>
  api.post<MePayload>('/auth/invites/accept', { token, password }, open)
export const forgotPassword = (email: string) =>
  api.post<{ message: string }>('/auth/password/forgot', { email }, open)
export const resetPassword = (token: string, password: string) =>
  api.post<void>('/auth/password/reset', { token, password }, open)
// Starts a new session (with a new CSRF token) and ends the user's others.
export const changePassword = (currentPassword: string, newPassword: string) =>
  api.patch<MePayload>('/auth/me/password', { currentPassword, newPassword })

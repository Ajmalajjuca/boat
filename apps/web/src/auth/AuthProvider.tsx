import type { MePayload } from '@boat/domain/api'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { fetchMe, logout } from '../api/auth'
import { setCsrfToken, UnauthenticatedError, whenSessionEnds } from '../api/client'
import { queryClient } from '../api/queryClient'

type Auth = {
  // undefined while the start-up check runs; null when signed out.
  me: MePayload | null | undefined
  // Shown on the sign-in screen: why the user was signed out, or what to do next.
  notice: string
  signedIn(me: MePayload): void
  signOut(notice?: string): Promise<void>
  showNotice(notice: string): void
}
const AuthContext = createContext<Auth | null>(null)
export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth needs an AuthProvider.')
  return auth
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MePayload | null | undefined>(undefined)
  const [notice, setNotice] = useState('')
  const signedIn = useCallback((payload: MePayload) => {
    setCsrfToken(payload.csrfToken)
    setNotice('')
    setMe(payload)
  }, [])
  // Drops everything the last user could see, so the next one starts clean.
  const signedOut = useCallback((message: string) => {
    setCsrfToken('')
    queryClient.clear()
    setNotice(message)
    setMe(null)
  }, [])
  useEffect(() => {
    whenSessionEnds(() => signedOut('Your session ended. Sign in again.'))
    // The app's only /auth/me call. Every request with a session moves its idle timer, so
    // polling this would keep sessions alive forever.
    fetchMe().then(signedIn, (err: unknown) =>
      signedOut(err instanceof UnauthenticatedError || !(err instanceof Error) ? '' : err.message),
    )
  }, [signedIn, signedOut])
  const signOut = useCallback(
    async (message = '') => {
      // A session that already ended is signed out either way.
      await logout().catch(() => undefined)
      signedOut(message)
    },
    [signedOut],
  )
  const value = useMemo(
    () => ({ me, notice, signedIn, signOut, showNotice: setNotice }),
    [me, notice, signedIn, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

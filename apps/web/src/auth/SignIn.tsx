import { type FormEvent, type ReactNode, useState } from 'react'
import { googleSignInUrl, login } from '../api/auth'
import { useAuthOptions } from '../api/queries'
import {
  Brand,
  Button,
  buttonVariants,
  Card,
  cn,
  Field,
  FormError,
  Input,
  useFormErrors,
} from '../ui'
import { useAuth } from './AuthProvider'

// The frame of every screen a signed-out user sees.
export function AuthCard({
  title,
  intro,
  children,
}: {
  title: string
  intro: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f6f8] p-5">
      <Card className="w-full max-w-md overflow-hidden">
        <div className="bg-[#1a2024] p-7 text-white">
          <div className="mb-8">
            <Brand dark />
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[.2em] text-white/50">
            Your operations workspace
          </div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">{intro}</p>
        </div>
        <div className="p-6">{children}</div>
      </Card>
    </div>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="mb-4 rounded-xl bg-teal-50 px-3 py-2.5 text-sm text-slate-800">
      {children}
    </p>
  )
}

// What the Google callback's ?error= codes mean to the person who tried to sign in.
const googleErrors: Record<string, string> = {
  not_added: "This Google account hasn't been given access. Ask your admin to add you.",
  domain: 'Sign in with your company Google account.',
  unverified: "Google hasn't verified this email address.",
  disabled: 'This account is disabled. Ask your admin.',
  failed: "Google sign-in didn't complete. Try again.",
}

// Reads the callback's error once and drops it from the address bar, so a reload doesn't repeat it.
function takeGoogleError() {
  const params = new URLSearchParams(window.location.search),
    code = params.get('error')
  if (code === null) return ''
  window.history.replaceState(null, '', '/')
  return googleErrors[code] ?? googleErrors.failed
}

export function SignIn() {
  const auth = useAuth()
  const options = useAuthOptions()
  const [googleError] = useState(takeGoogleError)
  const [withPassword, setWithPassword] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false)
  const form = useFormErrors()
  // Without Google set up, the backup admin's password is the only way in.
  const passwordForm = withPassword || options.data?.google === false
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      auth.signedIn(await login(email, password))
    } catch (err) {
      form.fail(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthCard
      title="Sign in"
      intro={
        passwordForm
          ? 'The backup admin signs in with the password set when BOAT was set up.'
          : 'Use the company Google account your admin added.'
      }
    >
      {auth.notice && <Notice>{auth.notice}</Notice>}
      <FormError message={googleError} />
      {passwordForm ? (
        <form onSubmit={submit} noValidate className="space-y-4">
          <FormError message={form.errors.form} />
          <Field label="Email" error={form.errors.email}>
            <Input
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                form.clear('email')
              }}
            />
          </Field>
          <Field label="Password" error={form.errors.password}>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                form.clear('password')
              }}
            />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          {options.data?.google && (
            <button
              type="button"
              onClick={() => {
                setWithPassword(false)
                form.reset()
              }}
              className="w-full text-center text-xs font-semibold text-slate-800 hover:underline"
            >
              Back to Google sign-in
            </button>
          )}
        </form>
      ) : (
        <div className="space-y-4">
          {/* A full-page link, not a fetch: Google's consent screen needs the whole window. */}
          <a href={googleSignInUrl} className={cn(buttonVariants(), 'w-full')}>
            Sign in with Google
          </a>
          <button
            type="button"
            onClick={() => setWithPassword(true)}
            className="w-full text-center text-xs font-semibold text-slate-800 hover:underline"
          >
            Admin password sign-in
          </button>
        </div>
      )}
    </AuthCard>
  )
}

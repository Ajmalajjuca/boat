import { type FormEvent, type ReactNode, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { googleSignInUrl, login } from '../api/auth'
import { useAuthOptions } from '../api/queries'
import { Brand, Button, buttonVariants, cn, Field, FormError, Input, useFormErrors } from '../ui'
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
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="hidden flex-col justify-between bg-ink p-10 text-white lg:flex xl:p-14">
        <Brand dark />
        <div className="max-w-md">
          <p className="screen-title text-[34px] leading-[1.12]">
            Every lot, from raw material to warehouse.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            Production lots, material readiness, month-end plans and finished-goods shipments for
            the boAt operations team.
          </p>
        </div>
        <p className="text-xs text-white/40">Only people your admin has added can sign in.</p>
      </div>
      <div className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-12 lg:hidden">
            <Brand />
          </div>
          <h1 className="screen-title text-[28px] text-ink">{title}</h1>
          <p className="mt-2 text-[15px] leading-6 text-muted">{intro}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="mb-4 rounded-lg border border-line bg-wash px-3 py-2.5 text-sm text-ink"
    >
      {children}
    </p>
  )
}

// Google's "G", as its sign-in buttons show it.
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
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
  // Google is offered only once the server says it's set up. Without it, or when the server can't
  // be asked, the backup admin's password is the way in.
  const google = options.data?.google === true
  const passwordForm = withPassword || (!options.isPending && !google)
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
      {options.isPending && !withPassword ? (
        <div
          role="status"
          aria-label="Loading sign-in options"
          className="flex justify-center py-3 text-faint"
        >
          <LoaderCircle size={20} aria-hidden="true" className="animate-spin" />
        </div>
      ) : passwordForm ? (
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
          {google && (
            <button
              type="button"
              onClick={() => {
                setWithPassword(false)
                form.reset()
              }}
              className="w-full py-1 text-center text-sm font-medium text-muted hover:text-ink"
            >
              Back to Google sign-in
            </button>
          )}
        </form>
      ) : (
        <div>
          {/* A full-page link, not a fetch: Google's consent screen needs the whole window. */}
          <a
            href={googleSignInUrl}
            className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'w-full gap-3')}
          >
            <GoogleMark />
            Sign in with Google
          </a>
          <div className="mt-8 border-t border-line-soft pt-5 text-center">
            <button
              type="button"
              onClick={() => setWithPassword(true)}
              className="text-sm font-medium text-muted hover:text-ink"
            >
              Admin password sign-in
            </button>
          </div>
        </div>
      )}
    </AuthCard>
  )
}

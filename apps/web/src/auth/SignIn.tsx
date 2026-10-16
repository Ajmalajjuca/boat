import { Box } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { forgotPassword, login } from '../api/auth'
import { Button, Card, Field, FormError, Input, useFormErrors } from '../ui'
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
    <div className="flex min-h-screen items-center justify-center bg-[#edf2f1] p-5">
      <Card className="w-full max-w-md overflow-hidden">
        <div className="bg-[#123b3e] p-7 text-white">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[#d96d35]">
            <Box size={23} />
          </div>
          <div className="text-xs font-bold uppercase tracking-[.22em] text-teal-200">
            BOAT · Supply chain
          </div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-teal-100">{intro}</p>
        </div>
        <div className="p-6">{children}</div>
      </Card>
    </div>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="mb-4 rounded-xl bg-teal-50 px-3 py-2.5 text-sm text-teal-800">
      {children}
    </p>
  )
}

export function SignIn() {
  const auth = useAuth()
  const [forgot, setForgot] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [sent, setSent] = useState(''),
    [busy, setBusy] = useState(false)
  const form = useFormErrors()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      if (forgot) setSent((await forgotPassword(email)).message)
      else auth.signedIn(await login(email, password))
    } catch (err) {
      form.fail(err)
    } finally {
      setBusy(false)
    }
  }
  const toggle = () => {
    setForgot(!forgot)
    setSent('')
    form.reset()
  }
  return (
    <AuthCard
      title={forgot ? 'Reset your password' : 'Sign in'}
      intro={
        forgot
          ? "Enter your email address and we'll send a link to choose a new password."
          : 'Use the email address your admin invited.'
      }
    >
      {auth.notice && <Notice>{auth.notice}</Notice>}
      {sent ? (
        <div className="space-y-4">
          <Notice>{sent}</Notice>
          <Button variant="secondary" className="w-full" onClick={toggle}>
            Back to sign in
          </Button>
        </div>
      ) : (
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
          {!forgot && (
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
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {forgot ? 'Send reset link' : 'Sign in'}
          </Button>
          <button
            type="button"
            onClick={toggle}
            className="w-full text-center text-xs font-semibold text-teal-800 hover:underline"
          >
            {forgot ? 'Back to sign in' : 'Forgot password?'}
          </button>
        </form>
      )}
    </AuthCard>
  )
}

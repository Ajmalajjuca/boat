import { fieldErrors, validatePassword } from '@boat/domain/validation'
import { type FormEvent, useEffect, useState } from 'react'
import { acceptInvite, resetPassword } from '../api/auth'
import { Button, Field, FormError, Input, useFormErrors } from '../ui'
import { useAuth } from './AuthProvider'
import { AuthCard } from './SignIn'

// Emailed links carry the token after #, so it never reaches server logs. The page reads it once,
// then clears it from the address bar so it isn't kept in history or shared by copying the URL.
function useFragmentToken() {
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') ?? '')
  useEffect(() => {
    history.replaceState(null, '', location.pathname)
  }, [])
  return token
}

function PasswordForm({
  submitLabel,
  onSubmit,
  onBack,
}: {
  submitLabel: string
  onSubmit: (password: string) => Promise<void>
  onBack: () => void
}) {
  const [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false)
  const form = useFormErrors()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const found = validatePassword(password)
    if (!found.password && password !== confirm) found.confirm = 'The two passwords do not match.'
    if (!form.check(found) || busy) return
    setBusy(true)
    try {
      await onSubmit(password)
    } catch (err) {
      // An expired or used link comes back as a token error; it belongs above the form.
      const fields = fieldErrors(err)
      form.fail(fields.token ? new Error(fields.token) : err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormError message={form.errors.form} />
      <Field label="New password" help="At least 12 characters." error={form.errors.password}>
        <Input
          type="password"
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            form.clear('password')
          }}
        />
      </Field>
      <Field label="Confirm password" error={form.errors.confirm}>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value)
            form.clear('confirm')
          }}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={busy}>
        {submitLabel}
      </Button>
      <button
        type="button"
        onClick={onBack}
        className="w-full text-center text-xs font-semibold text-teal-800 hover:underline"
      >
        Back to sign in
      </button>
    </form>
  )
}

function MissingToken({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <FormError message="This link is incomplete. Open it again from the email." />
      <Button variant="secondary" className="w-full" onClick={onBack}>
        Go to sign in
      </Button>
    </div>
  )
}

// Accepting an invite starts a session, so the user lands in the app.
export function AcceptInvite({ onDone }: { onDone: () => void }) {
  const auth = useAuth(),
    token = useFragmentToken()
  return (
    <AuthCard title="Welcome to BOAT" intro="Choose a password to finish setting up your account.">
      {token ? (
        <PasswordForm
          submitLabel="Set password"
          onBack={onDone}
          onSubmit={async (password) => {
            auth.signedIn(await acceptInvite(token, password))
            onDone()
          }}
        />
      ) : (
        <MissingToken onBack={onDone} />
      )}
    </AuthCard>
  )
}

// A reset doesn't start a session; the user signs in with the new password.
export function ResetPassword({ onDone }: { onDone: () => void }) {
  const auth = useAuth(),
    token = useFragmentToken()
  return (
    <AuthCard title="Choose a new password" intro="The link in your email works once, for an hour.">
      {token ? (
        <PasswordForm
          submitLabel="Change password"
          onBack={onDone}
          onSubmit={async (password) => {
            await resetPassword(token, password)
            auth.showNotice('Password changed. Sign in with your new password.')
            onDone()
          }}
        />
      ) : (
        <MissingToken onBack={onDone} />
      )}
    </AuthCard>
  )
}

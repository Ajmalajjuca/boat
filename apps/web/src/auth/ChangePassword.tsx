import { validatePassword } from '@boat/domain/validation'
import { type FormEvent, useState } from 'react'
import { changePassword } from '../api/auth'
import { Button, Field, FormError, Input, Modal, useFormErrors } from '../ui'
import { useAuth } from './AuthProvider'

export function ChangePassword({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const auth = useAuth()
  const [current, setCurrent] = useState(''),
    [next, setNext] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false)
  const form = useFormErrors()
  const close = () => {
    setCurrent('')
    setNext('')
    setConfirm('')
    form.reset()
    onClose()
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const found = validatePassword(next, 'newPassword')
    if (!current) found.currentPassword = 'Enter your current password.'
    if (!found.newPassword && next !== confirm) found.confirm = 'The two passwords do not match.'
    if (!form.check(found) || busy) return
    setBusy(true)
    try {
      // The server starts a new session with a new CSRF token and ends the user's others.
      auth.signedIn(await changePassword(current, next))
      close()
      onDone()
    } catch (err) {
      form.fail(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onOpenChange={(v) => !v && close()} title="Change password">
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormError message={form.errors.form} />
        <Field label="Current password" error={form.errors.currentPassword}>
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value)
              form.clear('currentPassword')
            }}
          />
        </Field>
        <Field label="New password" help="At least 12 characters." error={form.errors.newPassword}>
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.target.value)
              form.clear('newPassword')
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
        <p className="text-xs text-slate-500">You stay signed in here; other devices sign out.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save password
          </Button>
        </div>
      </form>
    </Modal>
  )
}

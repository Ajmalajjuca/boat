import { useState, type FormEvent } from 'react'
import type { InviteResult, UserItem } from '@boat/domain/api'
import { roleInfo, roles } from '@boat/domain/permissions'
import { validateAccount } from '@boat/domain/validation'
import { Plus } from 'lucide-react'
import {
  deleteUser,
  inviteUser,
  resendInvite,
  updateUser,
  type UserForm,
  userField,
  userInput,
} from './api/admin'
import { values } from './api/mappers'
import { keys, useLookups, useUsers } from './api/queries'
import { queryClient } from './api/queryClient'
import type { Role } from './models'
import {
  Badge,
  Button,
  Card,
  Field,
  FormError,
  Input,
  Modal,
  SearchSelect,
  Select,
  useFormErrors,
  type Run,
} from './ui'

const statusLabel: Record<UserItem['status'], string> = {
  invited: 'Invited',
  active: 'Active',
  disabled: 'Disabled',
}
const blank: UserForm = { name: '', email: '', role: 'viewer', poc: '' }
const refreshUsers = () => queryClient.invalidateQueries({ queryKey: keys.users })

// Admins invite users, change their role and POC link, and disable or delete them. The server
// refuses what would leave no active admin; that message shows in the form or as a toast.
export default function Users({ run, onMessage }: { run: Run; onMessage: (text: string) => void }) {
  const users = useUsers(true).data ?? []
  const lookups = useLookups().data ?? []
  const [editing, setEditing] = useState<{ user: UserItem | null; form: UserForm } | null>(null)
  const form = useFormErrors()
  const sent = (r: InviteResult) =>
    onMessage(
      r.inviteEmailSent
        ? `Invite sent to ${r.user.email}.`
        : `${r.user.email} was invited, but the email didn't send. Use Resend invite to try again.`,
    )
  const open = (user: UserItem | null) => {
    form.reset()
    setEditing({
      user,
      form: user
        ? { name: user.name, email: user.email, role: user.role, poc: user.poc?.value ?? '' }
        : blank,
    })
  }
  const edit = (patch: Partial<UserForm>) => {
    setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e))
    form.clear(...Object.keys(patch))
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing) return
    const input = userInput(editing.form, lookups)
    const found = Object.fromEntries(
      Object.entries(validateAccount(input)).map(([key, message]) => [userField(key), message]),
    )
    if (!form.check(found)) return
    const user = editing.user
    let invited: InviteResult | undefined
    const ok = await run(async () => {
      if (user)
        await updateUser(user.id, { name: input.name, role: input.role, pocId: input.pocId })
      else invited = await inviteUser(input)
      await refreshUsers()
    }, form.fail)
    if (!ok) return
    setEditing(null)
    if (invited) sent(invited)
    else onMessage(`${input.name} saved.`)
  }
  const resend = async (user: UserItem) => {
    let result: InviteResult | undefined
    const ok = await run(async () => {
      result = await resendInvite(user.id)
      await refreshUsers()
    })
    if (ok && result) sent(result)
  }
  const setStatus = (user: UserItem, status: 'active' | 'disabled') =>
    run(async () => {
      await updateUser(user.id, { status })
      await refreshUsers()
    })
  const remove = async (user: UserItem) => {
    if (!window.confirm(`Delete ${user.name}? They will no longer be able to sign in.`)) return
    await run(async () => {
      await deleteUser(user.id)
      await refreshUsers()
    })
  }
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-[#173b3d]">Users</h2>
        <Button size="sm" onClick={() => open(null)}>
          <Plus size={14} /> Invite user
        </Button>
      </div>
      <ul aria-label="Users" className="mt-4 divide-y divide-slate-100">
        {users.map((u) => (
          <li key={u.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-[#173b3d]">{u.name}</div>
                <div className="truncate text-xs text-slate-500">{u.email}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge tone="slate">{roleInfo[u.role].label}</Badge>
                <Badge
                  tone={u.status === 'active' ? 'green' : u.status === 'invited' ? 'blue' : 'amber'}
                >
                  {statusLabel[u.status]}
                </Badge>
              </div>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {u.poc && `POC ${u.poc.value} · `}Last sign-in{' '}
              {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => open(u)}>
                Edit
              </Button>
              {u.status === 'invited' && (
                <Button size="sm" variant="ghost" onClick={() => resend(u)}>
                  Resend invite
                </Button>
              )}
              {u.status === 'active' && (
                <Button size="sm" variant="ghost" onClick={() => setStatus(u, 'disabled')}>
                  Disable
                </Button>
              )}
              {u.status === 'disabled' && (
                <Button size="sm" variant="ghost" onClick={() => setStatus(u, 'active')}>
                  Enable
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => remove(u)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Modal
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(null)
        }}
        title={editing?.user ? 'Edit user' : 'Invite user'}
      >
        {editing && (
          <form onSubmit={submit} noValidate className="space-y-4">
            <FormError message={form.errors.form} />
            <Field label="Name" required error={form.errors.name}>
              <Input value={editing.form.name} onChange={(e) => edit({ name: e.target.value })} />
            </Field>
            {!editing.user && (
              <Field label="Email" required error={form.errors.email}>
                <Input
                  type="email"
                  value={editing.form.email}
                  onChange={(e) => edit({ email: e.target.value })}
                />
              </Field>
            )}
            <Field label="Role" required error={form.errors.role}>
              <Select
                value={editing.form.role}
                onChange={(e) => edit({ role: e.target.value as Role })}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {roleInfo[r].label}
                  </option>
                ))}
              </Select>
            </Field>
            {editing.form.role === 'poc' && (
              <Field label="Point of contact" required error={form.errors.poc}>
                <SearchSelect
                  value={editing.form.poc}
                  options={values(lookups, 'poc')}
                  onChange={(v) => edit({ poc: v })}
                />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit">{editing.user ? 'Save user' : 'Send invite'}</Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  )
}

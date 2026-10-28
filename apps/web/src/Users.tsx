import { useConfirm } from './ui'
import { useState, type FormEvent } from 'react'
import type { InviteResult, UserItem } from '@boat/domain/api'
import { roleInfo, roles } from '@boat/domain/permissions'
import { validateAccount } from '@boat/domain/validation'
import { Plus } from 'lucide-react'
import {
  deleteUser,
  inviteUser,
  updateUser,
  type UserForm,
  userField,
  userInput,
} from './api/admin'
import { values } from './api/mappers'
import { keys, useAuthOptions, useLookups, useUsers } from './api/queries'
import { queryClient } from './api/queryClient'
import type { Role } from '@boat/domain/models'
import {
  LoadingState,
  Empty,
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
// "28 Oct 2026, 13:48": the day first, as the rest of the app writes dates.
const signedInAt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

// Admins add users, change their role and POC link, and disable or delete them. The server
// refuses what would leave no active admin; that message shows in the form or as a toast.
export default function Users({ run, onMessage }: { run: Run; onMessage: (text: string) => void }) {
  const confirm = useConfirm()
  const usersQuery = useUsers(true)
  const users = usersQuery.data ?? []
  const lookups = useLookups().data ?? []
  const [editing, setEditing] = useState<{ user: UserItem | null; form: UserForm } | null>(null)
  const form = useFormErrors()
  // New users must be on a company domain; the placeholder shows which.
  const domains = useAuthOptions().data?.domains ?? []
  const emailPlaceholder = domains.length ? domains.map((d) => `name@${d}`).join(' or ') : undefined
  // The access email is a courtesy: they sign in with Google either way.
  const sent = (r: { accessEmailSent: boolean }) =>
    onMessage(
      r.accessEmailSent
        ? 'Access email sent.'
        : `The access email could not be sent. Ask them to sign in at ${window.location.origin} with their company Google account.`,
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
  const setStatus = (user: UserItem, status: 'active' | 'disabled') =>
    run(async () => {
      await updateUser(user.id, { status })
      await refreshUsers()
    })
  const remove = async (user: UserItem) => {
    if (!(await confirm(`Delete ${user.name}? They will no longer be able to sign in.`))) return
    await run(async () => {
      await deleteUser(user.id)
      await refreshUsers()
    })
  }
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="section-title">
            Users <span className="num ml-1 font-normal text-faint">{users.length}</span>
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            Who can sign in, their role, and the point of contact they work for.
          </p>
        </div>
        <Button variant="secondary" onClick={() => open(null)}>
          <Plus size={15} /> Add user
        </Button>
      </div>
      {usersQuery.isPending ? (
        <LoadingState label="Loading users" />
      ) : usersQuery.isError ? (
        <Empty
          title="Couldn't load users"
          description={usersQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => usersQuery.refetch()}>
              Try again
            </Button>
          }
        />
      ) : !users.length ? (
        <Empty
          title="No users yet"
          description="Add a teammate's company email to give them access."
        />
      ) : (
        <div
          className="table-wrap mt-4 rounded-lg border border-line"
          role="region"
          aria-label="User accounts"
          tabIndex={0}
        >
          <p className="border-b border-line-soft px-3 py-2 text-xs text-muted sm:hidden">
            Swipe horizontally to view all columns and actions.
          </p>
          <table aria-label="Users" className="data-table min-w-[760px]">
            <thead>
              <tr>
                {['User', 'Role', 'Status', 'Point of contact', 'Last sign-in', 'Actions'].map(
                  (label) => (
                    <th scope="col" key={label}>
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="font-medium text-ink">{u.name}</div>
                    <div className="mt-0.5 text-xs text-muted">{u.email}</div>
                  </td>
                  <td>
                    <Badge>{roleInfo[u.role].label}</Badge>
                  </td>
                  <td>
                    <Badge
                      tone={
                        u.status === 'active' ? 'green' : u.status === 'invited' ? 'blue' : 'amber'
                      }
                    >
                      {statusLabel[u.status]}
                    </Badge>
                  </td>
                  <td>{u.poc?.value ?? '—'}</td>
                  <td className="text-muted">
                    {u.lastLoginAt ? signedInAt.format(new Date(u.lastLoginAt)) : 'Never'}
                  </td>
                  <td>
                    <div className="-ml-2 flex gap-0.5">
                      <Button size="sm" variant="ghost" onClick={() => open(u)}>
                        Edit
                      </Button>
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
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                        onClick={() => remove(u)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(null)
        }}
        title={editing?.user ? 'Edit user' : 'Add user'}
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
                  placeholder={emailPlaceholder}
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
              <Button type="submit">{editing.user ? 'Save user' : 'Add user'}</Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  )
}

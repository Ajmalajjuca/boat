import { useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  Box,
  Copy,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  UserRound,
  UsersRound,
} from 'lucide-react'
import type { LookupValue, Role, UserProfile } from './models'
import { stamp, uid } from './models'
import { roleInfo, roles, useAccess } from './access'
import {
  changeOwnPin,
  checkPin,
  deleteUser,
  recoverAdmin,
  replaceRecoveryKey,
  saveUser,
  setLockMinutes,
  setupRoles,
  turnOffRoles,
} from './repository'
import { fieldErrors, validateUser } from './validation'
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

// Wrong PINs pause sign-in for this profile after a few tries, to slow down guessing.
const maxTries = 5,
  pauseMs = 30_000
const pinInput = {
  type: 'password',
  inputMode: 'numeric',
  autoComplete: 'off',
  maxLength: 8,
} as const

export function SignIn({
  users,
  onSignIn,
}: {
  users: UserProfile[]
  onSignIn: (user: UserProfile) => void
}) {
  const [picked, setPicked] = useState<UserProfile | null>(null),
    [pin, setPin] = useState(''),
    [recovering, setRecovering] = useState(false),
    [failures, setFailures] = useState<Record<string, { count: number; until: number }>>({}),
    [busy, setBusy] = useState(false)
  const form = useFormErrors()
  const sorted = [...users].sort((a, b) => a.name.localeCompare(b.name))
  const choose = (user: UserProfile) => {
    form.reset()
    setPin('')
    // A viewer without a PIN signs in straight away.
    if (!user.pinHash) onSignIn(user)
    else setPicked(user)
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!picked || busy) return
    const record = failures[picked.id]
    if (record && record.until > Date.now())
      return form.check({
        pin: `Too many wrong PINs. Try again in ${Math.ceil((record.until - Date.now()) / 1000)} seconds.`,
      })
    setBusy(true)
    const ok = await checkPin(picked, pin)
    setBusy(false)
    if (ok) {
      setFailures(({ [picked.id]: _, ...rest }) => rest)
      return onSignIn(picked)
    }
    // A finished pause starts the count again.
    const count = (record?.until ? 0 : record?.count || 0) + 1
    setFailures({
      ...failures,
      [picked.id]: { count, until: count >= maxTries ? Date.now() + pauseMs : 0 },
    })
    setPin('')
    form.check({
      pin:
        count >= maxTries
          ? 'Too many wrong PINs. Try again in 30 seconds.'
          : `Wrong PIN. ${maxTries - count} ${maxTries - count === 1 ? 'try' : 'tries'} left before a short pause.`,
    })
  }
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
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">
            {recovering ? 'Reset an admin PIN' : picked ? `Hi, ${picked.name}` : "Who's working?"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-teal-100">
            {recovering
              ? 'Enter the recovery key that was shown when roles were set up.'
              : picked
                ? `Enter your PIN to continue as ${roleInfo[picked.role].label}.`
                : 'Choose your profile. What you can change depends on its role.'}
          </p>
        </div>
        <div className="p-6">
          {recovering ? (
            <Recovery
              admins={sorted.filter((u) => u.role === 'admin')}
              onBack={() => setRecovering(false)}
              onDone={onSignIn}
            />
          ) : picked ? (
            <form onSubmit={submit} noValidate className="space-y-4">
              <Field label="PIN" error={form.errors.pin}>
                <Input
                  {...pinInput}
                  autoFocus
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, ''))
                    form.clear('pin')
                  }}
                />
              </Field>
              <div className="flex items-center justify-between gap-2">
                <Button type="button" variant="ghost" onClick={() => setPicked(null)}>
                  <ArrowLeft size={15} /> Other profile
                </Button>
                <Button type="submit" disabled={!pin || busy}>
                  <LockKeyhole size={15} /> Sign in
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-2">
              {sorted.map((user) => (
                <button
                  key={user.id}
                  onClick={() => choose(user)}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-teal-600 hover:bg-teal-50/40"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-bold text-teal-800">
                    {user.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[#173b3d]">
                      {user.name}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {user.role === 'poc' ? `POC for ${user.poc}` : roleInfo[user.role].label}
                      {!user.pinHash && ' · No PIN'}
                    </span>
                  </span>
                  <Badge tone={user.role === 'admin' ? 'amber' : 'teal'}>
                    {roleInfo[user.role].label}
                  </Badge>
                </button>
              ))}
              <button
                className="mt-2 text-xs font-semibold text-slate-500 underline-offset-2 hover:underline"
                onClick={() => setRecovering(true)}
              >
                Forgot the admin PIN?
              </button>
            </div>
          )}
          <p className="mt-5 border-t border-slate-100 pt-4 text-[11px] leading-5 text-slate-500">
            Roles prevent accidental changes on a shared computer. They are not a security boundary:
            data stays in this browser and is not encrypted.
          </p>
        </div>
      </Card>
    </div>
  )
}

function Recovery({
  admins,
  onBack,
  onDone,
}: {
  admins: UserProfile[]
  onBack: () => void
  onDone: (user: UserProfile) => void
}) {
  const [key, setKey] = useState(''),
    [adminId, setAdminId] = useState(admins[0]?.id || ''),
    [pin, setPin] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false)
  const form = useFormErrors()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      onDone(await recoverAdmin(key, adminId, pin, confirm))
    } catch (err) {
      form.fail(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormError message={form.errors.form} />
      <Field label="Recovery key" required error={form.errors.key}>
        <Input
          autoFocus
          autoComplete="off"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          value={key}
          onChange={(e) => {
            setKey(e.target.value)
            form.clear('key')
          }}
        />
      </Field>
      {admins.length > 1 && (
        <Field label="Admin profile" required error={form.errors.admin}>
          <select
            className="field"
            value={adminId}
            onChange={(e) => {
              setAdminId(e.target.value)
              form.clear('admin')
            }}
          >
            {admins.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="New PIN" required error={form.errors.pin}>
          <Input
            {...pinInput}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ''))
              form.clear('pin')
            }}
          />
        </Field>
        <Field label="Repeat new PIN" required error={form.errors.confirm}>
          <Input
            {...pinInput}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value.replace(/\D/g, ''))
              form.clear('confirm')
            }}
          />
        </Field>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </Button>
        <Button type="submit" disabled={busy}>
          <KeyRound size={15} /> Reset PIN & sign in
        </Button>
      </div>
    </form>
  )
}

export function ChangePinModal({
  user,
  open,
  onClose,
  onDone,
}: {
  user: UserProfile
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [current, setCurrent] = useState(''),
    [pin, setPin] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false)
  const form = useFormErrors()
  const close = () => {
    setCurrent('')
    setPin('')
    setConfirm('')
    form.reset()
    onClose()
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await changeOwnPin(user, current, pin, confirm)
      close()
      onDone()
    } catch (err) {
      form.fail(err)
      if (fieldErrors(err).current) setCurrent('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) close()
      }}
      title={user.pinHash ? 'Change your PIN' : 'Set a PIN'}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormError message={form.errors.form} />
        {user.pinHash && (
          <Field label="Current PIN" required error={form.errors.current}>
            <Input
              {...pinInput}
              autoFocus
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value.replace(/\D/g, ''))
                form.clear('current')
              }}
            />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="New PIN" required error={form.errors.pin} help="4 to 8 digits.">
            <Input
              {...pinInput}
              autoFocus={!user.pinHash}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ''))
                form.clear('pin')
              }}
            />
          </Field>
          <Field label="Repeat new PIN" required error={form.errors.confirm}>
            <Input
              {...pinInput}
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value.replace(/\D/g, ''))
                form.clear('confirm')
              }}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save PIN
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// Sidebar card: who is signed in, or a nudge to set up roles while access is open.
export function ProfileCard({
  user,
  onLock,
  onChangePin,
  onSetUp,
}: {
  user: UserProfile | null
  onLock: () => void
  onChangePin: () => void
  onSetUp: () => void
}) {
  if (!user)
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center gap-2 text-xs font-bold">
          <span className="h-2 w-2 rounded-full bg-amber-300" /> Open access
        </div>
        <div className="mt-2 text-[11px] leading-5 text-teal-100/70">
          Anyone using this browser can change everything.
        </div>
        <button
          onClick={onSetUp}
          className="mt-2 text-[11px] font-semibold text-[#f3a46a] hover:underline"
        >
          Set up roles
        </button>
      </div>
    )
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold">
          <UserRound size={15} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs font-bold">{user.name}</div>
          <div className="truncate text-[11px] text-teal-100/70">
            {user.role === 'poc' ? `POC · ${user.poc}` : roleInfo[user.role].label}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onLock}
          className="flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] font-semibold hover:bg-white/15"
        >
          Switch user
        </button>
        <button
          onClick={onChangePin}
          className="flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] font-semibold hover:bg-white/15"
        >
          {user.pinHash ? 'Change PIN' : 'Set PIN'}
        </button>
      </div>
    </div>
  )
}

export const lockChoices = [0, 5, 15, 30, 60]
const lockLabel = (m: number) => (m ? `After ${m} minutes idle` : 'Never')
const blankUser = (): UserProfile =>
  stamp({ name: '', role: 'planner' as Role, poc: '', pinHash: '', pinSalt: '' })

// Settings card for turning roles on, managing profiles, and the idle lock.
export function RolesCard({
  users,
  lookups,
  lockMinutes,
  run,
  onSignIn,
  onMessage,
}: {
  users: UserProfile[]
  lookups: LookupValue[]
  lockMinutes: number
  run: Run
  onSignIn: (userId: string) => void
  onMessage: (message: string) => void
}) {
  const access = useAccess()
  const [setup, setSetup] = useState({ name: '', pin: '', confirm: '' }),
    [editing, setEditing] = useState<UserProfile | null>(null),
    [pin, setPin] = useState({ pin: '', confirm: '' }),
    [recoveryKey, setRecoveryKey] = useState('')
  const setupForm = useFormErrors(),
    userForm = useFormErrors()
  const pocs = lookups
    .filter((v) => v.kind === 'poc')
    .sort((a, b) => a.sort - b.sort)
    .map((v) => v.value)
  const sorted = [...users].sort(
    (a, b) => roles.indexOf(a.role) - roles.indexOf(b.role) || a.name.localeCompare(b.name),
  )
  const turnOn = async (e: FormEvent) => {
    e.preventDefault()
    // Signing in first means the app never shows the profile screen between the save and
    // the sign-in.
    const id = uid()
    onSignIn(id)
    const result = { key: '' }
    const ok = await run(
      async () => {
        result.key = (await setupRoles(id, setup.name, setup.pin, setup.confirm)).recoveryKey
      },
      (err) => {
        onSignIn('')
        setupForm.fail(err)
      },
    )
    if (ok) {
      setSetup({ name: '', pin: '', confirm: '' })
      setRecoveryKey(result.key)
    }
  }
  const openUser = (user?: UserProfile) => {
    userForm.reset()
    setPin({ pin: '', confirm: '' })
    setEditing(user || blankUser())
  }
  const stored = !!editing && users.some((u) => u.id === editing.id)
  const saveProfile = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing || !userForm.check(validateUser(editing, pin.pin, pin.confirm))) return
    if (await run(() => saveUser(editing, pin.pin, pin.confirm), userForm.fail)) {
      onMessage(`Profile ${editing.name.trim()} saved.`)
      setEditing(null)
    }
  }
  const removeProfile = async () => {
    if (!editing || !window.confirm(`Delete the profile ${editing.name}?`)) return
    if (await run(() => deleteUser(editing, access.user?.id || ''), userForm.fail)) {
      onMessage(`Profile ${editing.name} deleted.`)
      setEditing(null)
    }
  }
  const newKey = async () => {
    if (!window.confirm('Create a new recovery key? The old key will stop working.')) return
    const result = { key: '' }
    if (
      await run(async () => {
        result.key = await replaceRecoveryKey()
      })
    )
      setRecoveryKey(result.key)
  }
  const turnOff = async () => {
    if (
      !window.confirm(
        'Turn roles off? All profiles and PINs are deleted and anyone using this browser can change everything again.',
      )
    )
      return
    if (await run(turnOffRoles)) onMessage('Roles turned off. Access is open.')
  }
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <UsersRound size={19} className="shrink-0 text-[#d96d35]" />
        <div>
          <h2 className="font-bold text-[#173b3d]">Users & roles</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Profiles decide who can change what in this browser. They stop accidental edits on a
            shared computer but are not a security boundary. Profiles stay on this device and are
            not part of JSON backups.
          </p>
        </div>
      </div>
      {!access.enabled ? (
        <form onSubmit={turnOn} noValidate className="mt-5 space-y-3">
          <FormError message={setupForm.errors.form} />
          <p className="text-xs font-semibold text-slate-600">
            Create the first admin profile to turn roles on.
          </p>
          <Field label="Your name" required error={setupForm.errors.name}>
            <Input
              value={setup.name}
              onChange={(e) => {
                setSetup({ ...setup, name: e.target.value })
                setupForm.clear('name')
              }}
              placeholder="e.g. Asha"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Admin PIN" required error={setupForm.errors.pin} help="4 to 8 digits.">
              <Input
                {...pinInput}
                value={setup.pin}
                onChange={(e) => {
                  setSetup({ ...setup, pin: e.target.value.replace(/\D/g, '') })
                  setupForm.clear('pin')
                }}
              />
            </Field>
            <Field label="Repeat PIN" required error={setupForm.errors.confirm}>
              <Input
                {...pinInput}
                value={setup.confirm}
                onChange={(e) => {
                  setSetup({ ...setup, confirm: e.target.value.replace(/\D/g, '') })
                  setupForm.clear('confirm')
                }}
              />
            </Field>
          </div>
          <Button type="submit" className="w-full">
            <LockKeyhole size={16} /> Turn on roles
          </Button>
        </form>
      ) : !access.can('manageSettings') ? (
        <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          You are signed in as <b>{access.user?.name}</b> (
          {access.user && roleInfo[access.user.role].label}).{' '}
          {access.user && roleInfo[access.user.role].description} Only admins can manage profiles.
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="space-y-2">
            {sorted.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-700">
                    {user.name}
                    {user.id === access.user?.id && (
                      <span className="ml-1 text-xs font-normal text-slate-500">(you)</span>
                    )}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {user.role === 'poc' ? `Owns ${user.poc}` : roleInfo[user.role].label}
                    {!user.pinHash && ' · No PIN'}
                    {user.role === 'poc' && !pocs.includes(user.poc) && (
                      <span className="text-rose-700"> · POC value missing</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge tone={user.role === 'admin' ? 'amber' : 'teal'}>
                    {roleInfo[user.role].label}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${user.name}`}
                    onClick={() => openUser(user)}
                  >
                    <Pencil size={15} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button variant="secondary" className="w-full" onClick={() => openUser()}>
            <Plus size={16} /> Add profile
          </Button>
          <Field label="Lock the app" help="Returns to the profile screen when nobody uses it.">
            <Select
              value={lockMinutes}
              onChange={(e) => run(() => setLockMinutes(Number(e.target.value)))}
            >
              {lockChoices.map((m) => (
                <option key={m} value={m}>
                  {lockLabel(m)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="secondary" size="sm" onClick={newKey}>
              <KeyRound size={14} /> New recovery key
            </Button>
            <Button variant="danger" size="sm" onClick={turnOff}>
              Turn off roles
            </Button>
          </div>
        </div>
      )}
      <Modal
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(null)
        }}
        title={stored ? 'Edit profile' : 'Add profile'}
      >
        {editing && (
          <form onSubmit={saveProfile} noValidate className="space-y-4">
            <FormError message={userForm.errors.form} />
            <Field label="Name" required error={userForm.errors.name}>
              <Input
                autoFocus
                value={editing.name}
                onChange={(e) => {
                  setEditing({ ...editing, name: e.target.value })
                  userForm.clear('name')
                }}
              />
            </Field>
            <Field
              label="Role"
              required
              error={userForm.errors.role}
              help={roleInfo[editing.role].description}
            >
              <Select
                value={editing.role}
                onChange={(e) => {
                  setEditing({ ...editing, role: e.target.value as Role })
                  userForm.clear('role', 'poc', 'pin')
                }}
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {roleInfo[role].label}
                  </option>
                ))}
              </Select>
            </Field>
            {editing.role === 'poc' && (
              <Field
                label="Point of contact"
                required
                error={userForm.errors.poc}
                help="This profile can update lots whose POC is this value."
              >
                <SearchSelect
                  value={editing.poc}
                  options={pocs}
                  onChange={(v) => {
                    setEditing({ ...editing, poc: v })
                    userForm.clear('poc')
                  }}
                />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={editing.pinHash ? 'New PIN' : 'PIN'}
                required={!editing.pinHash && editing.role !== 'viewer'}
                error={userForm.errors.pin}
                help={
                  editing.pinHash
                    ? 'Leave blank to keep the current PIN.'
                    : editing.role === 'viewer'
                      ? 'Optional for viewers.'
                      : '4 to 8 digits.'
                }
              >
                <Input
                  {...pinInput}
                  value={pin.pin}
                  onChange={(e) => {
                    setPin({ ...pin, pin: e.target.value.replace(/\D/g, '') })
                    userForm.clear('pin')
                  }}
                />
              </Field>
              <Field label="Repeat PIN" error={userForm.errors.confirm}>
                <Input
                  {...pinInput}
                  value={pin.confirm}
                  onChange={(e) => {
                    setPin({ ...pin, confirm: e.target.value.replace(/\D/g, '') })
                    userForm.clear('confirm')
                  }}
                />
              </Field>
            </div>
            <div className="flex items-center justify-between gap-2 pt-2">
              <div>
                {stored && editing.id !== access.user?.id && (
                  <Button type="button" variant="danger" size="sm" onClick={removeProfile}>
                    Delete profile
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit">Save profile</Button>
              </div>
            </div>
          </form>
        )}
      </Modal>
      <RecoveryKeyModal recoveryKey={recoveryKey} onClose={() => setRecoveryKey('')} />
    </Card>
  )
}

function RecoveryKeyModal({ recoveryKey, onClose }: { recoveryKey: string; onClose: () => void }) {
  const [saved, setSaved] = useState(false),
    [copied, setCopied] = useState(false)
  const close = () => {
    setSaved(false)
    setCopied(false)
    onClose()
  }
  return (
    <Modal
      open={!!recoveryKey}
      onOpenChange={(v) => {
        if (!v && saved) close()
      }}
      title="Save your recovery key"
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-slate-600">
          If every admin forgets their PIN, this key lets you reset one from the profile screen. It
          is shown only now. Write it down or store it in a password manager.
        </p>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <code
            className="flex-1 whitespace-nowrap text-center font-mono text-base font-bold tracking-wider text-[#173b3d] sm:text-lg sm:tracking-widest"
            aria-label="Recovery key"
          >
            {recoveryKey}
          </code>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(recoveryKey)
                setCopied(true)
              } catch {
                setCopied(false)
              }
            }}
          >
            <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I
          have saved this key somewhere safe
        </label>
        <div className="flex justify-end">
          <Button disabled={!saved} onClick={close}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}

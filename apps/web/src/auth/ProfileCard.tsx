import { roleInfo } from '@boat/domain/permissions'
import { KeyRound, LogOut } from 'lucide-react'
import { useAuth } from './AuthProvider'

// Up to two initials, for the avatar.
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')

export function ProfileCard({ onChangePassword }: { onChangePassword: () => void }) {
  const auth = useAuth(),
    user = auth.me?.user
  if (!user) return null
  const action =
    'flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white'
  return (
    <div className="rounded-lg border border-white/10 bg-white/[.04]">
      <div className="flex items-center gap-3 px-3 py-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/12 text-[13px] font-semibold"
        >
          {initials(user.name)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{user.name}</div>
          <div className="truncate text-xs text-white/55">
            {user.role === 'poc'
              ? `POC · ${user.poc?.value ?? 'not linked'}`
              : roleInfo[user.role].label}
          </div>
        </div>
      </div>
      <div className="flex gap-1 border-t border-white/10 p-1">
        <button onClick={() => void auth.signOut()} className={action}>
          <LogOut size={13} aria-hidden="true" /> Sign out
        </button>
        {/* Only the backup admin has a password; everyone else signs in with Google. */}
        {user.passwordLogin && (
          <button onClick={onChangePassword} className={action}>
            <KeyRound size={13} aria-hidden="true" /> Change password
          </button>
        )}
      </div>
    </div>
  )
}

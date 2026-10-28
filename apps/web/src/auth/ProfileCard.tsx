import { roleInfo } from '@boat/domain/permissions'
import { UserRound } from 'lucide-react'
import { useAuth } from './AuthProvider'

export function ProfileCard({ onChangePassword }: { onChangePassword: () => void }) {
  const auth = useAuth(),
    user = auth.me?.user
  if (!user) return null
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold">
          <UserRound size={15} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs font-bold">{user.name}</div>
          <div className="truncate text-[11px] text-white/50">
            {user.role === 'poc'
              ? `POC · ${user.poc?.value ?? 'not linked'}`
              : roleInfo[user.role].label}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void auth.signOut()}
          className="flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] font-semibold hover:bg-white/15"
        >
          Sign out
        </button>
        {/* Only the backup admin has a password; everyone else signs in with Google. */}
        {user.passwordLogin && (
          <button
            onClick={onChangePassword}
            className="flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] font-semibold hover:bg-white/15"
          >
            Change password
          </button>
        )}
      </div>
    </div>
  )
}

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { fieldErrors, type FieldErrors } from '@boat/domain/validation'
import { Check, ChevronDown, CircleAlert, Eye, EyeOff, LoaderCircle, Lock, X } from 'lucide-react'
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

export const cn = (...values: ClassValue[]) => twMerge(clsx(values))
// Runs a save; on failure it calls onError (forms show field errors) or shows a toast.
export type Run = (fn: () => Promise<unknown>, onError?: (e: unknown) => void) => Promise<boolean>
export const SavingContext = createContext(false)

export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-3" aria-label="Boat OS">
      <img
        src={dark ? '/boat-logo-white.svg' : '/boat-logo.svg'}
        alt="boAt"
        width="88"
        height="36"
      />
      <span
        className={cn(
          'border-l pl-3 text-lg font-bold tracking-tight',
          dark ? 'border-white/20 text-white' : 'border-line text-ink',
        )}
      >
        OS
      </span>
    </div>
  )
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-5 p-5 sm:p-7">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted">
        <LoaderCircle size={18} aria-hidden="true" className="animate-spin text-brand" />
        {label}…
      </div>
      <div aria-hidden="true" className="space-y-3">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex gap-4 rounded-lg border border-line-soft p-4">
            <span className="skeleton h-9 w-9 rounded-lg" />
            <span className="flex-1 space-y-2">
              <span className="skeleton block h-3 w-2/5 rounded" />
              <span className="skeleton block h-3 w-3/4 rounded" />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const ConfirmationContext = createContext<(message: string) => Promise<boolean>>(() =>
  Promise.resolve(false),
)
export const useConfirm = () => useContext(ConfirmationContext)
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')
  const resolve = useRef<((confirmed: boolean) => void) | null>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const finish = (confirmed: boolean) => {
    resolve.current?.(confirmed)
    resolve.current = null
    setMessage('')
  }
  const confirm = (text: string) =>
    new Promise<boolean>((done) => {
      resolve.current?.(false)
      resolve.current = done
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      setMessage(text)
    })
  useEffect(
    () => () => {
      resolve.current?.(false)
    },
    [],
  )
  const discard = message.startsWith('Discard')
  return (
    <ConfirmationContext.Provider value={confirm}>
      {children}
      <DialogPrimitive.Root
        open={!!message}
        onOpenChange={(open) => {
          if (!open) finish(false)
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-ink/55" />
          <DialogPrimitive.Content
            role="alertdialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              cancel.current?.focus()
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              // The originating button becomes enabled after its confirmation promise settles.
              requestAnimationFrame(() => returnFocus.current?.focus())
            }}
            className="fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 shadow-[0_24px_60px_rgba(16,24,40,.25)] outline-none"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-brand-wash text-brand">
              <CircleAlert size={20} />
            </div>
            <DialogPrimitive.Title className="screen-title text-lg text-ink">
              {discard ? 'Discard changes?' : 'Confirm action'}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-2 text-sm leading-6 text-ink-2">
              {message}
            </DialogPrimitive.Description>
            <div className="mt-6 flex justify-end gap-2">
              <button
                ref={cancel}
                type="button"
                className={buttonVariants({ variant: 'secondary' })}
                onClick={() => finish(false)}
              >
                Cancel
              </button>
              <Button variant="danger" onClick={() => finish(true)}>
                {discard ? 'Discard changes' : 'Confirm'}
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </ConfirmationContext.Provider>
  )
}
export function useFormErrors() {
  const [errors, setErrors] = useState<FieldErrors>({})
  return {
    errors,
    // Applies client-side validation results; returns true when the form may be saved.
    check(found: FieldErrors) {
      setErrors(found)
      if (!Object.keys(found).length) return true
      focusFirstError()
      return false
    },
    fail(e: unknown) {
      setErrors(fieldErrors(e))
      focusFirstError()
    },
    clear(...fields: string[]) {
      setErrors((prev) => {
        if (!prev.form && !fields.some((f) => prev[f])) return prev
        const next = { ...prev }
        for (const f of fields) delete next[f]
        delete next.form
        return next
      })
    },
    reset: () => setErrors({}),
  }
}
// Radix listens for Escape in the capture phase, so an open SearchSelect must veto closing its dialog.
const keepOpenForSearch = (e: KeyboardEvent) => {
  if (e.target instanceof Element && e.target.closest('[data-search-open]')) e.preventDefault()
}
// Toasts sit above dialogs; interacting with one must not dismiss the dialog underneath.
const keepOpenForToast = (e: Event) => {
  if (e.target instanceof Element && e.target.closest('[data-toast]')) e.preventDefault()
}
// Moves focus to the first invalid field in the top-most dialog (or the page) after a failed save.
export function focusFirstError() {
  // Waits a moment so a tab switch triggered by the same failure has rendered.
  setTimeout(() => {
    const dialogs = document.querySelectorAll('[role=dialog]')
    const scope = dialogs[dialogs.length - 1] || document
    const field = scope.querySelector<HTMLElement>(
      '[data-invalid] input, [data-invalid] textarea, [data-invalid] select, [data-invalid] button',
    )
    const target = field || scope.querySelector<HTMLElement>('[data-form-error]')
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    field?.focus({ preventScroll: true })
  }, 60)
}
export function FormError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <div
      role="alert"
      data-form-error
      className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800"
    >
      <CircleAlert size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-45 cursor-pointer [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-brand text-white hover:bg-brand-deep active:bg-brand-deep',
        secondary:
          'bg-white text-ink border border-line hover:border-[#c6cdd2] hover:bg-wash active:bg-line-soft',
        ghost: 'text-ink-2 hover:bg-ink/[.06] hover:text-ink',
        danger:
          'bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 hover:border-rose-300',
        teal: 'bg-ink text-white hover:bg-black',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 gap-1.5 px-3 text-[13px]',
        icon: 'h-9 w-9',
        lg: 'h-11 px-5 text-[15px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)
export function Button({
  className,
  variant,
  size,
  loading = false,
  children,
  onClick,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { loading?: boolean }) {
  const [pending, setPending] = useState(false)
  const saving = useContext(SavingContext)
  const busy = loading || pending || (saving && props.type === 'submit')
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={async (event) => {
        if (busy) return
        const result: unknown = onClick?.(event)
        if (result && typeof (result as unknown as Promise<unknown>).then === 'function') {
          setPending(true)
          try {
            await result
          } finally {
            setPending(false)
          }
        }
      }}
    >
      {busy && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}
// The caption id of the enclosing Field. Controls name themselves by the caption alone, because
// the wrapping <label> also contains the control's own text (a textarea's value, a select's options).
const FieldCaption = createContext<{ id: string; label: string } | undefined>(undefined)
const useCaption = (props: { 'aria-label'?: string; 'aria-labelledby'?: string }) => {
  const caption = useContext(FieldCaption)
  return props['aria-label'] ? props['aria-labelledby'] : (props['aria-labelledby'] ?? caption?.id)
}
export function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false)
  const caption = useCaption(props)
  const field = useContext(FieldCaption)
  const id = useId()
  if (type !== 'password')
    return (
      <input type={type} className={cn('field', className)} aria-labelledby={caption} {...props} />
    )
  return (
    <span className="relative block">
      <input
        className={cn('field pr-12', className)}
        aria-labelledby={caption}
        {...props}
        id={props.id ?? id}
        type={visible ? 'text' : 'password'}
      />
      <button
        type="button"
        disabled={props.disabled}
        aria-label={`${visible ? 'Hide' : 'Show'} ${(field?.label || props['aria-label'] || 'password').toLowerCase()}`}
        aria-controls={props.id ?? id}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted hover:text-ink"
        onClick={(event) => {
          event.preventDefault()
          setVisible(!visible)
        }}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </span>
  )
}
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn('field min-h-20 resize-y', className)}
      aria-labelledby={useCaption(props)}
      {...props}
    />
  )
}
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('field', className)} aria-labelledby={useCaption(props)} {...props}>
      {children}
    </select>
  )
}
export function Field({
  label,
  help,
  error,
  required,
  locked,
  children,
  className,
}: {
  label: string
  help?: string
  error?: string
  required?: boolean
  // Shows the value but disables the control because the current role cannot change it.
  locked?: boolean
  children: ReactNode
  className?: string
}) {
  // A disabled fieldset disables every control inside it, including SearchSelect's button.
  const Outer = locked ? 'fieldset' : 'div'
  const captionId = useId()
  return (
    // Error and help text sit outside the <label> so they are not read as part of the field name.
    <Outer
      className={cn('block min-w-0', className)}
      data-invalid={error ? true : undefined}
      disabled={locked || undefined}
    >
      <label className="block">
        <span
          id={captionId}
          className="field-label"
          data-required={(required && !locked) || undefined}
        >
          {label}
          {locked && (
            <span title="Your role cannot change this field" aria-hidden="true">
              <Lock size={11} className="ml-1 inline align-[-1px] text-faint" />
            </span>
          )}
        </span>
        <FieldCaption.Provider value={{ id: captionId, label }}>{children}</FieldCaption.Provider>
      </label>
      {error ? (
        <span
          role="alert"
          className="mt-1.5 flex items-start gap-1 text-[13px] font-medium text-rose-700"
        >
          <CircleAlert size={13} className="mt-px shrink-0" />
          {error}
        </span>
      ) : (
        help && <span className="mt-1.5 block text-[13px] leading-snug text-muted">{help}</span>
      )}
    </Outer>
  )
}
export function Badge({
  children,
  tone = 'slate',
  className,
}: {
  children: ReactNode
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'teal'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-xs font-semibold leading-4 whitespace-nowrap ring-1 ring-inset',
        {
          slate: 'bg-wash text-ink-2 ring-line',
          green: 'bg-emerald-50 text-emerald-800 ring-emerald-200/80',
          amber: 'bg-amber-50 text-amber-800 ring-amber-200/80',
          red: 'bg-rose-50 text-rose-700 ring-rose-200/80',
          blue: 'bg-sky-50 text-sky-800 ring-sky-200/80',
          teal: 'bg-teal-50 text-teal-800 ring-teal-200/80',
        }[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)]',
        className,
      )}
    >
      {children}
    </div>
  )
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-line bg-white px-6 py-10 text-center">
      <div className="mb-3 rounded-full bg-canvas p-3 text-faint">
        <Check size={22} />
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
export function Sheet({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  width = 'wide',
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  width?: 'wide' | 'medium'
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/45" />
        <DialogPrimitive.Content
          data-sheet
          onEscapeKeyDown={keepOpenForSearch}
          onPointerDownOutside={keepOpenForToast}
          onInteractOutside={keepOpenForToast}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-wash shadow-[-12px_0_40px_rgba(16,24,40,.18)] outline-none',
            width === 'wide' ? 'max-w-[800px]' : 'max-w-[560px]',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line bg-white px-5 py-4 sm:px-7 sm:py-5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="screen-title truncate text-xl text-ink">
                {title}
              </DialogPrimitive.Title>
              {subtitle && (
                <DialogPrimitive.Description className="mt-1 text-sm text-muted">
                  {subtitle}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Close">
                <X size={18} />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">{children}</div>
          {footer && (
            <div className="border-t border-line bg-white px-5 py-3 sm:px-7 sm:py-4">{footer}</div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
export function Modal({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-ink/45" />
        {/* Centred with flexbox, not a transform, so fixed-position dropdowns are not clipped. */}
        <div className="pointer-events-none fixed inset-0 z-[71] flex items-center justify-center p-4">
          <DialogPrimitive.Content
            onEscapeKeyDown={keepOpenForSearch}
            onPointerDownOutside={keepOpenForToast}
            onInteractOutside={keepOpenForToast}
            className="pointer-events-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-[0_24px_60px_rgba(16,24,40,.22)] outline-none sm:p-6"
          >
            <div className="-mt-1 mb-5 flex items-center justify-between gap-3">
              <DialogPrimitive.Title className="screen-title text-xl text-ink">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="Close">
                  <X size={18} />
                </Button>
              </DialogPrimitive.Close>
            </div>
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            {children}
            {footer && (
              <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-line-soft pt-4">
                {footer}
              </div>
            )}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled = false,
  clearable = false,
}: {
  value: string
  onChange: (value: string) => void
  options: (string | { value: string; label: string })[]
  placeholder?: string
  disabled?: boolean
  clearable?: boolean
}) {
  const [open, setOpen] = useState(false),
    [term, setTerm] = useState(''),
    [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    [position, setPosition] = useState<CSSProperties>({})
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  // The list is fixed to the viewport so scrolling modals and drawers cannot clip it. It opens
  // upward when there is not enough room below the field.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const below = window.innerHeight - rect.bottom
      setPosition(
        below < 280 && rect.top > below
          ? { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top + 4 }
          : { left: rect.left, width: rect.width, top: rect.bottom + 4 },
      )
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])
  const normalized = options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  )
  const matches = normalized.filter((option) =>
    option.label.toLowerCase().includes(term.toLowerCase()),
  )
  const selected = normalized.find((option) => option.value === value)
  return (
    <div ref={root} className="relative" data-search-open={open || undefined}>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          setTerm('')
          setActive(0)
        }}
        className="field flex w-full items-center justify-between text-left"
      >
        <span className={cn('truncate', value ? 'text-ink' : 'text-faint')}>
          {selected?.label || value || placeholder}
        </span>
        <ChevronDown size={15} className="shrink-0 text-faint" />
      </button>
      {open && (
        <div
          style={position}
          // Inside a <label>, clicks on non-button areas would re-trigger the toggle button.
          onClick={(e) => e.preventDefault()}
          className="fixed z-[80] rounded-xl border border-line bg-white p-1 shadow-xl"
        >
          <input
            autoFocus
            aria-label="Search options"
            className="w-full border-b border-line-soft px-2 py-2 text-sm outline-none"
            placeholder="Search..."
            value={term}
            onChange={(e) => {
              setTerm(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setOpen(false)
              }
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((index) =>
                  matches.length
                    ? (index + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length
                    : 0,
                )
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                if (matches[active]) onChange(matches[active].value)
                setOpen(false)
              }
            }}
          />
          <div className="max-h-56 overflow-y-auto" role="listbox">
            {clearable && value && (
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
                className="flex w-full items-center rounded-lg px-2 py-2 text-left text-sm text-muted hover:bg-canvas focus:bg-canvas"
              >
                Clear selection
              </button>
            )}
            {matches.length ? (
              matches.map((option, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  key={option.value}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-canvas focus:bg-canvas ${index === active ? 'bg-wash' : ''}`}
                >
                  {option.label}
                  {option.value === value && <Check size={14} className="text-teal-700" />}
                </button>
              ))
            ) : (
              <div className="px-2 py-3 text-xs text-muted">
                No matching values. Add one in Settings.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// A CSV button's action: false when the current view has no rows.
export type CsvExport = () => boolean | Promise<boolean>

// "1–50 of 312" with Previous and Next, for lists the server pages.
export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  if (total <= pageSize) return null
  const first = (page - 1) * pageSize + 1,
    last = Math.min(total, page * pageSize)
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-3 text-xs text-ink-2 sm:px-5">
      <span>
        {first}–{last} of {total}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={last >= total}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

// Shown when a save meets a newer version. Reload replaces the form with the server's record;
// keeping the edits means the next save is refused again until the user reloads.
export function ConflictBanner({
  record,
  onReload,
  onDismiss,
}: {
  record: 'lot' | 'product' | 'shipment'
  onReload: () => void
  onDismiss: () => void
}) {
  return (
    <div
      role="alert"
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <span>
        Someone else changed this {record} while you were editing. Reload to see their version —
        your unsaved changes will be lost.
      </span>
      <span className="flex gap-2">
        <Button type="button" size="sm" onClick={onReload}>
          Reload
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDismiss}>
          Keep editing
        </Button>
      </span>
    </div>
  )
}

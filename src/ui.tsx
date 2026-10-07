import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { fieldErrors, type FieldErrors } from './validation'
import { Check, ChevronDown, CircleAlert, X } from 'lucide-react'
import {
  useEffect,
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
      className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800"
    >
      <CircleAlert size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-[#db6d32] text-white hover:bg-[#c65d29] shadow-sm',
        secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50',
        ghost: 'text-slate-600 hover:bg-slate-100',
        danger: 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200',
        teal: 'bg-[#123b3e] text-white hover:bg-[#0c2e31]',
      },
      size: { default: 'h-10 px-4', sm: 'h-8 px-3 text-xs', icon: 'h-9 w-9', lg: 'h-11 px-5' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)
export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('field', className)} {...props} />
}
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('field min-h-20 resize-y', className)} {...props} />
}
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('field', className)} {...props}>
      {children}
    </select>
  )
}
export function Field({
  label,
  help,
  error,
  required,
  children,
  className,
}: {
  label: string
  help?: string
  error?: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    // Error and help text sit outside the <label> so they are not read as part of the field name.
    <div className={cn('block min-w-0', className)} data-invalid={error ? true : undefined}>
      <label className="block">
        <span className="field-label">
          {label}
          {required && (
            <span className="ml-0.5 text-rose-600" aria-hidden="true">
              *
            </span>
          )}
        </span>
        {children}
      </label>
      {error ? (
        <span
          role="alert"
          className="mt-1 flex items-start gap-1 text-xs font-medium text-rose-700"
        >
          <CircleAlert size={13} className="mt-px shrink-0" />
          {error}
        </span>
      ) : (
        help && <span className="mt-1 block text-xs text-slate-500">{help}</span>
      )}
    </div>
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
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold leading-none whitespace-nowrap',
        {
          slate: 'bg-slate-100 text-slate-600',
          green: 'bg-emerald-50 text-emerald-700',
          amber: 'bg-amber-50 text-amber-700',
          red: 'bg-rose-50 text-rose-700',
          blue: 'bg-sky-50 text-sky-700',
          teal: 'bg-teal-50 text-teal-700',
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
        'rounded-2xl border border-slate-200 bg-white shadow-[0_2px_14px_rgba(15,23,42,.035)]',
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
    <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">
        <Check size={22} />
      </div>
      <h3 className="font-semibold text-slate-800">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
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
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[#092a2d]/50 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          onEscapeKeyDown={keepOpenForSearch}
          onPointerDownOutside={keepOpenForToast}
          onInteractOutside={keepOpenForToast}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-[#f8faf9] shadow-2xl outline-none',
            width === 'wide' ? 'max-w-[780px]' : 'max-w-[560px]',
          )}
        >
          <div className="flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
            <div>
              <DialogPrimitive.Title className="text-lg font-bold text-[#173b3d]">
                {title}
              </DialogPrimitive.Title>
              {subtitle && (
                <DialogPrimitive.Description className="mt-1 text-sm text-slate-500">
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
            <div className="border-t border-slate-200 bg-white px-5 py-4 sm:px-7">{footer}</div>
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
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-[#092a2d]/50" />
        {/* Centred with flexbox, not a transform, so fixed-position dropdowns are not clipped. */}
        <div className="pointer-events-none fixed inset-0 z-[71] flex items-center justify-center p-4">
          <DialogPrimitive.Content
            onEscapeKeyDown={keepOpenForSearch}
            onPointerDownOutside={keepOpenForToast}
            onInteractOutside={keepOpenForToast}
            className="pointer-events-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl outline-none sm:p-6"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <DialogPrimitive.Title className="text-lg font-bold text-[#173b3d]">
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
            {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
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
        className="field flex w-full items-center justify-between text-left disabled:opacity-50"
      >
        <span className={cn('truncate', value ? 'text-slate-800' : 'text-slate-400')}>
          {selected?.label || value || placeholder}
        </span>
        <ChevronDown size={15} className="shrink-0 text-slate-400" />
      </button>
      {open && (
        <div
          style={position}
          // Inside a <label>, clicks on non-button areas would re-trigger the toggle button.
          onClick={(e) => e.preventDefault()}
          className="fixed z-[80] rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
        >
          <input
            autoFocus
            aria-label="Search options"
            className="w-full border-b border-slate-100 px-2 py-2 text-sm outline-none"
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
                className="flex w-full items-center rounded-lg px-2 py-2 text-left text-sm text-slate-500 hover:bg-slate-100 focus:bg-slate-100"
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
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-100 focus:bg-slate-100 ${index === active ? 'bg-slate-50' : ''}`}
                >
                  {option.label}
                  {option.value === value && <Check size={14} className="text-teal-700" />}
                </button>
              ))
            ) : (
              <div className="px-2 py-3 text-xs text-slate-500">
                No matching values. Add one in Settings.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

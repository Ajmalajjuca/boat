import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { Check, ChevronDown, X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

export const cn = (...values: ClassValue[]) => twMerge(clsx(values))
// Radix listens for Escape in the capture phase, so an open SearchSelect must veto closing its dialog.
const keepOpenForSearch = (e: KeyboardEvent) => {
  if (e.target instanceof Element && e.target.closest('[data-search-open]')) e.preventDefault()
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
  children,
  className,
}: {
  label: string
  help?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="field-label">{label}</span>
      {children}
      {help && <span className="mt-1 block text-xs text-slate-500">{help}</span>}
    </label>
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
        <DialogPrimitive.Content
          onEscapeKeyDown={keepOpenForSearch}
          className="fixed left-1/2 top-1/2 z-[71] max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl outline-none"
        >
          <div className="mb-5 flex items-start justify-between">
            <DialogPrimitive.Title className="text-lg font-bold text-[#173b3d]">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Close">
                <X size={18} />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {children}
          {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
        </DialogPrimitive.Content>
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
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
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
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(!open)
          setTerm('')
          setActive(0)
        }}
        className="field flex w-full items-center justify-between text-left disabled:opacity-50"
      >
        <span className={value ? 'text-slate-800' : 'text-slate-400'}>
          {selected?.label || value || placeholder}
        </span>
        <ChevronDown size={15} className="text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
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
          <div className="max-h-48 overflow-y-auto">
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

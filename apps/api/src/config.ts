import { z } from 'zod'

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    // Connection as boat_app. On Neon this is the pooled URL.
    DATABASE_URL: z.string().min(1),
    // Signs CSRF tokens. Generate with: openssl rand -base64 48
    SESSION_SECRET: z.string().min(32),
    // The web app's address. Invite and password-reset links point here.
    APP_URL: z.url().default('http://localhost:5173'),
    // Email goes through Resend or SMTP, whichever is set. Neither in development: emails go to
    // the log instead.
    RESEND_API_KEY: z.string().min(1).optional(),
    // e.g. smtp.gmail.com with the account's address and an App Password.
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(465),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    // Resend: a sender on its verified domain, e.g. "BOAT <noreply@example.com>". SMTP: the
    // account's own address, which Gmail uses whatever this says.
    MAIL_FROM: z.string().min(1).optional(),
    // Proxy hops in front of the app (Render: 1). Rate limits key on the client IP behind them.
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    // GRN receipts are hidden for now; on brings back their screens and routes.
    FEATURE_GRN: z.stringbool().default(false),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message })
    if (c.RESEND_API_KEY && c.SMTP_HOST)
      issue('SMTP_HOST', 'set either RESEND_API_KEY or SMTP_HOST')
    if (c.RESEND_API_KEY && !c.MAIL_FROM) issue('MAIL_FROM', 'required when RESEND_API_KEY is set')
    if (c.SMTP_HOST) {
      if (!c.SMTP_USER) issue('SMTP_USER', 'required when SMTP_HOST is set')
      if (!c.SMTP_PASS) issue('SMTP_PASS', 'required when SMTP_HOST is set')
      if (!c.MAIL_FROM) issue('MAIL_FROM', 'required when SMTP_HOST is set')
    }
    if (c.NODE_ENV !== 'production') return
    if (!c.RESEND_API_KEY && !c.SMTP_HOST)
      issue('RESEND_API_KEY', 'RESEND_API_KEY or SMTP_HOST is required in production')
    if (!c.APP_URL.startsWith('https://')) issue('APP_URL', 'must use https in production')
  })
export type Config = z.infer<typeof schema>

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success)
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    )
  return parsed.data
}

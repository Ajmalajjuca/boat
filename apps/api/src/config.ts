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
    // Unset in development: emails go to the log instead.
    RESEND_API_KEY: z.string().min(1).optional(),
    // A sender on the domain verified in Resend, e.g. "BOAT <noreply@example.com>".
    MAIL_FROM: z.string().min(1).optional(),
    // Proxy hops in front of the app (Render: 1). Rate limits key on the client IP behind them.
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message })
    if (c.RESEND_API_KEY && !c.MAIL_FROM) issue('MAIL_FROM', 'required when RESEND_API_KEY is set')
    if (c.NODE_ENV !== 'production') return
    if (!c.RESEND_API_KEY) issue('RESEND_API_KEY', 'required in production')
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

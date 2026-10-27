import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

// A stand-in for Google's OpenID Connect provider, for integration and end-to-end tests only.
// The app talks to it exactly as to https://accounts.google.com, through discovery.
//
// /authorize takes the standard parameters plus the identity to sign in as: email, and
// optionally account_hd (default: the email's domain; empty for none; the hd parameter is only
// the app's hint, as at Google) and email_verified=false. With an
// email it redirects straight back with a code; without one it shows a one-field form, as
// Google's account chooser would, for Playwright.
type Pending = {
  email: string
  hd: string
  emailVerified: boolean
  nonce: string
  challenge: string
  redirectUri: string
}

export async function startOidcStub(opts: { clientId: string; clientSecret: string }) {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const kid = randomUUID()
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }
  const codes = new Map<string, Pending>()
  const app = express()
  app.use(express.urlencoded({ extended: false }))
  let issuer = ''

  app.get('/.well-known/openid-configuration', (_req, res) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      scopes_supported: ['openid', 'email', 'profile'],
    })
  })
  app.get('/jwks', (_req, res) => {
    res.json({ keys: [jwk] })
  })

  app.get('/authorize', (req, res) => {
    const q = req.query as Record<string, string | undefined>
    if (q.client_id !== opts.clientId || !q.redirect_uri || q.code_challenge_method !== 'S256') {
      res.status(400).send('bad authorization request')
      return
    }
    if (!q.email) {
      const hidden = Object.entries(q)
        .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v ?? '')}">`)
        .join('')
      res
        .type('html')
        .send(
          `<!doctype html><title>Choose an account</title><form method="get" action="/authorize">${hidden}` +
            `<label>Email <input name="email" type="email"></label> <button>Continue</button></form>`,
        )
      return
    }
    const code = randomBytes(16).toString('base64url')
    codes.set(code, {
      email: q.email,
      hd: q.account_hd ?? q.email.split('@')[1] ?? '',
      emailVerified: q.email_verified !== 'false',
      nonce: q.nonce ?? '',
      challenge: q.code_challenge ?? '',
      redirectUri: q.redirect_uri,
    })
    const back = new URL(q.redirect_uri)
    back.searchParams.set('code', code)
    if (q.state) back.searchParams.set('state', q.state)
    res.redirect(302, back.toString())
  })

  app.post('/token', async (req, res) => {
    const body = req.body as Record<string, string | undefined>
    const basic = req.get('authorization')?.match(/^Basic (.+)$/)?.[1]
    const [id, secret] = basic
      ? Buffer.from(basic, 'base64').toString().split(':').map(decodeURIComponent)
      : [body.client_id, body.client_secret]
    if (id !== opts.clientId || secret !== opts.clientSecret) {
      res.status(401).json({ error: 'invalid_client' })
      return
    }
    const pending = body.code ? codes.get(body.code) : undefined
    if (body.code) codes.delete(body.code)
    const verifier = body.code_verifier ?? ''
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    if (!pending || pending.redirectUri !== body.redirect_uri || pending.challenge !== challenge) {
      res.status(400).json({ error: 'invalid_grant' })
      return
    }
    const idToken = await new SignJWT({
      email: pending.email,
      email_verified: pending.emailVerified,
      ...(pending.hd && { hd: pending.hd }),
      ...(pending.nonce && { nonce: pending.nonce }),
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(issuer)
      .setAudience(opts.clientId)
      .setSubject(createHash('sha256').update(pending.email).digest('hex').slice(0, 21))
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
    res.json({
      access_token: randomUUID(),
      token_type: 'Bearer',
      expires_in: 300,
      id_token: idToken,
    })
  })

  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    issuer,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

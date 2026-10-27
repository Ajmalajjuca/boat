import * as oidc from 'openid-client'

// Google sign-in for staff: OpenID Connect's authorization-code flow with PKCE, state and nonce,
// done on the server so the browser never handles Google's tokens. The issuer is Google in
// production and @boat/oidc-stub in tests.
export type GoogleIdentity = { email: string; emailVerified: boolean; hd: string | null }
// What the start of the flow leaves in the signed boat_oidc cookie for the callback to check.
export type OidcState = { state: string; nonce: string; verifier: string }
export type GoogleSignIn = {
  allowedDomains: string[]
  start(): Promise<{ url: string; state: OidcState }>
  finish(currentUrl: URL, state: OidcState): Promise<GoogleIdentity>
}

export function createGoogleSignIn(o: {
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string
  allowedDomains: string[]
}): GoogleSignIn {
  let config: Promise<oidc.Configuration> | undefined
  // Discovery runs once, on first use, and again after a failure.
  const discovered = () =>
    (config ??= oidc
      .discovery(
        new URL(o.issuer),
        o.clientId,
        o.clientSecret,
        undefined,
        o.issuer.startsWith('http://') ? { execute: [oidc.allowInsecureRequests] } : undefined,
      )
      .catch((err: unknown) => {
        config = undefined
        throw err
      }))
  return {
    allowedDomains: o.allowedDomains,
    async start() {
      const verifier = oidc.randomPKCECodeVerifier()
      const state = { state: oidc.randomState(), nonce: oidc.randomNonce(), verifier }
      const url = oidc.buildAuthorizationUrl(await discovered(), {
        redirect_uri: o.redirectUri,
        scope: 'openid email profile',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state: state.state,
        nonce: state.nonce,
        prompt: 'select_account',
        // Google shows only that Workspace's accounts when there is one domain.
        ...(o.allowedDomains.length === 1 && { hd: o.allowedDomains[0] }),
      })
      return { url: url.href, state }
    },
    async finish(currentUrl, state) {
      const tokens = await oidc.authorizationCodeGrant(await discovered(), currentUrl, {
        pkceCodeVerifier: state.verifier,
        expectedState: state.state,
        expectedNonce: state.nonce,
      })
      const claims = tokens.claims()
      if (!claims || typeof claims.email !== 'string') throw new Error('no email in the ID token')
      return {
        email: claims.email,
        emailVerified: claims.email_verified === true,
        hd: typeof claims.hd === 'string' ? claims.hd : null,
      }
    },
  }
}

// The token rides in the URL fragment, which browsers never send to a server or in a Referer
// header, so it stays out of access logs. Phase 5 builds the /invite and /reset-password pages.
export const linkFor = (appUrl: string, page: 'invite' | 'reset-password', token: string) =>
  `${appUrl.replace(/\/$/, '')}/${page}#token=${token}`

// Sent when an admin adds someone. A courtesy only: access comes from Google sign-in, so a lost or
// spam-filtered email blocks nobody, and it carries no link token.
export const accessEmail = (appUrl: string, name: string) => ({
  subject: "You've been given access to BOAT",
  text: `Hi ${name},\n\nYou've been given access to BOAT. Sign in with your company Google account at ${appUrl.replace(/\/$/, '')}.\n`,
})

export const inviteEmail = (appUrl: string, name: string, token: string) => ({
  subject: "You're invited to BOAT Supply Chain",
  text: [
    `Hi ${name},`,
    'An admin has invited you to BOAT Supply Chain. Choose your password within 72 hours:',
    linkFor(appUrl, 'invite', token),
    "If you weren't expecting this, you can ignore this email.",
  ].join('\n\n'),
})

export const resetEmail = (appUrl: string, name: string, token: string) => ({
  subject: 'Reset your BOAT Supply Chain password',
  text: [
    `Hi ${name},`,
    'Use this link within 1 hour to choose a new password:',
    linkFor(appUrl, 'reset-password', token),
    "If you didn't ask for this, ignore this email. Your password stays the same.",
  ].join('\n\n'),
})

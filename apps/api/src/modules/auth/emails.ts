// Sent when an admin adds someone. A courtesy only: access comes from Google sign-in, so a lost or
// spam-filtered email blocks nobody, and it carries no link token.
export const accessEmail = (appUrl: string, name: string) => ({
  subject: "You've been given access to BOAT",
  text: `Hi ${name},\n\nYou've been given access to BOAT. Sign in with your company Google account at ${appUrl.replace(/\/$/, '')}.\n`,
})

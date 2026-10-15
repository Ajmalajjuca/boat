// Excel and Google Sheets run a cell that starts with = + - @ (or a tab or carriage return) as a
// formula, so text cells starting with one get a leading apostrophe (OWASP "CSV injection").
// Numbers are left alone: -3 is a number, not a formula.
const formula = /^[=+\-@\t\r]/

function cell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  const safe = typeof value === 'string' && formula.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

export const toCsv = (headers: string[], rows: Record<string, unknown>[]) =>
  [headers, ...rows.map((row) => headers.map((h) => row[h]))]
    .map((line) => line.map(cell).join(','))
    .join('\r\n') + '\r\n'

const encoder = new TextEncoder()

function stream(content: string): string {
  return `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}\nendstream`
}

/** Two 20×20 point pages: solid red, then solid blue. */
export function pdfFixture(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << >> /Contents 4 0 R >>',
    stream('1 0 0 rg\n0 0 20 20 re f'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << >> /Contents 6 0 R >>',
    stream('0 0 1 rg\n0 0 20 20 re f'),
  ]

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(encoder.encode(body).byteLength)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }

  const xref = encoder.encode(body).byteLength
  const rows = offsets.map(offset => `${offset.toString().padStart(10, '0')} 00000 n `)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows.join('\n')}\n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return encoder.encode(body)
}

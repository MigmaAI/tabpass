// PDFs for the tests, written out here so no binary file lives in the repository.

const HELVETICA = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
// East Asian text in one of the encodings PDFs may name instead of embedding a font.
const CJK_FONT = '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> >>] >>';
// A password check no empty password can pass.
const ENCRYPT = `/ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>] /Encrypt << /Filter /Standard /V 1 /R 2 /O <${'ab'.repeat(32)}> /U <${'cd'.repeat(32)}> /P -44 >>`;

/** `pages` is one array of text lines per page. */
export function makePdf(pages, { encrypted = false, cjk = false } = {}) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null, HELVETICA, CJK_FONT];
  const add = (body) => objects.push(body);
  const kids = [];
  for (const lines of pages) {
    const text = lines.map((line) => `(${line.replace(/[\\()]/g, '\\$&')}) Tj T*`).join(' ');
    const stream = `BT /F1 11 Tf 14 TL 50 760 Td ${text} ET${cjk ? ' BT /F2 11 Tf 50 60 Td <4E2D6587> Tj ET' : ''}`;
    const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contents} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`));
  }
  objects[1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] >>`;

  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = out.length;
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypted ? ENCRYPT : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

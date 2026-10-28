import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Pack } from "./pack";

const PAGE = { width: 612, height: 792, margin: 54 };
const SIZE = { title: 16, heading: 12, body: 9 };

// The standard fonts only cover WinAnsi; anything else (emoji, CJK) becomes "?".
const drawable = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

export async function renderPdf(pack: Pack): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(drawable(pack.title));
  doc.setProducer("Keel");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const maxWidth = PAGE.width - 2 * PAGE.margin;

  let page = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;
  const line = (text: string, size: number, f = font) => {
    if (y - size < PAGE.margin) {
      page = doc.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - PAGE.margin;
    }
    page.drawText(text, { x: PAGE.margin, y: y - size, size, font: f });
    y -= size * 1.4;
  };
  const wrapped = (text: string, size: number, f = font) => {
    let current = "";
    for (const word of drawable(text).split(/\s+/)) {
      const next = current ? `${current} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) <= maxWidth) current = next;
      else {
        if (current) line(current, size, f);
        current = word;
        // A single word wider than the page (a hash) is cut to fit.
        while (f.widthOfTextAtSize(current, size) > maxWidth) {
          let cut = current.length - 1;
          while (cut > 1 && f.widthOfTextAtSize(current.slice(0, cut), size) > maxWidth) cut--;
          line(current.slice(0, cut), size, f);
          current = current.slice(cut);
        }
      }
    }
    if (current) line(current, size, f);
  };

  wrapped(pack.title, SIZE.title, bold);
  for (const section of pack.sections) {
    y -= SIZE.body;
    wrapped(section.heading, SIZE.heading, bold);
    for (const l of section.lines) wrapped(l, SIZE.body);
  }
  return doc.save();
}

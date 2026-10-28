// FR-SEC-4: transcripts in the evidence pack mask card numbers, phone numbers and emails.

const CARD = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const PHONE = /(?<![\d\w])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

export function redact(text: string): string {
  return text
    .replace(CARD, (m) => (luhn(m.replace(/\D/g, "")) ? "[card]" : m))
    .replace(EMAIL, "[email]")
    .replace(PHONE, "[phone]");
}

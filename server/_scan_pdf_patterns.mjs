import fs from "node:fs";
import pdfParse from "pdf-parse";

const file = String.raw`C:\Users\sheid\Documents\deadline-renew-testFIles\THSA-MSA-Contract-No.-0000001.pdf`;
const buf = fs.readFileSync(file);
let pageIndex = 0;
const data = await pdfParse(buf, {
  pagerender: async (pageData) => {
    const textContent = await pageData.getTextContent();
    const pageText = textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    pageIndex += 1;
    return `\n[[[TT_PAGE_${pageIndex}]]]\n${pageText}`;
  }
});
const text = String(data.text || "");

const tests = [
  [/\bwithin\b/gi, 'within'],
  [/\bno\s+later\s+than\b/gi, 'no later than'],
  [/\bprior\s+to\b/gi, 'prior to'],
  [/\bbefore\b/gi, 'before'],
  [/\bafter\b/gi, 'after'],
  [/\b\w+\s*\(\d{1,3}\)\s+days?\b/gi, 'word(number) days'],
  [/\b\d{1,3}\s+business\s+days?\b/gi, 'N business days'],
  [/\b\d{1,3}\s+calendar\s+days?\b/gi, 'N calendar days'],
  [/\b\d{1,3}\s+days?\b/gi, 'N days']
];

for (const [re, label] of tests) {
  const m = text.match(re);
  console.log(label + ': ' + (m ? m.length : 0));
}

const sampleRe = /(\b\w+\s*\(\d{1,3}\)\s+(?:business\s+|calendar\s+)?days?\b[^.]{0,100})/gi;
let s;
let i = 0;
while ((s = sampleRe.exec(text)) !== null && i < 30) {
  console.log('SAMPLE ' + (i+1) + ': ' + s[1].replace(/\s+/g,' ').trim());
  i += 1;
}

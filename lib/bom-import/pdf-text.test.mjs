import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { jsPDF } from 'jspdf';

const require = createRequire(import.meta.url);
async function loadTs(path, transform = source => source) {
  const source = transform(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
// Preserve the real native PDF.js import, including its real sibling worker.
const pdfModule = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href;
const { pdfToText, readPdfForImport } = await loadTs('./pdf-text.ts', source =>
  source.replace('pdfjs-dist/legacy/build/pdf.mjs', pdfModule));
const upload = doc => new File([doc.output('arraybuffer')], 'estimate.pdf', { type: 'application/pdf' });

test('reads a real multipage PDF with the native server worker', async () => {
  const doc = new jsPDF();
  doc.text('EARTHWORKS - Excavation 12 cu.m', 20, 20);
  doc.addPage();
  doc.text('CONCRETE - Cement 30 bags at 210', 20, 20);
  const text = await pdfToText(upload(doc));
  assert.match(text, /Page 1:\nEARTHWORKS - Excavation 12 cu.m/);
  assert.match(text, /Page 2:\nCONCRETE - Cement 30 bags at 210/);
});

test('returns no invented text for a PDF without a text layer', async () => {
  assert.equal(await pdfToText(upload(new jsPDF())), '');
});

test('rejects invalid PDFs and can read a valid PDF afterwards', async () => {
  await assert.rejects(pdfToText(new File(['not a PDF'], 'broken.pdf')), /Invalid PDF/);
  const doc = new jsPDF();
  doc.text('Materials', 20, 20);
  assert.match(await pdfToText(upload(doc)), /Materials/);
});

test('production configuration leaves PDF.js external for worker resolution', async () => {
  const { default: config } = await loadTs('../../next.config.ts');
  assert.ok(config.serverExternalPackages.includes('pdfjs-dist'));
});

test('renders scanned pages for vision while retaining text from other pages', async () => {
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(600, 200);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 600, 200);
  ctx.fillStyle = 'black'; ctx.font = '24px sans-serif';
  ctx.fillText('Cement 20 bags at 250', 20, 50);
  const doc = new jsPDF();
  doc.text('Estimate cover', 20, 20);
  doc.addPage(); doc.addImage(canvas.toBuffer('image/png'), 'PNG', 10, 10, 190, 65);
  const result = await readPdfForImport(upload(doc));
  assert.match(result.text, /Page 1:\nEstimate cover/);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].page, 2);
  const image = Buffer.from(result.images[0].url.split(',')[1], 'base64');
  assert.equal(image.subarray(0, 2).toString('hex'), 'ffd8');
  assert.ok(image.length > 1000);
});

test('rejects oversized scanned-page batches rather than silently skipping pages', async () => {
  const doc = new jsPDF({ format: [20, 20] });
  for (let i = 1; i < 13; i++) doc.addPage();
  await assert.rejects(readPdfForImport(upload(doc)), /more than 12 scanned pages/);
});

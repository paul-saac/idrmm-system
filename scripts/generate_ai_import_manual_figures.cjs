const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const brainDir = 'C:/Users/HP-Victus/.gemini/antigravity/brain/f1305f56-2ed0-48b4-9e81-f1515c25abd6';
const uploadImgSrc = path.join(brainDir, '.user_uploaded/media_1793519014587_72aaf4ae.png');
const reviewImgSrc = path.join(brainDir, '.user_uploaded/media_1793521140290_bb9d1c11.jpg');

const outDir = path.join(process.cwd(), 'deliverables', 'user-manual', 'images');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function escapeXml(unsafe) {
  return String(unsafe).replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

function makeOverlay(w, h, callouts) {
  const elements = callouts.map(c => {
    const align = c.align || 'start';
    const textWidth = c.width || Math.max(160, c.text.length * 7.0 + 26);
    const boxX = align === 'end' ? c.textX - textWidth + 8 : (align === 'middle' ? c.textX - textWidth / 2 : c.textX - 8);
    const boxY = c.textY - 14;

    // Arrowhead calculation
    const angle = Math.atan2(c.y2 - c.y1, c.x2 - c.x1);
    const arrowLen = 10;
    const arrowWidth = 5;
    const p1x = c.x2 - arrowLen * Math.cos(angle) + arrowWidth * Math.sin(angle);
    const p1y = c.y2 - arrowLen * Math.sin(angle) - arrowWidth * Math.cos(angle);
    const p2x = c.x2 - arrowLen * Math.cos(angle) - arrowWidth * Math.sin(angle);
    const p2y = c.y2 - arrowLen * Math.sin(angle) + arrowWidth * Math.cos(angle);

    const safeText = escapeXml(c.text);

    return `
      <!-- Connecting line -->
      <line x1="${c.x1}" y1="${c.y1}" x2="${c.x2}" y2="${c.y2}" stroke="#ea580c" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="${c.x1}" cy="${c.y1}" r="3.5" fill="#ea580c"/>
      <!-- Arrowhead -->
      <polygon points="${c.x2},${c.y2} ${p1x},${p1y} ${p2x},${p2y}" fill="#ea580c"/>
      <!-- Callout Badge -->
      <rect x="${boxX}" y="${boxY}" width="${textWidth}" height="24" fill="#fff7ed" stroke="#fed7aa" stroke-width="1.2" rx="4" filter="url(#shadow)"/>
      <text x="${c.textX}" y="${c.textY + 3}" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="bold" fill="#c2410c" text-anchor="${align}">${safeText}</text>
    `;
  }).join('\n');

  return Buffer.from(`
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.18"/>
        </filter>
      </defs>
      ${elements}
    </svg>
  `);
}

async function generateFigure1() {
  console.log('Generating Figure 1: AI Import Upload Modal...');
  // Modal size: 633 x 577
  const canvasW = 1000;
  const canvasH = 635;
  const modalX = 30;
  const modalY = 28;

  const bg = await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: { r: 15, g: 23, b: 42, alpha: 1 } // #0f172a
    }
  }).png().toBuffer();

  const callouts = [
    {
      x1: 690, y1: modalY + 205,
      x2: modalX + 535, y2: modalY + 205,
      text: '1. Resume saved drafts or recent sessions',
      textX: 695, textY: modalY + 205,
      width: 275
    },
    {
      x1: 690, y1: modalY + 395,
      x2: modalX + 580, y2: modalY + 395,
      text: '2. Drag & drop or browse document (PDF, Excel, Image)',
      textX: 695, textY: modalY + 395,
      width: 295
    },
    {
      x1: 690, y1: modalY + 520,
      x2: modalX + 555, y2: modalY + 520,
      text: '3. Click "Process with AI" to extract resources',
      textX: 695, textY: modalY + 520,
      width: 280
    }
  ];

  const overlay = makeOverlay(canvasW, canvasH, callouts);

  const finalImg = await sharp(bg)
    .composite([
      { input: uploadImgSrc, left: modalX, top: modalY },
      { input: overlay, left: 0, top: 0 }
    ])
    .png()
    .toBuffer();

  const outPath1 = path.join(outDir, 'fig_ai_import_upload.png');
  const brainPath1 = path.join(brainDir, 'fig_ai_import_upload.png');
  fs.writeFileSync(outPath1, finalImg);
  fs.writeFileSync(brainPath1, finalImg);
  console.log('Saved Figure 1 to:', outPath1, 'and', brainPath1);
}

async function generateFigure2() {
  console.log('Generating Figure 2: AI Draft Review Screen...');
  // Image 2 size: 1024 x 669
  const leftMargin = 250;
  const rightMargin = 280;
  const topMargin = 50;
  const bottomMargin = 45;

  const canvasW = leftMargin + 1024 + rightMargin; // 1554
  const canvasH = topMargin + 669 + bottomMargin;  // 764
  const imgX = leftMargin;
  const imgY = topMargin;

  // Clean soft light background
  const bg = await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: { r: 248, g: 250, b: 252, alpha: 1 } // #f8fafc
    }
  }).png().toBuffer();

  const borderedImg2 = await sharp(reviewImgSrc)
    .extend({
      top: 1, bottom: 1, left: 1, right: 1,
      background: { r: 203, g: 213, b: 225, alpha: 1 } // #cbd5e1
    })
    .toBuffer();

  const callouts = [
    {
      x1: imgX + 460, y1: 28,
      x2: imgX + 460, y2: imgY + 128,
      text: '1. Validation banner flags missing quantities, units, or unit rates',
      textX: imgX + 460, textY: 28,
      align: 'middle',
      width: 410
    },
    {
      x1: leftMargin - 10, y1: imgY + 360,
      x2: imgX + 65, y2: imgY + 360,
      text: '2. Outline sidebar for fast phase navigation',
      textX: 12, textY: imgY + 360,
      align: 'start',
      width: 260
    },
    {
      x1: imgX + 720, y1: imgY + 375,
      x2: imgX + 610, y2: imgY + 425,
      text: '3. Inline editable quantities, units & unit costs',
      textX: imgX + 720, textY: imgY + 375,
      align: 'start',
      width: 270
    },
    {
      x1: leftMargin + 1024 + 10, y1: imgY + 595,
      x2: imgX + 850, y2: imgY + 595,
      text: '4. Append custom materials, equipment, or tasks',
      textX: leftMargin + 1024 + 15, textY: imgY + 595,
      align: 'start',
      width: 290
    },
    {
      x1: leftMargin + 1024 + 10, y1: imgY + 642,
      x2: imgX + 920, y2: imgY + 642,
      text: '5. Review total (₱3.86M) & click "Confirm & create tasks"',
      textX: leftMargin + 1024 + 15, textY: imgY + 642,
      align: 'start',
      width: 310
    }
  ];

  const overlay = makeOverlay(canvasW, canvasH, callouts);

  const finalImg = await sharp(bg)
    .composite([
      { input: borderedImg2, left: imgX, top: imgY },
      { input: overlay, left: 0, top: 0 }
    ])
    .png()
    .toBuffer();

  const outPath2 = path.join(outDir, 'fig_ai_import_review.png');
  const brainPath2 = path.join(brainDir, 'fig_ai_import_review.png');
  fs.writeFileSync(outPath2, finalImg);
  fs.writeFileSync(brainPath2, finalImg);
  console.log('Saved Figure 2 to:', outPath2, 'and', brainPath2);
}

async function run() {
  await generateFigure1();
  await generateFigure2();
  console.log('All figures generated successfully!');
}

run().catch(console.error);

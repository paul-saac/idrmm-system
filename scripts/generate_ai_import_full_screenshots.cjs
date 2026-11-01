const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const brainDir = 'C:/Users/HP-Victus/.gemini/antigravity/brain/f1305f56-2ed0-48b4-9e81-f1515c25abd6';
const uploadImgSrc = path.join(brainDir, '.user_uploaded/media_1793522769476_aa6fe06a.jpg');
const reviewImgSrc = path.join(brainDir, '.user_uploaded/media_1793522786960_2c46a556.jpg');

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
    const textWidth = c.width || Math.max(140, c.text.length * 6.5 + 20);
    const boxX = align === 'end' ? c.textX - textWidth + 8 : (align === 'middle' ? c.textX - textWidth / 2 : c.textX - 8);
    const boxY = c.textY - 13;

    // Arrowhead calculation
    const angle = Math.atan2(c.y2 - c.y1, c.x2 - c.x1);
    const arrowLen = 9;
    const arrowWidth = 4.5;
    const p1x = c.x2 - arrowLen * Math.cos(angle) + arrowWidth * Math.sin(angle);
    const p1y = c.y2 - arrowLen * Math.sin(angle) - arrowWidth * Math.cos(angle);
    const p2x = c.x2 - arrowLen * Math.cos(angle) - arrowWidth * Math.sin(angle);
    const p2y = c.y2 - arrowLen * Math.sin(angle) + arrowWidth * Math.cos(angle);

    const safeText = escapeXml(c.text);

    return `
      <!-- Connecting line -->
      <line x1="${c.x1}" y1="${c.y1}" x2="${c.x2}" y2="${c.y2}" stroke="#ea580c" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="${c.x1}" cy="${c.y1}" r="3" fill="#ea580c"/>
      <!-- Arrowhead -->
      <polygon points="${c.x2},${c.y2} ${p1x},${p1y} ${p2x},${p2y}" fill="#ea580c"/>
      <!-- Callout Badge -->
      <rect x="${boxX}" y="${boxY}" width="${textWidth}" height="22" fill="#fff7ed" stroke="#ea580c" stroke-width="1.2" rx="4" filter="url(#shadow)"/>
      <text x="${c.textX}" y="${c.textY + 2}" font-family="Arial, Helvetica, sans-serif" font-size="9.5" font-weight="bold" fill="#c2410c" text-anchor="${align}">${safeText}</text>
    `;
  }).join('\n');

  return Buffer.from(`
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000" flood-opacity="0.35"/>
        </filter>
      </defs>
      ${elements}
    </svg>
  `);
}

async function generateFigure1() {
  console.log('Generating Figure 1: Full screenshot 1024x559...');
  const meta = await sharp(uploadImgSrc).metadata();
  const w = meta.width;
  const h = meta.height;

  const callouts = [
    {
      // 1. Resume saved drafts (placed on right darkened area, pointing left into Resume button)
      x1: 715, y1: 245,
      x2: 665, y2: 245,
      text: '1. Resume saved drafts or recent sessions',
      textX: 720, textY: 245,
      width: 245
    },
    {
      // 2. Drag & drop box (placed on left darkened area, pointing right into dropzone)
      x1: 285, y1: 375,
      x2: 350, y2: 375,
      text: '2. Drop or browse document (PDF, Excel, Image)',
      textX: 35, textY: 375,
      width: 250
    },
    {
      // 3. Process with AI button (placed on right darkened area, pointing left to button)
      x1: 715, y1: 458,
      x2: 688, y2: 458,
      text: '3. Click "Process with AI" to parse line items',
      textX: 720, textY: 458,
      width: 250
    }
  ];

  const overlay = makeOverlay(w, h, callouts);

  const finalImg = await sharp(uploadImgSrc)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png()
    .toBuffer();

  const outPath1 = path.join(outDir, 'fig_ai_import_upload.png');
  const brainPath1 = path.join(brainDir, 'fig_ai_import_upload.png');
  fs.writeFileSync(outPath1, finalImg);
  fs.writeFileSync(brainPath1, finalImg);
  console.log('Saved Figure 1 to:', outPath1);
}

async function generateFigure2() {
  console.log('Generating Figure 2: Full screenshot 1024x507...');
  const meta = await sharp(reviewImgSrc).metadata();
  const w = meta.width;
  const h = meta.height;

  const callouts = [
    {
      // 1. Validation Warning Banner
      x1: 520, y1: 65,
      x2: 520, y2: 85,
      text: '1. Validation banner: review missing data warnings',
      textX: 380, textY: 65,
      width: 275
    },
    {
      // 2. Draft Outline Sidebar (placed above outline, pointing down-right into DRAFT OUTLINE)
      x1: 170, y1: 180,
      x2: 215, y2: 210,
      text: '2. Outline: fast phase navigation',
      textX: 10, textY: 180,
      width: 175
    },
    {
      // 3. Inline editable table cells
      x1: 540, y1: 275,
      x2: 540, y2: 305,
      text: '3. Inline editable cells (quantities, units & rates)',
      textX: 410, textY: 275,
      width: 260
    },
    {
      // 4. Add custom resources
      x1: 720, y1: 390,
      x2: 740, y2: 418,
      text: '4. Add custom materials, equipment, or tasks',
      textX: 600, textY: 390,
      width: 240
    },
    {
      // 5. Confirm & create tasks button
      x1: 680, y1: 462,
      x2: 750, y2: 462,
      text: '5. Verify total & click "Confirm & create tasks"',
      textX: 435, textY: 462,
      width: 245
    }
  ];

  const overlay = makeOverlay(w, h, callouts);

  const finalImg = await sharp(reviewImgSrc)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png()
    .toBuffer();

  const outPath2 = path.join(outDir, 'fig_ai_import_review.png');
  const brainPath2 = path.join(brainDir, 'fig_ai_import_review.png');
  fs.writeFileSync(outPath2, finalImg);
  fs.writeFileSync(brainPath2, finalImg);
  console.log('Saved Figure 2 to:', outPath2);
}

async function run() {
  await generateFigure1();
  await generateFigure2();
  console.log('All figures regenerated successfully!');
}

run().catch(console.error);

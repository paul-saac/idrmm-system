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
    const textWidth = c.width || Math.max(140, c.text.length * 6.8 + 20);
    const boxX = align === 'end' ? c.textX - textWidth + 8 : (align === 'middle' ? c.textX - textWidth / 2 : c.textX - 8);
    const boxY = c.textY - 14;

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
      <text x="${c.textX}" y="${c.textY + 2}" font-family="Arial, Helvetica, sans-serif" font-size="10" font-weight="bold" fill="#c2410c" text-anchor="${align}">${safeText}</text>
    `;
  }).join('\n');

  return Buffer.from(`
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#000" flood-opacity="0.25"/>
        </filter>
      </defs>
      ${elements}
    </svg>
  `);
}

async function generateFigure1() {
  console.log('Generating Figure 1 (Within exact modal bounds 633x577)...');
  const w = 633;
  const h = 577;

  // Exact positions on the modal image:
  // Resume button: x: 490 to 554, y: 229 to 256
  // Dropzone upload icon: x: 316, y: 390
  // Process with AI button: x: 453 to 600, y: 512 to 544

  const callouts = [
    {
      // 1. Resume saved draft (placed in the space above BOM.pdf, pointing to Resume button)
      x1: 420, y1: 200,
      x2: 485, y2: 236,
      text: '1. Resume saved draft session',
      textX: 250, textY: 200,
      width: 175
    },
    {
      // 2. Upload box (placed inside the top-left of the dashed dropzone)
      x1: 250, y1: 375,
      x2: 305, y2: 395,
      text: '2. Drop or browse document (PDF, Excel, Image)',
      textX: 18, textY: 375,
      width: 245
    },
    {
      // 3. Process with AI button (placed in the empty space at bottom left, pointing to the button)
      x1: 400, y1: 528,
      x2: 448, y2: 528,
      text: '3. Click "Process with AI" to parse estimate',
      textX: 155, textY: 528,
      width: 245
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
  console.log('Generating Figure 2 (Within exact review screen bounds 1024x669)...');
  const w = 1024;
  const h = 669;

  // Exact positions on Image 2:
  // Yellow banner: y: 110 to 151
  // DRAFT OUTLINE: x: 20 to 150, y: 330 to 600
  // Table row Footings: x: 400 to 900, y: 430
  // + Add material buttons: x: 750, y: 605
  // Confirm button: x: 850 to 980, y: 628 to 654

  const callouts = [
    {
      // 1. Yellow warning banner (placed in the white area at top right: x: 550, y: 72)
      x1: 640, y1: 85,
      x2: 640, y2: 115,
      text: '1. Validation banner: review missing data warnings',
      textX: 470, textY: 72,
      width: 275
    },
    {
      // 2. Draft Outline (placed right above the outline list at y: 300)
      x1: 180, y1: 300,
      x2: 95, y2: 345,
      text: '2. Draft outline: fast phase navigation',
      textX: 15, textY: 300,
      width: 205
    },
    {
      // 3. Inline editable cells (placed above the Excavation/Footings table section)
      x1: 520, y1: 375,
      x2: 520, y2: 420,
      text: '3. Inline editable cells (quantities, units & rates)',
      textX: 370, textY: 375,
      width: 260
    },
    {
      // 4. Add custom resources
      x1: 710, y1: 575,
      x2: 780, y2: 602,
      text: '4. Add custom materials, equipment, or tasks',
      textX: 470, textY: 575,
      width: 245
    },
    {
      // 5. Confirm & create tasks button (placed in the empty space between Total and Confirm button)
      x1: 780, y1: 642,
      x2: 850, y2: 642,
      text: '5. Verify total & click "Confirm & create tasks"',
      textX: 525, textY: 642,
      width: 250
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
  console.log('All figures generated within screenshot bounds successfully!');
}

run().catch(console.error);


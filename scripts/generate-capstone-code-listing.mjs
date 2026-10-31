import fs from 'fs';
import path from 'path';

const outDir = path.join(process.cwd(), 'deliverables', 'capstone-source-code');
const tocPath = path.join(outDir, 'SOURCE_CODE_TABLE_OF_CONTENTS.md');

const ignoreDirs = new Set(['node_modules', '.next', '.git', 'supabase', '.gemini', '.claude', 'artifacts', 'deliverables', 'coverage', '.vscode', '.husky']);
const ignoreFiles = new Set(['package-lock.json']);

function shouldInclude(filePath) {
  const base = path.basename(filePath);
  if (base.startsWith('.env')) return false;
  if (ignoreFiles.has(base)) return false;
  const ext = path.extname(base).toLowerCase();
  return ['.ts', '.tsx', '.js', '.jsx', '.css', '.json'].includes(ext);
}

const categorized = {
  '1. Application Pages & Route Views (app/)': [],
  '2. REST API & Dynamic Endpoints (app/api/)': [],
  '3. Server Actions & Database Mutations': [],
  '4. Domain Calculation, Estimation & Utilities (lib/)': [],
  '5. User Interface & Feature Components (components/)': [],
  '6. System Configuration & Metadata': []
};

function scan(dir) {
  const entries = fs.readdirSync(dir).sort();
  for (const item of entries) {
    const full = path.join(dir, item);
    const rel = path.relative(process.cwd(), full).split(path.sep).join('/');
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (ignoreDirs.has(item)) continue;
      scan(full);
    } else {
      if (shouldInclude(full)) {
        const content = fs.readFileSync(full, 'utf8');
        const lines = content.split('\n').length;
        const info = { rel, lines, bytes: stat.size };
        if (rel.startsWith('app/api/')) {
          categorized['2. REST API & Dynamic Endpoints (app/api/)'].push(info);
        } else if (rel.includes('actions.ts') || rel.includes('-actions.ts') || rel.includes('action.ts')) {
          categorized['3. Server Actions & Database Mutations'].push(info);
        } else if (rel.startsWith('app/')) {
          categorized['1. Application Pages & Route Views (app/)'].push(info);
        } else if (rel.startsWith('components/')) {
          categorized['5. User Interface & Feature Components (components/)'].push(info);
        } else if (rel.startsWith('lib/')) {
          categorized['4. Domain Calculation, Estimation & Utilities (lib/)'].push(info);
        } else {
          categorized['6. System Configuration & Metadata'].push(info);
        }
      }
    }
  }
}

scan('.');

let md = '# IDRMM SYSTEM — CAPSTONE SOURCE CODE REPOSITORY INVENTORY\n\n';
md += '> **Project Title:** Integrated Disaster Risk & Material Management (IDRMM) System\\\n';
md += '> **Architecture:** Next.js (App Router), React 19, TypeScript, Tailwind CSS\\\n';
md += '> **Exclusions Applied:** `.env*` environment variables, `supabase/` database migrations folder, build directories (`.next`, `node_modules`).\n\n';

let totalFiles = 0;
let totalLines = 0;

for (const [section, files] of Object.entries(categorized)) {
  totalFiles += files.length;
  const sectionLines = files.reduce((s, f) => s + f.lines, 0);
  totalLines += sectionLines;
  md += `## ${section} (${files.length} files, ${sectionLines.toLocaleString()} lines)\n\n`;
  md += '| # | File Path | Language | Lines |\n';
  md += '|---|---|---|---:|\n';
  files.forEach((f, idx) => {
    const ext = path.extname(f.rel).replace('.', '').toUpperCase();
    md += `| ${idx + 1} | \`${f.rel}\` | ${ext} | ${f.lines.toLocaleString()} |\n`;
  });
  md += '\n';
}

const header = `# IDRMM SYSTEM — COMPLETE SOURCE CODE INVENTORY\n\n` +
  `**Total Modules:** ${Object.keys(categorized).length}  \n` +
  `**Total Source Files:** ${totalFiles}  \n` +
  `**Total Lines of Code:** ${totalLines.toLocaleString()} lines  \n\n` +
  `---\n\n`;

fs.writeFileSync(tocPath, header + md, 'utf8');
console.log('Successfully generated Table of Contents at:', tocPath);


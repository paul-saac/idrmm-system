/* eslint-disable @typescript-eslint/no-require-imports -- Standalone generator script using CommonJS */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

async function generateWholeSystemAlphaWorkbook() {
  // 1. Load requirements REQ001-REQ242 from IDRMM_Current_System_Requirements.md
  const reqFilePath = path.join(__dirname, '../requirements/IDRMM_Current_System_Requirements.md');
  const reqText = fs.readFileSync(reqFilePath, 'utf8');
  const requirements = [...reqText.matchAll(/^(REQ\d{3})\.\s+(.+)$/gm)].map((m) => ({
    id: m[1],
    text: m[2].trim()
  }));

  // 2. Load the existing 242 PM UAT cases from outputs/pm-uat-revision-20261025/case-manifest.json
  const manifestPath = path.join(__dirname, '../../outputs/pm-uat-revision-20261025/case-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const cases = [];
  let currentSection = '';
  function group(s) {
    currentSection = s;
  }
  function add(reqList, title, pre, stepsArr, expected) {
    const reqs = Array.isArray(reqList)
      ? reqList
      : reqList
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => (x.startsWith('REQ') ? x : 'REQ' + String(Number(x)).padStart(3, '0')));
    const stepsText = Array.isArray(stepsArr)
      ? stepsArr.map((s, i) => `${i + 1}. ${s}`).join('\n')
      : String(stepsArr).includes('\n')
        ? stepsArr
        : String(stepsArr)
            .split('|')
            .map((s, i) => `${i + 1}. ${s}`)
            .join('\n');
    cases.push({
      section: currentSection,
      req: reqs,
      title,
      pre,
      steps: stepsText,
      expected
    });
  }

  // Filter out retired forecasting cases (group 17: REQ147-REQ152) from the base manifest and adapt for Whole-System Alpha Testing
  for (const c of manifest.cases) {
    if (c.section.startsWith('17. Conditional forecast review')) {
      continue; // Forecasting and legacy delay-risk have been retired per AGENTS.md and migration 0098
    }
    cases.push({
      section: c.section,
      req: c.req,
      title: c.title,
      pre: c.pre,
      steps: c.steps,
      expected: c.expected
    });
  }

  // =========================================================================
  // ADD WHOLE-SYSTEM ADMIN, SUPER ADMIN, FOREMAN & TECHNICAL ALPHA CASES
  // =========================================================================
  group('20. Super Administrator and Administrator account management');
  add(
    '12,13,14,15,26,240',
    'Create accounts across roles and reject duplicate email invitations',
    'Super Administrator and Administrator sessions are active in Manage Accounts.',
    [
      'Super Administrator: invite a new Administrator, Project Manager, and Foreman using distinct valid email addresses.',
      'Attempt to invite an email address that already belongs to an existing account.',
      'Administrator: open the invitation form and inspect available role choices.',
      'Open an existing account detail modal and inspect recorded account-management activity history.'
    ],
    'Super Administrator can invite Administrator, Project Manager, and Foreman accounts. Duplicate email address is rejected. Administrator can invite Project Manager and Foreman only. Account detail view displays recorded account-management history.'
  );
  add(
    '16,17,24',
    'Resend pending invitation, update account details, and manage credentials/sessions',
    'Super Administrator or Administrator is signed in; a pending invited account and an active PM/Foreman account exist.',
    [
      'Select Resend invitation on the pending invited account.',
      'Open the active account detail view, update its name details, and save.',
      'Use the account security controls to send a password-reset email, set a temporary password, or revoke active sessions.'
    ],
    'Pending invitation is resent; account detail updates persist; credential reset and session revocation actions complete without error.'
  );
  add(
    '18,19,20,21',
    'Activate/deactivate accounts, block self-deactivation, and enforce project handover',
    'Admin is signed in; PM-A is assigned to an unfinished project; eligible active replacement PM-B exists; disposable unassigned accounts exist.',
    [
      'Attempt to deactivate the currently signed-in Admin account.',
      'Select two unassigned disposable accounts and perform bulk deactivation, then bulk activation.',
      'Attempt to deactivate PM-A without supplying a replacement, or with an ineligible replacement.',
      'Select active PM-B as the handover replacement for PM-A and complete deactivation.'
    ],
    'Self-deactivation is prevented. Bulk activation/deactivation updates eligible accounts. Deactivating PM-A on an unfinished project requires a valid active replacement of the matching role and transfers project assignment to PM-B.'
  );
  add(
    '22,23,25',
    'Change eligible account roles, block conflicting role changes, and restrict permanent deletion to Super Administrator',
    'Super Administrator and Administrator sessions are available; one PM is assigned to an unfinished project; one disposable unassigned account exists.',
    [
      'Attempt to change the role of the PM currently assigned to an unfinished project.',
      'Change the role of an unassigned eligible account within management scope and save.',
      'As Administrator, inspect the disposable account for permanent deletion controls.',
      'As Super Administrator, permanently delete the disposable unassigned account.'
    ],
    'Role change conflicting with unfinished-project responsibility is rejected. Eligible role change succeeds. Permanent account deletion is unavailable to Administrator and succeeds for Super Administrator on eligible accounts.'
  );
  add(
    '27,28',
    'Grant and revoke additional per-project account access (Migration 0101)',
    'Admin is signed in; Secondary PM or Foreman is not the primary assignee on Project A.',
    [
      'Open Manage Accounts and open Project Access for the secondary PM/Foreman.',
      'Grant access to Project A and save.',
      'In the secondary user session, refresh Projects and open Project A.',
      'Admin: revoke Project A access from that account and save; refresh the secondary user session.'
    ],
    'Granted project access allows the secondary PM/Foreman to view and work in Project A; revoking access immediately removes Project A from their accessible projects.'
  );

  group('21. Administrator project lifecycle, calendar events, and archiving');
  add(
    '37,38,39,40,41,42',
    'Create, edit, and delete projects and enforce required assignments',
    'Administrator is signed in to Projects; eligible PM and Foreman exist.',
    [
      'Open Create Project and attempt to save with missing project name, PM, or Foreman.',
      'Create a disposable project with name, location, start/target dates, allocated budget PHP 500,000, PM, and Foreman.',
      'Edit the project to update working days and actual completion date; save.',
      'Delete a separate unused disposable project and confirm removal.'
    ],
    'Missing required fields and conflicting unfinished-project assignments are rejected. Project creation, editing, and deletion succeed for administrative roles.'
  );
  add(
    '40,44',
    'Archive and unarchive a project (Migration 0104)',
    'Administrator is signed in; disposable Project A is open.',
    [
      'Click Archive project in the project header and confirm.',
      'Return to the Projects list, verify the project is hidden from the default active filter, and switch the filter to Archived.',
      'Open the archived project, verify the Archived badge, and unarchive it.'
    ],
    'Archiving sets archived_at, displays the Archived badge, and filters the project out of active lists until unarchived.'
  );
  add(
    '77,78,79,80',
    'Create, edit, and delete project holiday and meeting events',
    'Administrator is signed in; Project A Calendar view is open.',
    [
      'Attempt to create an event without a name or date.',
      'Create a Holiday event on a working weekday within Project A and verify synchronization with project nonworking holidays.',
      'Attempt to create a Meeting event where end time is earlier than or equal to start time.',
      'Create a valid Meeting event with end time after start time, edit its title, then delete a disposable event.'
    ],
    'Missing required fields and invalid meeting time ranges are rejected. Holiday events synchronize with project holiday dates; edits and deletions persist.'
  );

  group('22. Administrator Team master list, Inventory master, Requests approval, and Document review');
  add(
    '45,46,47,48,49,50',
    'Create, edit, and delete Team master records and protect account-linked management profiles',
    'Administrator is signed in to Team.',
    [
      'Create a Skilled Worker with hourly rate PHP 100 and daily working hours (0–24 range).',
      'Attempt to create a Subcontractor without a company name, then provide a company name and save.',
      'Attempt to enter a negative hourly rate or daily hours above 24.',
      'Edit a worker record, delete a disposable standalone worker, and verify that account-linked Management records cannot be arbitrarily deleted from Team.'
    ],
    'Valid member creation and edits persist. Subcontractor company name is required. Out-of-range rates/hours are rejected. Account-linked management rows are protected from inappropriate Team deletion.'
  );
  add(
    '130,131,133,134,135',
    'Maintain Equipment Inventory master records and assign equipment to projects',
    'Administrator is signed in to Tools and Equipment (/admin/inventory).',
    [
      'Create a new equipment item with name, category, serial number, description, and status Available; verify auto-generated asset tag.',
      'Edit the equipment details and save.',
      'Assign the equipment to Project A with an assignment date.',
      'Attempt to record a return date earlier than the assignment date, then record a valid return date.'
    ],
    'Inventory item is created with a unique asset tag. Assignment updates status to Assigned. Return date prior to assignment date is rejected; valid return updates status to Returned/Available.'
  );
  add(
    '96,125,128',
    'Approve material/equipment requests and delete a disposable saved progress entry as Administrator',
    'Administrator is signed in; Project A has a Submitted material request, a Submitted equipment request, and a disposable saved progress entry.',
    [
      'Open the Submitted material request and equipment request as Administrator and click Approve.',
      'Open the disposable task progress history as Administrator and delete the disposable saved progress entry.'
    ],
    'Both requests transition to Approved status. The disposable saved progress entry is deleted and its quantities/costs are removed from current project actuals.'
  );
  add(
    '162,163,164,233,240',
    'Review submitted project documents and detect stale concurrent review decisions',
    'Two Administrator browser sessions have the same submitted drawing open in Project A.',
    [
      'In Admin Session 1, attempt to submit a review without required review notes.',
      'In Admin Session 1, submit an Accepted decision with review notes.',
      'In Admin Session 2 (unrefreshed), attempt to submit a Rejected decision on the same document revision.',
      'Inspect the document review history.'
    ],
    'Review notes are enforced. Session 1 Accepted decision saves and records reviewer/timestamp. Session 2 stale review submission is rejected by the optimistic state check.'
  );

  group('23. Foreman portal end-to-end workflows and role boundaries');
  add(
    '1,2,27,28,29,30',
    'Verify Foreman portal navigation, assigned project scope, and restricted modules',
    'Foreman is signed in to /foreman; assigned to Project A, not assigned to Project B.',
    [
      'Inspect Foreman sidebar navigation (Dashboard, Projects, Inventory, Reports, Notifications, Settings).',
      'Verify that Accounts and Team master management are not accessible to Foreman.',
      'Open assigned Project A, then attempt to open unassigned Project B via direct URL.'
    ],
    'Foreman accesses permitted portal modules and assigned Project A. Accounts, Team page, and unassigned Project B are blocked.'
  );
  add(
    '57,58,60,74,81,82,83,88,90,91,119,120,153,166,178,185,193',
    'Execute Foreman field operations in assigned project',
    'Foreman is signed in to assigned Project A.',
    [
      'View Cost Estimate and Gantt schedule; open a task progress modal.',
      'Record daily completed quantity, skilled worker attendance, stocked material usage, and equipment/other costs; save.',
      'Submit a Material Request, an Equipment Request, a Safety Incident, and a Project Document.',
      'In Reports, create/update a Punch-List item and a Quality Inspection, and generate a project report.'
    ],
    'Foreman can perform all authorized project-level execution, request, incident, document submission, punch-list, inspection, and reporting workflows on assigned projects while administrative approvals/deletions remain restricted.'
  );

  group('24. System security, session expiration, and disaster-recovery backup & restore');
  add(
    '10,224,225',
    'Enforce 30-minute inactivity and 12-hour maximum login session expiration (Migration 0106)',
    'Authenticated user session with migration 0106_session_expiration installed.',
    [
      'Observe the session warning dialog 1 minute before the 30-minute inactivity deadline.',
      'Click Stay signed in and verify the inactivity timer extends while within the 12-hour absolute session cap.',
      'Allow a session to reach its inactivity or 12-hour expiration deadline and attempt a protected database read/write.'
    ],
    'Warning appears 1 minute prior to expiration. Expired sessions are rejected by PostgreSQL restrictive RLS policies and Data API pre-request checks until the user re-authenticates.'
  );
  add(
    '221,222,224,225,227,228,241',
    'Verify technical security boundaries, private storage access, and Super Admin Backup & Restore (Migration 0105)',
    'Super Administrator is signed in to Settings; backup worker is configured; non-Super-Admin sessions are available.',
    [
      'Inspect client bundle/environment exposure to confirm privileged service role keys and backup encryption keys are server-only.',
      'Verify that Admin, PM, and Foreman cannot access Backup & Restore controls or RPCs.',
      'As Super Administrator, queue a manual backup ("Back up now"), verify AES-256-GCM package encryption and hash verification in Backup History, and test restoration with confirmation code.'
    ],
    'Privileged secrets remain server-only. Backup & Restore is strictly restricted to Super Administrator. Verified backup snapshot and safety-snapshot restore complete transactionally while enforcing maintenance write-locks.'
  );

  // Number all cases sequentially as TC-ALP-001 ... TC-ALP-NNN
  const covered = new Map();
  cases.forEach((c, i) => {
    c.id = `TC-ALP-${String(i + 1).padStart(3, '0')}`;
    for (const req of c.req) {
      if (!covered.has(req)) covered.set(req, []);
      covered.get(req).push(c.id);
    }
  });

  // Retired requirements per AGENTS.md & migration 0098
  const retiredReqs = new Set(['REQ147', 'REQ148', 'REQ149', 'REQ150', 'REQ151', 'REQ152']);

  // Build Workbook matching outputs/pm-uat-revision-20261025/build.mjs exact format & styling
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IDRMM System Alpha Testing';
  wb.created = new Date('2026-10-30T05:30:00Z');

  // =========================================================================
  // SHEET 1: Alpha Test Cases
  // =========================================================================
  const wsCases = wb.addWorksheet('Alpha Test Cases', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 2, showGridLines: false }]
  });

  const caseWidths = [17, 22, 36, 48, 55, 55, 18, 30];
  wsCases.columns = caseWidths.map((w) => ({ width: w }));

  const row1 = wsCases.addRow([
    'Test Case Number',
    'Linked Requirement',
    'Test Description',
    'Preconditions',
    'Test Steps',
    'Expected Result',
    'Result (Pass/Fail)',
    'Comments'
  ]);
  row1.height = 36;
  row1.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF79DCC0' } };
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF102E26' } };
    cell.alignment = { vertical: 'top', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFA6DEC9' } },
      bottom: { style: 'thin', color: { argb: 'FFA6DEC9' } },
      left: { style: 'thin', color: { argb: 'FFA6DEC9' } },
      right: { style: 'thin', color: { argb: 'FFA6DEC9' } }
    };
  });

  const row2 = wsCases.addRow([
    'Unique Alpha test ID',
    'Requirement IDs from system specification',
    'What the tester verifies across roles',
    'Role, records and setup needed',
    'Follow the numbered actions',
    'Observable pass condition',
    'Leave blank until run',
    'Record actual outcome, tester/date, evidence, defects or Blocked reason'
  ]);
  row2.height = 63;
  row2.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF56655F' } };
    cell.alignment = { vertical: 'top', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFA6DEC9' } },
      bottom: { style: 'thin', color: { argb: 'FFA6DEC9' } },
      left: { style: 'thin', color: { argb: 'FFA6DEC9' } },
      right: { style: 'thin', color: { argb: 'FFA6DEC9' } }
    };
  });

  function calcHeight(values, wsWidths) {
    return Math.max(
      46,
      ...values.map(
        (v, i) =>
          String(v)
            .split('\n')
            .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / (wsWidths[i] * 0.92))), 0) *
            15 +
          12
      )
    );
  }

  let prevSec = '';
  for (const c of cases) {
    if (c.section !== prevSec) {
      prevSec = c.section;
      const secRow = wsCases.addRow([c.section, '', '', '', '', '', '', '']);
      wsCases.mergeCells(secRow.number, 1, secRow.number, 8);
      secRow.height = 27;
      for (let col = 1; col <= 8; col++) {
        const cell = secRow.getCell(col);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE1F3EC' } };
        cell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF172B32' } };
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFA6DEC9' } },
          bottom: { style: 'thin', color: { argb: 'FFA6DEC9' } },
          left: { style: 'thin', color: { argb: 'FFA6DEC9' } },
          right: { style: 'thin', color: { argb: 'FFA6DEC9' } }
        };
      }
    }

    const rowVals = [c.id, c.req.join(', '), c.title, c.pre, c.steps, c.expected, '', ''];
    const r = wsCases.addRow(rowVals);
    r.height = calcHeight(rowVals, caseWidths);

    for (let col = 1; col <= 8; col++) {
      const cell = r.getCell(col);
      cell.font = { name: 'Arial', size: 11, color: { argb: 'FF172B32' } };
      cell.alignment = { vertical: 'top', wrapText: true };
      if (col === 7 || col === 8) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDF3' } };
      }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFA6DEC9' } },
        bottom: { style: 'thin', color: { argb: 'FFA6DEC9' } },
        left: { style: 'thin', color: { argb: 'FFA6DEC9' } },
        right: { style: 'thin', color: { argb: 'FFA6DEC9' } }
      };
    }

    r.getCell(7).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"Pass,Fail"']
    };
  }

  // =========================================================================
  // SHEET 2: Requirements Coverage
  // =========================================================================
  const wsCov = wb.addWorksheet('Requirements Coverage', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }]
  });
  const covWidths = [18, 76, 30, 47, 72];
  wsCov.columns = covWidths.map((w) => ({ width: w }));

  const covHeader = wsCov.addRow([
    'Requirement ID',
    'Requirement statement',
    'Alpha scope / disposition',
    'Mapped test cases',
    'Coverage qualification'
  ]);
  covHeader.height = 36;
  covHeader.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF79DCC0' } };
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF102E26' } };
    cell.alignment = { vertical: 'top', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFA6DEC9' } },
      bottom: { style: 'thin', color: { argb: 'FFA6DEC9' } },
      left: { style: 'thin', color: { argb: 'FFA6DEC9' } },
      right: { style: 'thin', color: { argb: 'FFA6DEC9' } }
    };
  });

  for (const r of requirements) {
    const refs = covered.get(r.id) || [];
    let status = 'System Alpha workflow';
    let note = '';

    if (retiredReqs.has(r.id)) {
      status = 'Retired workflow (Migration 0098)';
      note =
        'Completion forecasting, SPI delay-risk assessment, and legacy Daily Logs survey escalation have been retired from the system per AGENTS.md and migration 0098.';
    } else if (Number(r.id.slice(3)) >= 221) {
      status = 'Technical & non-functional Alpha verification';
      note = 'Verified across role boundaries, server actions, RLS policies, file validators, and backup/session guards.';
    }

    const rowVals = [r.id, r.text, status, refs.join(', ') || 'Retired (not applicable)', note];
    const row = wsCov.addRow(rowVals);
    row.height = calcHeight(rowVals, covWidths);
    row.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 11, color: { argb: 'FF172B32' } };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFA6DEC9' } },
        bottom: { style: 'thin', color: { argb: 'FFA6DEC9' } },
        left: { style: 'thin', color: { argb: 'FFA6DEC9' } },
        right: { style: 'thin', color: { argb: 'FFA6DEC9' } }
      };
    });
  }

  // =========================================================================
  // SHEET 3: Test Setup
  // =========================================================================
  const wsSetup = wb.addWorksheet('Test Setup', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }]
  });
  const setupWidths = [28, 132];
  wsSetup.columns = setupWidths.map((w) => ({ width: w }));

  const setupRows = [
    ['Item', 'Instructions / preparation'],
    [
      'Purpose',
      'Whole-system Alpha Testing suite covering Super Administrator, Administrator, Project Manager, and Foreman workflows across REQ001–REQ242 and migrations 0001–0106. Eight test-case columns retained. Results and Comments start blank until executed.'
    ],
    [
      'Session details',
      'Before execution, record the application URL/build, test date, executing testers, browser/device, and evidence folder in the first case Comments.'
    ],
    [
      'Execution order',
      'Run invitation and account setup first, then project/team/inventory setup, cost estimate & Gantt scheduling, purchases/requests, equipment tracking, daily progress & expenses, safety incidents, project documents, punch list, quality inspections, reports, notifications, and finally recovery/backup/cleanup cases.'
    ],
    [
      'Roles covered',
      'Super Administrator (full system, accounts, permanent deletion, and Backup & Restore), Administrator (accounts for PM/Foreman, projects, Team master, Inventory master, request approvals, document reviews), Project Manager (assigned/granted projects, work groups, estimates, schedule, progress, reports), and Foreman (assigned/granted field execution, progress, requests, incidents, inspections, reports).'
    ],
    [
      'Test accounts',
      'Prepare Superadmin, Admin, PM-SA, PM-ADMIN, assigned Foreman, and a spare PM/Foreman for deactivation and project-handover tests. Never write passwords in this workbook.'
    ],
    [
      'Projects',
      'Admin creates disposable Project A and assigns the main PM and Foreman. Project B belongs to another PM for access-boundary and per-project access-grant tests. Never query or modify live data for "Sunrise Villas – Phase 1".'
    ],
    [
      'Workers & Equipment',
      'Admin prepares W1 (Skilled Worker, PHP 100/hour, Mon–Sat 8 hours, Sun 0), W2 (Skilled Worker for 24-hour cap tests), SC1 (Subcontractor with company name), and E1 (Available Concrete Mixer in Inventory).'
    ],
    [
      'Base stock & Expense fixture',
      'For stock/usage tests: UAT Cement purchase = 50 bags received @ PHP 200 (Amount PHP 10,000). For expense reconciliation: budget PHP 20,000; purchase PHP 10,000; saved labor PHP 800; equipment PHP 1,500; other PHP 300 (expected actual expense PHP 12,600, remaining budget PHP 7,400).'
    ],
    [
      'Retired features note',
      'Legacy Daily Logs, delay surveys, completion forecasting, and SPI delay-risk assessments have been retired (migration 0098 and AGENTS.md) and are marked as Retired in Requirements Coverage.'
    ],
    [
      'Result convention',
      'Choose Pass only when all expected behavior is observed. Choose Fail when observed behavior differs. If a service or fixture is unavailable, leave Result blank and write Blocked plus reason in Comments.'
    ]
  ];

  setupRows.forEach((vals, idx) => {
    const r = wsSetup.addRow(vals);
    if (idx === 0) {
      r.height = 36;
      r.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF79DCC0' } };
        cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF102E26' } };
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFA6DEC9' } },
          bottom: { style: 'thin', color: { argb: 'FFA6DEC9' } },
          left: { style: 'thin', color: { argb: 'FFA6DEC9' } },
          right: { style: 'thin', color: { argb: 'FFA6DEC9' } }
        };
      });
    } else {
      r.height = calcHeight(vals, setupWidths);
      r.eachCell((cell) => {
        cell.font = { name: 'Arial', size: 11, color: { argb: 'FF172B32' } };
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFA6DEC9' } },
          bottom: { style: 'thin', color: { argb: 'FFA6DEC9' } },
          left: { style: 'thin', color: { argb: 'FFA6DEC9' } },
          right: { style: 'thin', color: { argb: 'FFA6DEC9' } }
        };
      });
    }
  });

  const outPaths = [
    path.join(__dirname, 'IDRMM_Whole_System_Alpha_Testing.xlsx'),
    path.join(__dirname, '../IDRMM_Whole_System_Alpha_Testing.xlsx'),
    path.join(__dirname, '../../outputs/IDRMM_Whole_System_Alpha_Testing.xlsx'),
    path.join(__dirname, 'IDRMM_System_Alpha_Testing.xlsx'),
    path.join(__dirname, '../IDRMM_System_Alpha_Testing.xlsx'),
    path.join(__dirname, '../../outputs/IDRMM_System_Alpha_Testing.xlsx')
  ];

  for (const p of outPaths) {
    try {
      await wb.xlsx.writeFile(p);
      console.log('Saved:', p);
    } catch (e) {
      console.log('Skipped locked file (currently open in Excel):', p);
    }
  }
  console.log(`Total Whole-System Alpha Test Cases: ${cases.length}`);
}

generateWholeSystemAlphaWorkbook().catch((err) => {
  console.error(err);
  process.exit(1);
});

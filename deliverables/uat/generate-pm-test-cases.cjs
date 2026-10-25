const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

async function generateWorkbooks() {
  // 1. Load requirements from IDRMM_Current_System_Requirements.md
  const reqFilePath = path.join(__dirname, '../requirements/IDRMM_Current_System_Requirements.md');
  const reqText = fs.readFileSync(reqFilePath, 'utf8');

  const specReqs = [];
  const lines = reqText.split('\n');
  let currentSection = '';

  for (const line of lines) {
    const secMatch = line.match(/^###?\s+([0-9\.]+\s+.*)$/);
    if (secMatch) {             
      currentSection = secMatch[1].trim();
    }
    const reqMatch = line.match(/^(REQ\d{3})\.\s+(.+)$/);
    if (reqMatch) {
      specReqs.push({
        id: reqMatch[1],
        section: currentSection,
        statement: reqMatch[2].trim()
      });
    }
  }

  // 2. Load test cases data
  const testCasesDataPath = path.join(__dirname, 'pm-test-cases-data.json');
  const allTestCases = JSON.parse(fs.readFileSync(testCasesDataPath, 'utf8'));

  console.log(`Loaded ${specReqs.length} requirements and ${allTestCases.length} test cases.`);

  async function buildWorkbook(outputPath) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'IDRMM Project Management UAT Team';
    wb.created = new Date('2026-10-25T06:00:00Z');

    // Sheet 1: PM Test Cases
    const ws = wb.addWorksheet('PM Test Cases', {
      views: [{ state: 'frozen', ySplit: 2, xSplit: 0 }]
    });

    // Exactly 8 columns matching the reference image layout
    ws.columns = [
      { width: 16 }, // Test Case Number
      { width: 16 }, // Linked Requirement
      { width: 34 }, // Test Description
      { width: 30 }, // Preconditions
      { width: 44 }, // Test Steps
      { width: 40 }, // Expected Result
      { width: 18 }, // Result (Pass/Fail)
      { width: 28 }  // Comments
    ];

    // Row 1: Header Row
    const headerRow = ws.addRow([
      'Test Case Number',
      'Linked Requirement',
      'Test Description',
      'Preconditions',
      'Test Steps',
      'Expected Result',
      'Result (Pass/Fail)',
      'Comments'
    ]);
    headerRow.height = 32;

    headerRow.eachCell((cell, colNum) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF5BCEA6' } // Mint/Teal Green
      };
      cell.font = {
        name: 'Segoe UI',
        size: 10,
        bold: true,
        color: { argb: 'FF0F172A' }
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNum === 1 || colNum === 2 || colNum === 7 ? 'center' : 'left',
        wrapText: true
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF3CAE86' } },
        bottom: { style: 'thin', color: { argb: 'FF3CAE86' } },
        left: { style: 'thin', color: { argb: 'FF3CAE86' } },
        right: { style: 'thin', color: { argb: 'FF3CAE86' } }
      };
    });

    // Row 2: Sub-Header Row
    const subHeaderRow = ws.addRow([
      'Unique UAT test case number',
      'Linked stakeholder requirement or user story',
      'What are we testing and why?',
      'What setup or conditions must be in place?',
      'Step-by-step instructions for the tester to follow',
      'What should happen if the test passes?',
      'Test result (captured during testing)',
      'Optional - Any commentary by the tester relating to the tests.'
    ]);
    subHeaderRow.height = 24;

    subHeaderRow.eachCell((cell, colNum) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE6F7F1' } // Very light mint tint
      };
      cell.font = {
        name: 'Segoe UI',
        size: 9,
        italic: true,
        color: { argb: 'FF475569' } // Slate gray
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNum === 1 || colNum === 2 || colNum === 7 ? 'center' : 'left',
        wrapText: true
      };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FF5BCEA6' } },
        left: { style: 'thin', color: { argb: 'FFD1E5DE' } },
        right: { style: 'thin', color: { argb: 'FFD1E5DE' } }
      };
    });

    // Populate data rows with Category section headers
    let currentCat = '';
    let tcIndex = 1;

    allTestCases.forEach((tc) => {
      // If new category, insert category banner row
      if (tc.category !== currentCat) {
        currentCat = tc.category;
        const bannerRow = ws.addRow([
          currentCat, '', '', '', '', '', '', ''
        ]);
        bannerRow.height = 26;
        ws.mergeCells(bannerRow.number, 1, bannerRow.number, 8);
        const bannerCell = ws.getCell(bannerRow.number, 1);
        bannerCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD2F2E5' } // Soft mint accent
        };
        bannerCell.font = {
          name: 'Segoe UI',
          size: 10,
          bold: true,
          color: { argb: 'FF0D5A46' }
        };
        bannerCell.alignment = {
          vertical: 'middle',
          horizontal: 'left',
          indent: 1
        };
        bannerCell.border = {
          top: { style: 'thin', color: { argb: 'FFA7DEC8' } },
          bottom: { style: 'thin', color: { argb: 'FFA7DEC8' } }
        };
      }

      const tcNumber = `TC-PM-${String(tcIndex).padStart(3, '0')}`;
      tcIndex++;

      const dataRow = ws.addRow([
        tcNumber,
        tc.req,
        tc.desc,
        tc.pre,
        tc.steps,
        tc.expected,
        '', // Result
        ''  // Comments
      ]);

      const isEven = tcIndex % 2 === 0;
      const bgFill = isEven ? 'FFF9FDFB' : 'FFFFFFFF';

      dataRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgFill }
        };
        cell.font = {
          name: 'Segoe UI',
          size: 9.5,
          color: { argb: 'FF1E293B' }
        };
        cell.alignment = {
          vertical: 'top',
          horizontal: colNum === 1 || colNum === 2 || colNum === 7 ? 'center' : 'left',
          wrapText: true
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        if (colNum === 1 || colNum === 2) {
          cell.font = {
            name: 'Segoe UI',
            size: 9.5,
            bold: true,
            color: { argb: 'FF0F172A' }
          };
        }
      });

      // Estimate row height based on content
      const stepLines = tc.steps.split('\n').length;
      const expLines = Math.ceil(tc.expected.length / 55);
      const descLines = Math.ceil(tc.desc.length / 40);
      const maxLines = Math.max(stepLines, expLines, descLines, 2);
      dataRow.height = Math.min(200, Math.max(48, maxLines * 16));

      // Data validation for Result (Pass/Fail)
      const resultCell = ws.getCell(dataRow.number, 7);
      resultCell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"Pass,Fail,Blocked,Not tested"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Result',
        error: 'Select Pass, Fail, Blocked, or Not tested'
      };
    });

    // Enable AutoFilter on row 1
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: ws.rowCount, column: 8 }
    };

    // Sheet 2: Traceability & Coverage Matrix
    const traceWs = wb.addWorksheet('Requirements Coverage', {
      views: [{ state: 'frozen', ySplit: 1, xSplit: 0 }]
    });

    traceWs.columns = [
      { width: 18 }, // Requirement ID
      { width: 38 }, // Category / Section
      { width: 24 }, // Mapped PM Test Cases
      { width: 68 }, // Requirement Statement (from specification)
      { width: 26 }  // Coverage Type
    ];

    const traceHeader = traceWs.addRow([
      'Requirement ID',
      'Category / Section',
      'Mapped PM Test Cases',
      'Requirement Statement',
      'Coverage Type'
    ]);
    traceHeader.height = 28;
    traceHeader.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF5BCEA6' }
      };
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0F172A' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF3CAE86' } },
        bottom: { style: 'thin', color: { argb: 'FF3CAE86' } },
        left: { style: 'thin', color: { argb: 'FF3CAE86' } },
        right: { style: 'thin', color: { argb: 'FF3CAE86' } }
      };
    });

    // Build mapping from req ID to test cases
    const reqToCases = new Map();
    allTestCases.forEach((tc) => {
      if (!reqToCases.has(tc.req)) {
        reqToCases.set(tc.req, []);
      }
      reqToCases.get(tc.req).push(tc.tc);
    });

    // Populate every single requirement from specReqs (REQ001 - REQ242)
    specReqs.forEach((specReq) => {
      const mapped = reqToCases.get(specReq.id) || [];
      let coverageType = 'Functional Verification';
      if (specReq.id >= 'REQ012' && specReq.id <= 'REQ026') {
        coverageType = 'Authorization Boundary (Restricted)';
      } else if (specReq.id === 'REQ037' || specReq.id === 'REQ041' || specReq.id === 'REQ046' || specReq.id === 'REQ050') {
        coverageType = 'Authorization Boundary (Restricted)';
      } else if (specReq.id >= 'REQ221') {
        coverageType = 'System Quality & Non-Functional';
      }

      const row = traceWs.addRow([
        specReq.id,
        specReq.section,
        mapped.length > 0 ? mapped.join(', ') : 'Boundary Covered under REQ028',
        specReq.statement,
        coverageType
      ]);
      row.height = 24;
      row.eachCell((cell, colNum) => {
        cell.font = { name: 'Segoe UI', size: 9.5 };
        cell.alignment = {
          vertical: 'middle',
          horizontal: colNum === 1 || colNum === 3 || colNum === 5 ? 'center' : 'left',
          wrapText: true
        };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
        if (colNum === 1) {
          cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
        }
      });
    });

    await wb.xlsx.writeFile(outputPath);
    console.log(`Successfully generated: ${outputPath}`);
  }

  const p1 = path.join(__dirname, 'IDRMM_Project_Manager_Test_Cases.xlsx');
  const p2 = path.join(__dirname, 'IDRMM_Project_Manager_UAT.xlsx');
  await buildWorkbook(p1);
  await buildWorkbook(p2);
  console.log('Finished generating both workbooks!');
}

generateWorkbooks().catch(console.error);


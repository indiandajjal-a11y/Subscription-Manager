const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(process.cwd(), 'sonar-all-issues.json');
const filterFile = process.argv[3] || null;

try {
  const data = loadJsonFile(file);
  const issues = data.issues || [];
  if (filterFile) {
    const filtered = issues.filter(i => (i.component || i.file || '').endsWith(filterFile));
    filtered.forEach((i, idx) => {
      const comp = i.component || i.file || '';
      const line = i.line || (i.textRange && i.textRange.start && i.textRange.start.line) || 'N/A';
      console.log(`${idx+1}\t${i.rule}\t${i.severity}\t${comp}\t${line}\t${i.message}`);
    });
  } else {
    const summary = summarizeIssues(issues);
    printSummary(issues, summary);
  }
} catch (err) {
  console.error('Failed to parse file', file, err.message);
  process.exit(2);
}

function loadJsonFile(filePath) {
  const raw = fs.readFileSync(filePath);
  const text = decodeText(raw);
  return JSON.parse(text);
}

function decodeText(raw) {
  let text;

  if (hasUtf16LeBom(raw)) {
    text = raw.toString('utf16le');
  } else if (hasUtf16BeBom(raw)) {
    text = swapUtf16Be(raw).toString('utf16le');
  } else if (raw.includes(0)) {
    text = raw.toString('utf16le');
  } else {
    text = raw.toString('utf8');
  }

  return stripBom(text);
}

function hasUtf16LeBom(raw) {
  return raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe;
}

function hasUtf16BeBom(raw) {
  return raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff;
}

function swapUtf16Be(raw) {
  return Buffer.from(raw).swap16();
}

function stripBom(text) {
  return text.codePointAt(0) === 0xfeff ? text.slice(1) : text;
}

function summarizeIssues(issues) {
  const bySeverity = {};
  const byRule = {};
  const byFile = {};

  issues.forEach(i => {
    const sev = i.severity || 'UNKNOWN';
    const rule = i.rule || 'unknown';
    const file = (i.component || i.file || 'unknown').split(':').slice(-1)[0];

    bySeverity[sev] = (bySeverity[sev] || 0) + 1;
    byRule[rule] = (byRule[rule] || 0) + 1;
    byFile[file] = (byFile[file] || 0) + 1;
  });

  return { bySeverity, byRule, byFile };
}

function printSummary(issues, summary) {
  console.log('Total issues:', issues.length);
  printCounts('By severity:', summary.bySeverity);
  printCounts('Top rules:', summary.byRule, 10);
  printCounts('Top files:', summary.byFile, 10);
}

function printCounts(title, counts, limit = Infinity) {
  console.log(title);
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .forEach(([key, value]) => console.log('  ', key, ':', value));
}

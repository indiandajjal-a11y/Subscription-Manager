const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(process.cwd(), 'sonar-all-issues.json');
const rule = process.argv[3] || 'javascript:S1121';

function loadJsonFile(filePath) {
  const raw = fs.readFileSync(filePath);
  const text = decodeText(raw);
  return JSON.parse(text);
}

function decodeText(raw) {
  let text;
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    text = raw.toString('utf16le');
  } else if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    text = Buffer.from(raw).swap16().toString('utf16le');
  } else if (raw.includes(0)) {
    text = raw.toString('utf16le');
  } else {
    text = raw.toString('utf8');
  }
  if (text.codePointAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

const data = loadJsonFile(file);
const issues = (data.issues || []).filter(i => i.rule === rule && (i.component || i.file || '').endsWith('code/app.js'));
console.log('Found', issues.length, 'issues for rule', rule);
issues.forEach((i, idx) => {
  const comp = i.component || i.file || '';
  const line = i.line || (i.textRange && i.textRange.start && i.textRange.start.line) || 'N/A';
  console.log('\n---', idx+1, i.rule, i.severity, comp, 'line', line);
  console.log(i.message);
  if (i.textRange) console.log('textRange:', JSON.stringify(i.textRange));
});

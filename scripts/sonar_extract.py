import json, pathlib, sys
p = pathlib.Path('sonar-all-issues.json')
if not p.exists():
    print('ERROR: sonar-all-issues.json not found')
    sys.exit(2)
raw = p.read_bytes()
def decode_bytes(b):
    # detect BOMs
    if b.startswith(b"\xff\xfe"):
        return b.decode('utf-16le')
    if b.startswith(b"\xfe\xff"):
        return b.decode('utf-16be')
    try:
        return b.decode('utf-8-sig')
    except UnicodeDecodeError:
        # fallback to utf-16le as sonar exports sometimes use UTF-16
        try:
            return b.decode('utf-16le')
        except Exception:
            return b.decode('latin-1')

text = decode_bytes(raw)
try:
    data = json.loads(text)
except Exception:
    # Try decoding from second byte as UTF-16LE (handles stray leading byte cases)
    try:
        text2 = raw[1:].decode('utf-16le')
        data = json.loads(text2)
    except Exception:
        # last-resort: try latin-1 then json
        data = json.loads(raw.decode('latin-1'))
issues = data.get('issues', [])
print('TOTAL_ISSUES:', len(issues))
for idx, i in enumerate(issues, start=1):
    comp = i.get('component') or i.get('file') or ''
    line = i.get('line') or (i.get('textRange') or {}).get('start', {}).get('line')
    print(f"{idx}\t{i.get('rule')}\t{i.get('severity')}\t{comp}\t{line}\t{i.get('message')}")

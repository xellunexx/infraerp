// Static map of the server's write routes: does each one leave an event (emit/record/notify), directly or through
// a function it calls? Used by the "no silent write" guard (test/slack_guard.test.mjs). Reads source only.
import fs from 'node:fs'; import path from 'node:path';

const match = (s, i, open, close) => { let d = 0; for (let j = i; j < s.length; j++) { if (s[j] === open) d++; else if (s[j] === close && --d === 0) return j; } return s.length; };

export function writeRoutes(serverDir) {
  const files = fs.readdirSync(serverDir).filter(f => f.endsWith('.js'));
  const src = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(serverDir, f), 'utf8')]));
  const fns = {};
  for (const s of Object.values(src)) {
    for (const m of s.matchAll(/(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      const b = s.indexOf('{', match(s, m.index + m[0].length - 1, '(', ')'));
      fns[m[1]] ??= s.slice(b, match(s, b, '{', '}') + 1);
    }
    for (const m of s.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^()]|\([^()]*\))*\)\s*=>\s*/g)) {
      const at = m.index + m[0].length;
      fns[m[1]] ??= s[at] === '{' ? s.slice(at, match(s, at, '{', '}') + 1) : s.slice(at, s.indexOf('\n', at));
    }
  }
  const names = Object.keys(fns);
  const callRe = Object.fromEntries(names.map(n => [n, new RegExp(`(?<![\\w$.])${n.replace(/[$]/g, '\\$')}\\s*\\(`)]));
  const calls = body => names.filter(n => callRe[n].test(body));
  const direct = {
    tells: /(?<![\w$.])(emit|record|notify)\s*\(/,
    write: /\b(INSERT\s+INTO|INSERT\s+OR|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b|updateRow\s*\(/i,
  };
  const memo = { emit: { tells: true }, record: { tells: true }, notify: { tells: true } };
  const flags = (n, stack = new Set()) => {
    if (memo[n]) return memo[n];
    if (stack.has(n)) return {};
    stack.add(n);
    const b = fns[n] || '', r = Object.fromEntries(Object.entries(direct).map(([k, re]) => [k, re.test(b)]));
    for (const c of calls(b)) if (c !== n) { const x = flags(c, stack); for (const k in r) r[k] ||= !!x[k]; }
    stack.delete(n);
    return (memo[n] = r);
  };
  const rows = [];
  for (const [f, s] of Object.entries(src)) {
    const ms = [...s.matchAll(/app\.(get|post|put|patch|delete)\(\s*['`]([^'`]+)['`]/g)];
    ms.forEach(m => {
      if (m[1] === 'get') return;
      // the route's own call only: up to its closing bracket (code after it — e.g. event handlers — is not this route)
      const open = m.index + m[0].indexOf('(');
      const body = s.slice(m.index, match(s, open, '(', ')') + 1);
      const r = Object.fromEntries(Object.entries(direct).map(([k, re]) => [k, re.test(body)]));
      for (const c of calls(body)) { const x = flags(c); for (const k in r) r[k] ||= !!x[k]; }
      rows.push({ file: f, route: `${m[1].toUpperCase()} ${m[2]}`, ...r });
    });
  }
  return rows;
}

/** Every event type emitted with a literal `type:` (emit) or recorded (record). */
export function emittedTypes(serverDir) {
  const out = new Set();
  for (const f of fs.readdirSync(serverDir).filter(f => f.endsWith('.js'))) {
    const s = fs.readFileSync(path.join(serverDir, f), 'utf8');
    for (const m of s.matchAll(/(?<![\w$.])(emit|record)\s*\(/g)) {
      if (/function\s+$/.test(s.slice(Math.max(0, m.index - 9), m.index))) continue;
      const call = s.slice(m.index, match(s, m.index + m[0].length - 1, '(', ')') + 1);
      const t = call.match(/(?<![\w$])type:\s*['`]([\w.:-]+)['`]/)?.[1];
      if (t) out.add(t);
    }
  }
  return out;
}

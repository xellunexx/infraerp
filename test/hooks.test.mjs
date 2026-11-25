// React Rules of Hooks: a hook placed after a possible early return blanks the page (React error #310). Checked on the syntax tree of every page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const isHook = n => ts.isCallExpression(n) && /^use[A-Z]/.test(ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : n.expression.getText());
const isFn = n => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
export function lateHooks(source, file = 'x.tsx') {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), bad = [];
  const at = n => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const body = fn => {
    if (!fn.body || !ts.isBlock(fn.body)) return;
    let returned = false;
    for (const st of fn.body.statements) {
      let returnsHere = false;
      const walk = (n, conditional) => {
        if (isFn(n)) return;
        if (ts.isReturnStatement(n)) returnsHere = true;
        if (isHook(n) && (returned || conditional)) bad.push(at(n));
        const branch = ts.isIfStatement(n) || ts.isConditionalExpression(n) || ts.isIterationStatement(n, false);
        ts.forEachChild(n, c => walk(c, conditional || branch));
      };
      walk(st, false);
      if (returnsHere) returned = true;
    }
  };
  const visit = n => { if (isFn(n)) body(n); ts.forEachChild(n, visit); };
  visit(sf);
  return bad;
}

test('hooks guard recognises the defect and accepts the correct order', () => {
  assert.deepEqual(lateHooks('function A(){ const d = useLoad(); if (!d) return null; const [x] = useState(0); return x; }'), ['x.tsx:1']);
  assert.deepEqual(lateHooks('function A(){ if (z) { useState(0); } return null; }'), ['x.tsx:1']);
  assert.deepEqual(lateHooks('function A(){ const d = useLoad(); const [x] = useState(0); useEffect(() => { if (d) return; }); if (!d) return null; return x; }'), []);
});

test('no page calls a hook after an early return or inside a branch', () => {
  const dir = path.resolve(import.meta.dirname, '..', 'web', 'src');
  const files = fs.readdirSync(dir, { recursive: true }).filter(f => /\.tsx?$/.test(f));
  assert.ok(files.length > 15);
  assert.deepEqual(files.flatMap(f => lateHooks(fs.readFileSync(path.join(dir, f), 'utf8'), f)), []);
});

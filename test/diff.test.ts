import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnifiedDiff } from '../src/git/diff';

test('parseUnifiedDiff parses files, hunks, and line numbers', () => {
  const text = [
    'diff --git a/src/a.js b/src/a.js',
    'index 1111111..2222222 100644',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -1,2 +1,3 @@',
    ' const x = 1;',
    '-const y = 2;',
    '+const y = 3;',
    '+const z = 4;',
    ''
  ].join('\n');

  const diff = parseUnifiedDiff(text);
  assert.equal(diff.files.length, 1);

  const file = diff.files[0];
  assert.equal(file.newPath, 'src/a.js');
  assert.equal(file.additions, 2);
  assert.equal(file.deletions, 1);
  assert.equal(file.hunks.length, 1);

  const hunk = file.hunks[0];
  const addLines = hunk.lines.filter((l) => l.type === 'add');
  const delLines = hunk.lines.filter((l) => l.type === 'del');

  assert.equal(addLines.length, 2);
  assert.equal(delLines.length, 1);

  assert.equal(addLines[0].newLine, 2);
  assert.equal(addLines[1].newLine, 3);
  assert.equal(delLines[0].oldLine, 2);
});


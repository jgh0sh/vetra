import type { Diff, DiffFile, DiffHunk, DiffLine } from '../types';
import { guessLanguage } from './language';

function parseHunkHeader(header: string): { oldStart: number; oldLines: number; newStart: number; newLines: number } {
  // Example: @@ -12,5 +12,7 @@ optional header
  const match = /^@@\s+\-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(header);
  if (!match) {
    throw new Error(`Invalid hunk header: ${header}`);
  }
  return {
    oldStart: Number(match[1]),
    oldLines: match[2] ? Number(match[2]) : 1,
    newStart: Number(match[3]),
    newLines: match[4] ? Number(match[4]) : 1
  };
}

export function parseUnifiedDiff(diffText: string): Diff {
  const lines = diffText.split('\n');

  const files: DiffFile[] = [];
  let currentFile: DiffFile | undefined;
  let currentHunk: DiffHunk | undefined;

  let oldLineNo = 0;
  let newLineNo = 0;

  const pushHunk = () => {
    if (currentFile && currentHunk) {
      currentFile.hunks.push(currentHunk);
    }
    currentHunk = undefined;
  };

  const pushFile = () => {
    pushHunk();
    if (currentFile) {
      files.push(currentFile);
    }
    currentFile = undefined;
  };

  for (const rawLine of lines) {
    const line = rawLine ?? '';

    if (line.startsWith('diff --git ')) {
      pushFile();

      // diff --git a/path b/path
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (!match) continue;

      currentFile = {
        oldPath: match[1] === '/dev/null' ? undefined : match[1],
        newPath: match[2] === '/dev/null' ? undefined : match[2],
        hunks: [],
        additions: 0,
        deletions: 0,
        isNew: false,
        isDeleted: false
      };
      currentFile.language = guessLanguage(currentFile.newPath ?? currentFile.oldPath ?? '') ?? undefined;

      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith('new file mode ')) {
      currentFile.isNew = true;
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      currentFile.isDeleted = true;
      continue;
    }
    if (line.startsWith('rename from ')) {
      currentFile.oldPath = line.slice('rename from '.length).trim();
      continue;
    }
    if (line.startsWith('rename to ')) {
      currentFile.newPath = line.slice('rename to '.length).trim();
      continue;
    }

    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      // File markers; ignore (we already have paths from diff header/rename)
      continue;
    }

    if (line.startsWith('@@ ')) {
      pushHunk();
      const header = line;
      const parsed = parseHunkHeader(header);
      currentHunk = {
        header,
        ...parsed,
        lines: []
      };
      oldLineNo = parsed.oldStart;
      newLineNo = parsed.newStart;
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('\\ No newline at end of file')) continue;

    const prefix = line.slice(0, 1);
    const content = line.length > 0 ? line.slice(1) : '';

    const diffLine: DiffLine = { type: 'context', content };

    if (prefix === ' ') {
      diffLine.type = 'context';
      diffLine.oldLine = oldLineNo++;
      diffLine.newLine = newLineNo++;
    } else if (prefix === '+') {
      diffLine.type = 'add';
      diffLine.newLine = newLineNo++;
      currentFile.additions += 1;
    } else if (prefix === '-') {
      diffLine.type = 'del';
      diffLine.oldLine = oldLineNo++;
      currentFile.deletions += 1;
    } else {
      continue;
    }

    currentHunk.lines.push(diffLine);
  }

  pushFile();

  return { files };
}


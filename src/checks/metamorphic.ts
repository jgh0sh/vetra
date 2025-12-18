import { resolve } from 'node:path';
import type { Diff, EvidenceArtifact, MetamorphicInput, MetamorphicRelation, MetamorphicSpec, VetraConfig } from '../types';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/time';

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomString(): string {
  const len = randomInt(0, 40);
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-./';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[randomInt(0, alphabet.length - 1)];
  return out;
}

function deepEqual(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (!deepEqual(aKeys, bKeys)) return false;
    for (const k of aKeys) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function checkRelation(fn: (arg: any) => any, relation: MetamorphicRelation, input: any): { ok: boolean; details?: any } {
  const y = fn(input);
  if (relation === 'idempotent') {
    const yy = fn(y);
    const ok = deepEqual(yy, y);
    return ok ? { ok } : { ok, details: { input, y, yy } };
  }
  if (relation === 'trim_invariant') {
    const s = String(input);
    const y2 = fn(s.trim());
    const ok = deepEqual(y2, y);
    return ok ? { ok } : { ok, details: { input: s, trimmed: s.trim(), y, y2 } };
  }
  if (relation === 'case_invariant') {
    const s = String(input);
    const y2 = fn(s.toUpperCase());
    const ok = deepEqual(y2, y);
    return ok ? { ok } : { ok, details: { input: s, upper: s.toUpperCase(), y, y2 } };
  }
  return { ok: true };
}

function loadExport(root: string, spec: MetamorphicSpec): any {
  // MVP: only supports CommonJS modules (require-able). Use absolute path to avoid resolution surprises.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(resolve(root, spec.module));
  return mod?.[spec.export];
}

export async function runMetamorphicChecks(
  baseCwd: string,
  headCwd: string,
  _diff: Diff,
  config: VetraConfig
): Promise<EvidenceArtifact[]> {
  const enabled = config.checks?.metamorphic?.enabled ?? true;
  const specs = config.checks?.metamorphic?.specs ?? [];
  if (!enabled || specs.length === 0) return [];

  const artifacts: EvidenceArtifact[] = [];

  for (const spec of specs) {
    const inputType: MetamorphicInput = spec.input ?? 'string';
    const samples = spec.samples ?? 50;

    let baseFn: any;
    let headFn: any;
    try {
      baseFn = loadExport(baseCwd, spec);
      headFn = loadExport(headCwd, spec);
    } catch (err: any) {
      artifacts.push({
        id: newId('artifact_meta'),
        type: 'metamorphic',
        title: `Metamorphic check failed to load (${spec.module}:${spec.export})`,
        summary: String(err?.message ?? err),
        createdAt: nowIso(),
        raw: { spec }
      });
      continue;
    }

    if (typeof baseFn !== 'function' || typeof headFn !== 'function') {
      artifacts.push({
        id: newId('artifact_meta'),
        type: 'metamorphic',
        title: `Metamorphic target not a function (${spec.module}:${spec.export})`,
        summary: `Expected export "${spec.export}" to be a function in both base/head.`,
        createdAt: nowIso(),
        raw: { spec }
      });
      continue;
    }

    let found: EvidenceArtifact | undefined;

    for (let i = 0; i < samples; i++) {
      const input = inputType === 'number' ? randomInt(-1000, 1000) : randomString();

      const baseRes = checkRelation(baseFn, spec.relation, input);
      const headRes = checkRelation(headFn, spec.relation, input);

      // Only report as a PR regression if base holds but head breaks.
      if (baseRes.ok && !headRes.ok) {
        found = {
          id: newId('artifact_meta'),
          type: 'metamorphic',
          title: `Metamorphic regression: ${spec.relation}`,
          summary: `${spec.module}:${spec.export} violates ${spec.relation} on head (base ok).`,
          createdAt: nowIso(),
          file: spec.module,
          raw: { spec, input, base: baseRes, head: headRes }
        };
        break;
      }
    }

    if (found) artifacts.push(found);
    else {
      artifacts.push({
        id: newId('artifact_meta_summary'),
        type: 'metamorphic',
        title: `Metamorphic check summary: ${spec.module}:${spec.export}`,
        summary: `No ${spec.relation} regressions found in ${samples} samples.`,
        createdAt: nowIso(),
        file: spec.module,
        raw: { spec, samples }
      });
    }
  }

  return artifacts;
}

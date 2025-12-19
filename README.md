# vetra

A TypeScript MVP PR review harness implementing a Planner/Executor/Verifier (PEV) pipeline.

## Demo

```bash
npm install
npm run demo
```

Demo output is written to `./vetra-demo_*.log` (override with `VETRA_DEMO_LOG_FILE`).

## Benchmark (SWRBench)

```bash
cp .env.example .env
# set OPENROUTER_API_KEY=...
npm run bench:swr
```

If official SWRBench data is available:

```bash
export SWRBENCH_HOST_SWRBENCH_DIR=/absolute/path/to/SWRBench
export SWRBENCH_SYNTHETIC_FALLBACK=0
npm run bench:swr
```

## Tests

```bash
npm test
```

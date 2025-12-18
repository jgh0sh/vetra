# vetra

An MVP, TypeScript-based pull request review harness implementing the paper's Planner–Executor–Verifier (PEV) pipeline.

## Status

Work in progress.

## What you get (MVP)

- `Planner`: computes a simple PR risk score and derives a review budget.
- `Executor`: gathers context, runs optional dynamic checks (CI command, metamorphic checks, diff-scoped mutation, micro-benchmarks), and invokes a pluggable verifier model.
- `Verifier`: enforces evidence-gated high severity comments, ranks, aggregates, and outputs a Markdown review.

## Quickstart

```bash
npm install
npm run build
node dist/src/cli.js review --repo . --base HEAD~1 --head HEAD --title "Local review"
```

## Demo (creates a temporary git repo)

```bash
npm run demo
```

The demo runs two reviews over the same synthetic PR: a `--budget quick` pass (CI-only) and an auto, risk-budgeted pass that exercises metamorphic checks, diff-scoped mutation, and a micro-benchmark.

## Config

- Copy `vetra.config.example.json` to `vetra.config.json` in the repo you want to review, then adjust commands/checks.
- Run `vetra review --config path/to/vetra.config.json` (or rely on the default lookup at `<repo>/vetra.config.json`).

## Using an LLM (optional)

```bash
export OPENAI_API_KEY=...
export VETRA_OPENAI_REVIEW_MODEL=gpt-4o-mini
export VETRA_OPENAI_CHECKER_MODEL=gpt-4o-mini
node dist/src/cli.js review --model openai --checker openai --repo . --base HEAD~1 --head HEAD
```

## Outcome logging (MVP)

By default `vetra review` appends a record to `<repo>/.vetra/reviews.jsonl`.

Record whether a comment led to changes:

```bash
node dist/src/cli.js outcome --repo . --comment <comment_id> --status accepted
```

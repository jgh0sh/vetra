#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

load_dotenv="${SWRBENCH_LOAD_DOTENV:-1}"
if [ "$load_dotenv" = "1" ] && [ -f "$repo_root/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$repo_root/.env"
  set +a
fi

is_isolated_env() {
  if [ -f "/.dockerenv" ]; then
    return 0
  fi
  if [ -r "/proc/1/cgroup" ] && grep -qaE "(docker|kubepods|containerd)" "/proc/1/cgroup"; then
    return 0
  fi
  return 1
}

require_isolation="${SWRBENCH_REQUIRE_ISOLATION:-1}"
allow_host_run="${SWRBENCH_ALLOW_HOST_RUN:-0}"

run_in_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Refusing to run on host and docker is not available."
    echo "Install Docker, or set SWRBENCH_ALLOW_HOST_RUN=1 to run on host."
    exit 2
  fi

  docker_image="${SWRBENCH_DOCKER_IMAGE:-vetra-swrbench-bench:latest}"
  dockerfile="${SWRBENCH_DOCKERFILE:-$repo_root/scripts/Dockerfile.swrbench-bench}"
  docker_context="${SWRBENCH_DOCKER_CONTEXT:-$repo_root/scripts}"
  docker_rebuild="${SWRBENCH_DOCKER_REBUILD:-0}"

  if [ "$docker_rebuild" = "1" ] || ! docker image inspect "$docker_image" >/dev/null 2>&1; then
    echo "==> Building docker image: $docker_image"
    docker build -t "$docker_image" -f "$dockerfile" "$docker_context"
  fi

  mount_args=(-v "$repo_root:/workspace")
  host_swrbench_dir="${SWRBENCH_HOST_SWRBENCH_DIR:-}"
  if [ -z "$host_swrbench_dir" ] && [ -d "/SWRBench" ]; then
    host_swrbench_dir="/SWRBench"
  fi
  if [ -n "$host_swrbench_dir" ]; then
    if [ ! -d "$host_swrbench_dir" ]; then
      echo "SWRBENCH_HOST_SWRBENCH_DIR is set but not a directory: $host_swrbench_dir"
      exit 2
    fi
    mount_args+=(-v "$host_swrbench_dir:/SWRBench")
  else
    echo "Note: /SWRBench is not mounted into the container."
    echo "  - Set SWRBENCH_HOST_SWRBENCH_DIR to your SWRBench checkout (must contain data/ and data/projects/), or"
    echo "  - Set SWRBENCH_DATASET_FILE and SWRBENCH_REPOS_DIR to paths visible inside the container."
  fi

  # Forward common env vars (OpenRouter/OpenAI/Vetra/SWRBench) into the container.
  env_args=()
  while IFS='=' read -r name _; do
    case "$name" in
      SWRBENCH_PYTHON)
        # Always use the container's venv python (set explicitly below).
        ;;
      OPENROUTER_*|OPENAI_*|VETRA_*|SWRBENCH_*)
        env_args+=(-e "$name")
        ;;
    esac
  done < <(env)

  user_args=()
  if command -v id >/dev/null 2>&1; then
    user_args=(--user "$(id -u):$(id -g)")
  fi

  echo "==> Spawning isolated docker run"
  docker_cmd=(docker run --rm -t -w /workspace)
  docker_cmd+=("${mount_args[@]}")
  if [ "${#env_args[@]}" -gt 0 ]; then
    docker_cmd+=("${env_args[@]}")
  fi
  docker_cmd+=(-e SWRBENCH_PYTHON=/opt/venv/bin/python)
  docker_cmd+=(-e HOME=/tmp)
  if [ "${#user_args[@]}" -gt 0 ]; then
    docker_cmd+=("${user_args[@]}")
  fi
  docker_cmd+=("$docker_image" bash -lc "bash scripts/run_swrbench_benchmark.sh")
  "${docker_cmd[@]}"
}

if [ "$require_isolation" = "1" ] && [ "$allow_host_run" != "1" ]; then
  if ! is_isolated_env; then
    run_in_docker
    exit $?
  fi
fi

if [ -z "${OPENROUTER_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "Missing OPENROUTER_API_KEY (preferred) or OPENAI_API_KEY."
  exit 2
fi

python_bin="${SWRBENCH_PYTHON:-python3}"
if ! command -v "$python_bin" >/dev/null 2>&1; then
  python_bin="python"
fi
if ! command -v "$python_bin" >/dev/null 2>&1; then
  echo "Missing python. Set SWRBENCH_PYTHON or install python3."
  exit 2
fi

dataset="${SWRBENCH_DATASET_FILE:-${SWRBENCH_DATASET:-}}"
dataset_kind="official"
if [ -z "$dataset" ]; then
  for cand in "/SWRBench/data/swr_datasets_0520_d5c5.jsonl" "/SWRBench/data/swr_datasets.jsonl"; do
    if [ -f "$cand" ]; then
      dataset="$cand"
      break
    fi
  done
fi

if [ -z "$dataset" ] || [ ! -f "$dataset" ]; then
  fallback_synth="${SWRBENCH_SYNTHETIC_FALLBACK:-1}"
  if [ "$fallback_synth" != "1" ]; then
    echo "Dataset file not found. Set SWRBENCH_DATASET_FILE to a .jsonl dataset path."
    exit 2
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "Dataset file not found and node is not available to generate synthetic data."
    echo "Set SWRBENCH_DATASET_FILE, or install node, or set SWRBENCH_SYNTHETIC_FALLBACK=0 to fail fast."
    exit 2
  fi

  synth_out="${SWRBENCH_SYNTHETIC_OUT_DIR:-$repo_root/.swrbench-synthetic}"
  synth_count="${SWRBENCH_SYNTHETIC_COUNT:-8}"
  synth_seed="${SWRBENCH_SYNTHETIC_SEED:-42}"
  synth_clean="${SWRBENCH_SYNTHETIC_CLEAN:-1}"

  echo "==> Dataset not found; generating synthetic SWRBench dataset (not an official benchmark score)"
  gen_args=(--out-dir "$synth_out" --count "$synth_count" --seed "$synth_seed")
  if [ "$synth_clean" = "1" ]; then
    gen_args+=(--clean)
  fi
  node "$repo_root/scripts/generate_swrbench_synthetic_data.js" "${gen_args[@]}"

  dataset="$synth_out/data/swr_datasets_synthetic.jsonl"
  dataset_kind="synthetic"

  if [ ! -f "$dataset" ]; then
    echo "Synthetic dataset generation succeeded but dataset file is missing: $dataset"
    exit 2
  fi
fi

if [ -n "${SWRBENCH_REPOS_DIR:-}" ]; then
  repos_dir="${SWRBENCH_REPOS_DIR}"
else
  if [ "$dataset_kind" = "synthetic" ]; then
    repos_dir="$(dirname "$dataset")/projects"
  else
    repos_dir="${SWRBENCH_REPOS_DIR:-/SWRBench/data/projects}"
  fi
fi
base_ref="${SWRBENCH_BASE_REF:-base_branch}"
head_ref="${SWRBENCH_HEAD_REF:-branch_under_review}"
budget="${SWRBENCH_BUDGET:-standard}"
num_threads="${SWRBENCH_NUM_THREADS:-4}"
max_output_comments="${SWRBENCH_MAX_OUTPUT_COMMENTS:-3}"
judge_model="${SWRBENCH_JUDGE_MODEL:-google/gemini-2.5-flash}"

dataset_name="$(basename "$dataset")"
dataset_name="${dataset_name%.jsonl}"

run_id="${SWRBENCH_RUN_ID:-}"
if [ -z "$run_id" ]; then
  ts="$(date +%Y%m%d_%H%M%S 2>/dev/null || date)"
  run_id="vetra_${ts}"
fi

sanitize() {
  # Keep path-safe characters only.
  echo "$1" | sed 's/[^a-zA-Z0-9._-]/_/g'
}

run_id_safe="$(sanitize "$run_id")"
judge_model_safe="$(sanitize "$judge_model")"

logs_dir="${SWRBENCH_LOGS_DIR:-$repo_root/swrbench-1D0E/logs/$dataset_name/$run_id_safe}"
mkdir -p "$logs_dir"

gen_file="$logs_dir/generation.jsonl"
eval_file="$logs_dir/evaluation__${judge_model_safe}.json"

echo "==> Repo: $repo_root"
echo "==> Dataset kind: $dataset_kind"
echo "==> Dataset: $dataset"
echo "==> Repos dir: $repos_dir"
echo "==> Run id: $run_id_safe"
echo "==> Judge model: $judge_model"
echo "==> Logs dir: $logs_dir"

cd "$repo_root"

if [ ! -d "$repo_root/node_modules" ]; then
  echo "==> Installing Node dependencies (npm ci)"
  npm ci
fi

echo "==> Building Vetra"
npm run build

echo "==> Generating predictions"
node dist/scripts/swrbench.js \
  --dataset-file "$dataset" \
  --output-file "$gen_file" \
  --clean \
  --repos-dir "$repos_dir" \
  --base-ref "$base_ref" \
  --head-ref "$head_ref" \
  --model openai \
  --checker openai \
  --budget "$budget" \
  --max-output-comments "$max_output_comments" \
  --num-threads "$num_threads"

echo "==> Evaluating"
"$python_bin" swrbench-1D0E/swrbench/evaluation_struct.py \
  --model "$judge_model" \
  --num-threads 32 \
  --dataset-file "$dataset" \
  --pred-file "$gen_file" \
  --output-file "$eval_file"

echo "==> Score"
EVAL_FILE="$eval_file" \
JUDGE_MODEL="$judge_model" \
RUN_ID="$run_id_safe" \
LOGS_DIR="$logs_dir" \
DATASET_FILE="$dataset" \
REPOS_DIR="$repos_dir" \
DATASET_KIND="$dataset_kind" \
node - <<'NODE'
const fs = require('fs');
const evalPath = process.env.EVAL_FILE;
const judgeModel = process.env.JUDGE_MODEL;
const runId = process.env.RUN_ID;
const logsDir = process.env.LOGS_DIR;
const datasetFile = process.env.DATASET_FILE;
const reposDir = process.env.REPOS_DIR;
const datasetKind = process.env.DATASET_KIND;

function sanitizeNonJsonNumbers(text) {
  const isIdent = (ch) => typeof ch === 'string' && /[A-Za-z0-9_]/.test(ch);
  const isBoundary = (ch) => !isIdent(ch);

  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    const next = text[i + 1];
    const prev = i > 0 ? text[i - 1] : undefined;

    if (
      text.startsWith('NaN', i) &&
      isBoundary(prev) &&
      isBoundary(text[i + 3])
    ) {
      out += 'null';
      i += 2;
      continue;
    }

    if (
      text.startsWith('-Infinity', i) &&
      isBoundary(prev) &&
      isBoundary(text[i + 9])
    ) {
      out += 'null';
      i += 8;
      continue;
    }

    if (
      text.startsWith('Infinity', i) &&
      isBoundary(prev) &&
      isBoundary(text[i + 8])
    ) {
      out += 'null';
      i += 7;
      continue;
    }

    out += ch;
  }

  return out;
}

const rawText = fs.readFileSync(evalPath, 'utf8');
let raw;
try {
  raw = JSON.parse(rawText);
} catch (err) {
  // SWRBench's evaluation code may emit NaN/Infinity via Python's json module (allow_nan=True).
  // Sanitize to strict JSON so we can parse and print scores.
  raw = JSON.parse(sanitizeNonJsonNumbers(rawText));
}
const overall = raw?.analysis_results?.overall;
if (!overall) {
  console.error('Missing analysis_results.overall in', evalPath);
  process.exit(2);
}

const out = {
  run_id: runId,
  judge_model: judgeModel,
  logs_dir: logsDir,
  dataset_kind: datasetKind,
  dataset_file: datasetFile,
  repos_dir: reposDir,
  eval_file: evalPath,
  score: {
    f1_point: overall.f1_point,
    precision_point: overall.precision_point,
    recall_point: overall.recall_point,
    accuracy: overall.accuracy,
  },
  counts: {
    tp_point: overall.tp_point,
    fp_point: overall.fp_point,
    fn_point: overall.fn_point,
    tp: overall.tp,
    fp: overall.fp,
    fn: overall.fn,
    tn: overall.tn,
  },
};

console.log(JSON.stringify(out, null, 2));
NODE

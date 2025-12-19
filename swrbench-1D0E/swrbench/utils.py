import json
import os
import random
from openai import OpenAI
import requests
from dateutil.parser import parse
from datetime import timezone
import time
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from loguru import logger

_api_base = (
    os.getenv('OPENAI_API_BASE')
    or os.getenv('OPENROUTER_BASE_URL')
    or os.getenv('OPENROUTER_API_BASE')
    or 'https://openrouter.ai/api/v1'
)
_api_key = os.getenv('OPENAI_API_KEY') or os.getenv('OPENROUTER_API_KEY') or ''

OPENAI_API_BASE = [u.strip() for u in _api_base.split(",") if u.strip()]
OPENAI_API_KEY = [k.strip() for k in _api_key.split(",") if k.strip()]

OPENROUTER_HTTP_REFERER = os.getenv("OPENROUTER_HTTP_REFERER") or os.getenv("OPENROUTER_SITE_URL")
OPENROUTER_X_TITLE = os.getenv("OPENROUTER_X_TITLE") or os.getenv("OPENROUTER_APP_NAME")

def save_jsonl(filename, data):
    with open(filename, 'w', encoding='utf-8') as f:
        for item in data:
            f.write(json.dumps(item, ensure_ascii=False, default=str) + '\n')

def load_jsonl(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        return [json.loads(line) for line in f]

def load_json(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_json(filename, data):
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
        
class RateLimiter:
    def __init__(self, calls_per_second=3):
        self.min_interval = 1.0 / calls_per_second
        self.last_call = 0

    def __call__(self):
        now = time.time()
        elapsed = now - self.last_call
        wait = max(self.min_interval - elapsed, 0)
        if wait > 0:
            time.sleep(wait)
        self.last_call = time.time()

rate_limiter = RateLimiter()

@retry(stop=stop_after_attempt(10),
       wait=wait_exponential(multiplier=1, min=4, max=60),
       retry=retry_if_exception_type((requests.exceptions.RequestException, Exception)),
       before_sleep=lambda _: rate_limiter())
def retry_function(func, *args, **kwargs):
    return func(*args, **kwargs)


def run_chat(model, messages, temperature=0.6, max_tokens=None, response_format=None, max_retries=15):
    client = None
    for attempt in range(max_retries):
        try:
            if not OPENAI_API_BASE:
                raise ValueError("Missing OPENAI_API_BASE/OPENROUTER_BASE_URL")
            if not OPENAI_API_KEY:
                raise ValueError("Missing OPENAI_API_KEY/OPENROUTER_API_KEY")
            base_url = random.choice(OPENAI_API_BASE)
            api_key = random.choice(OPENAI_API_KEY)
            client = OpenAI(
                base_url=base_url,
                api_key=api_key,
            )
            extra_headers = {}
            if OPENROUTER_HTTP_REFERER:
                extra_headers["HTTP-Referer"] = OPENROUTER_HTTP_REFERER
            if OPENROUTER_X_TITLE:
                extra_headers["X-Title"] = OPENROUTER_X_TITLE
            try:
                response = client.chat.completions.create(
                    extra_headers=extra_headers,
                    extra_body={},
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    response_format=response_format
                )
            except TypeError:
                # Backwards compatibility with older OpenAI Python SDKs that don't support extra_headers/extra_body.
                response = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    response_format=response_format
                )
            answer = response.choices[0].message.content
            return answer
        except Exception as e:
            logger.error(e)
            if "invalid_request_error" in str(e):
                logger.error(f"Invalid request error: {e}")
                return None
            if "sensitive words detected" in str(e):
                logger.error(f"Sensitive words detected: {e}")
                return None
            delay = 2 * (2**attempt)
            logger.warning(f"Failed to generate text, retrying after {delay} seconds ...")
            time.sleep(delay)
        finally:
            if client:
                client.close()
                
    logger.error(f"Failed to generate text after {max_retries} attempts.")
    return None


def safe_parse_time(time_str, logging=None):
    if not time_str or time_str.strip() == '':
        return None
    try:
        return parse(time_str).replace(tzinfo=timezone.utc)
    except (ValueError, TypeError, OverflowError) as e:
        if logging:
            logging.warning(f"时间解析失败: {time_str} - {str(e)}")
        return None

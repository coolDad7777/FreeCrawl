#!/usr/bin/env bash
# Live end-to-end check against real websites. Requires a running FreeCrawl.
#   ./scripts/smoke.sh [base-url]
set -uo pipefail

BASE="${1:-http://localhost:3000}"
PASS=0
FAIL=0

jqp() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1],{'d':d,'len':len,'str':str}))" "$1"; }

hr() { printf '%s\n' "────────────────────────────────────────────────────────────────────────"; }

check() { # check <description> <actual> <expectation-substring>
  if printf '%s' "$2" | grep -qiF -- "$3"; then
    printf '  PASS  %s\n' "$1"; PASS=$((PASS + 1))
  else
    printf '  FAIL  %s\n        expected to contain: %s\n        got: %s\n' "$1" "$3" "${2:0:300}"; FAIL=$((FAIL + 1))
  fi
}

post() { curl -sS -X POST "$BASE$1" -H 'Content-Type: application/json' -d "$2"; }

hr; echo "FreeCrawl live smoke test against $BASE"; echo "started $(date -u +%FT%TZ)"; hr

echo; echo "1. GET /health"
HEALTH=$(curl -sS "$BASE/health")
check "service reports ok" "$HEALTH" '"status":"ok"'
echo "  queue=$(printf '%s' "$HEALTH" | jqp "d['queue']")  cache=$(printf '%s' "$HEALTH" | jqp "d['cache']['enabled']")  searxng=$(printf '%s' "$HEALTH" | jqp "d['searchEngines']['searxng']")"

echo; echo "2. POST /v1/scrape — Wikipedia article to markdown"
R=$(post /v1/scrape '{"url":"https://en.wikipedia.org/wiki/Web_scraping","formats":["markdown","links"]}')
check "succeeded" "$R" '"success":true'
check "kept the article heading" "$R" 'Web scraping'
python3 - "$R" <<'PY'
import json, sys
d = json.loads(sys.argv[1])['data']
md = d.get('markdown', '')
print(f"  engine={d['metadata']['engine']}  status={d['metadata']['statusCode']}  "
      f"{d['metadata']['scrapeDurationMs']}ms  markdown={len(md)} chars  links={len(d.get('links', []))}")
print(f"  title={d['metadata']['title']!r}")
noise = [n for n in ('Jump to content', 'Donate now', 'Privacy policy', 'Create account', '[edit]') if n in md]
print(f"  boilerplate leaked: {noise or 'none'}")
print('  --- first 320 chars of markdown ---')
print('  ' + md[:320].replace('\n', '\n  '))
PY

echo; echo "3. POST /v1/scrape — fetch engine vs browser engine on the same page"
for ENGINE in fetch browser; do
  post /v1/scrape "{\"url\":\"https://news.ycombinator.com\",\"formats\":[\"markdown\"],\"engine\":\"$ENGINE\",\"skipCache\":true}" > /tmp/freecrawl-engine.json
  python3 - "$ENGINE" /tmp/freecrawl-engine.json <<'PY'
import json, sys
d = json.load(open(sys.argv[2]))['data']
m = d['metadata']
print(f"  requested={sys.argv[1]:8s} used={m['engine']:8s} {m['scrapeDurationMs']:6d}ms  {len(d.get('markdown', '')):6d} chars")
PY
done

echo; echo "4. POST /v1/scrape — cache hit on a repeat request"
post /v1/scrape '{"url":"https://example.com","formats":["markdown"]}' > /dev/null
R=$(post /v1/scrape '{"url":"https://example.com","formats":["markdown"]}')
check "second request served from cache" "$R" '"engine":"cache"'

echo; echo "5. POST /v1/scrape — screenshot via the browser engine"
R=$(post /v1/scrape '{"url":"https://example.com","formats":["markdown","screenshot"]}')
python3 - "$R" <<'PY'
import base64, json, sys
d = json.loads(sys.argv[1])['data']
shot = d.get('screenshot') or ''
raw = base64.b64decode(shot) if shot else b''
ok = raw[:8] == b'\x89PNG\r\n\x1a\n'
print(f"  engine={d['metadata']['engine']}  png_signature={'valid' if ok else 'MISSING'}  bytes={len(raw)}")
sys.exit(0 if ok else 1)
PY
[ $? -eq 0 ] && { echo "  PASS  screenshot is a real PNG"; PASS=$((PASS+1)); } || { echo "  FAIL  screenshot"; FAIL=$((FAIL+1)); }

echo; echo "6. POST /v1/scrape — robots.txt is obeyed"
R=$(post /v1/scrape '{"url":"https://www.google.com/search?q=test","respectRobotsTxt":true}')
check "disallowed path is refused" "$R" 'blocked_by_robots'
R=$(post /v1/scrape '{"url":"https://www.google.com/search?q=test","respectRobotsTxt":false,"formats":["markdown"]}')
check "opting out allows the same URL" "$R" '"success":true'

echo; echo "7. POST /v1/map — sitemap plus page links"
R=$(post /v1/map '{"url":"https://playwright.dev","limit":40}')
check "succeeded" "$R" '"success":true'
python3 - "$R" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
print(f"  links={len(d['links'])}  from_sitemap={d['sources']['sitemap']}  from_page={d['sources']['page']}")
for link in d['links'][:5]:
    print(f"    {link}")
assert all(l.startswith('http') for l in d['links']), 'non-absolute URL returned'
assert not any(l.endswith(('.css', '.js', '.png')) for l in d['links']), 'asset URL returned'
PY
check "map returned only clean absolute page URLs" "$?" "0"

echo; echo "8. POST /v1/map — search term filtering"
R=$(post /v1/map '{"url":"https://playwright.dev","search":"docs","limit":10}')
python3 - "$R" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
print(f"  matched={len(d['links'])}  all contain 'docs': {all('docs' in l for l in d['links'])}")
PY

echo; echo "9. POST /v1/crawl — real site, bounded to 5 pages"
START=$(post /v1/crawl '{"url":"https://playwright.dev/docs/intro","limit":5,"maxDepth":2,"scrapeOptions":{"formats":["markdown"]}}')
JOB=$(printf '%s' "$START" | jqp "d['id']")
echo "  job=$JOB"
for _ in $(seq 1 90); do
  STATUS=$(curl -sS "$BASE/v1/crawl/$JOB?limit=5")
  STATE=$(printf '%s' "$STATUS" | jqp "d['status']")
  [ "$STATE" = completed ] || [ "$STATE" = failed ] || [ "$STATE" = cancelled ] && break
  sleep 1
done
check "crawl completed" "$STATE" "completed"
python3 - "$STATUS" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
print(f"  status={d['status']}  completed={d['completed']}/{d['total']}  progress={d['progress']}%  errors={d['errorCount']}")
for doc in d['data']:
    m = doc['metadata']
    print(f"    {m['statusCode']} {m['engine']:7s} {len(doc.get('markdown','')):6d} chars  {m['sourceURL']}")
PY

echo; echo "10. POST /v1/crawl — cancellation"
START=$(post /v1/crawl '{"url":"https://playwright.dev","limit":100,"maxDepth":3}')
JOB=$(printf '%s' "$START" | jqp "d['id']")
sleep 1
R=$(curl -sS -X DELETE "$BASE/v1/crawl/$JOB")
check "cancel accepted" "$R" '"status":"cancelled"'
R=$(curl -sS -X DELETE "$BASE/v1/crawl/$JOB")
check "second cancel reports the job is done" "$R" 'job_not_active'

echo; echo "11. POST /v1/batch/scrape"
START=$(post /v1/batch/scrape '{"urls":["https://example.com","https://example.org","https://en.wikipedia.org/wiki/Markdown"],"scrapeOptions":{"formats":["markdown"],"skipCache":true}}')
JOB=$(printf '%s' "$START" | jqp "d['id']")
for _ in $(seq 1 60); do
  STATUS=$(curl -sS "$BASE/v1/batch/scrape/$JOB")
  STATE=$(printf '%s' "$STATUS" | jqp "d['status']")
  [ "$STATE" = completed ] || [ "$STATE" = failed ] && break
  sleep 1
done
check "batch completed" "$STATE" "completed"
printf '  %s\n' "$(printf '%s' "$STATUS" | jqp "f\"completed={d['completed']}/{d['total']} errors={d['errorCount']}\"")"

echo; echo "12. POST /v1/search"
R=$(post /v1/search '{"query":"open source web scraping library","limit":5}')
if printf '%s' "$R" | grep -q '"success":true'; then
  echo "  PASS  search returned results"; PASS=$((PASS + 1))
  python3 - "$R" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
print(f"  engine={d['engine']}  results={len(d['data'])}")
for hit in d['data'][:5]:
    print(f"    {hit['title'][:70]}\n      {hit['url']}")
PY
else
  echo "  INFO  every engine refused this environment (expected without SEARXNG_URL on a datacenter IP)"
  printf '  %s\n' "$(printf '%s' "$R" | jqp "d.get('error','(no error field)')[:400]")"
fi

echo; echo "13. Error handling"
check "missing url is a 400"       "$(post /v1/scrape '{}')"                                  'invalid_request'
check "private URL is refused"      "$(post /v1/scrape '{"url":"http://169.254.169.254/latest/meta-data/"}')" 'unsafe_url'
check "localhost is refused"        "$(post /v1/scrape '{"url":"http://localhost:3000/health"}')"             'unsafe_url'
check "non-http scheme is refused"  "$(post /v1/scrape '{"url":"file:///etc/passwd"}')"        'unsafe_url'
check "unknown job is a 404"        "$(curl -sS "$BASE/v1/crawl/00000000-0000-4000-8000-000000000000")" 'not_found'
check "unknown route is a 404"      "$(post /v1/nope '{}')"                                    'not_found'
check "extract without a key is 501" "$(post /v1/extract '{"url":"https://example.com","prompt":"x"}')" 'not_configured'

echo; echo "14. Markdown is markdown — table-heavy pages must not leak raw HTML"
for URL in \
  "https://en.wikipedia.org/wiki/Comparison_of_web_browsers" \
  "https://news.ycombinator.com" \
  "https://en.wikipedia.org/wiki/List_of_HTTP_status_codes"; do
  post /v1/scrape "{\"url\":\"$URL\",\"formats\":[\"markdown\"],\"skipCache\":true}" > /tmp/freecrawl-md.json
  python3 - "$URL" /tmp/freecrawl-md.json <<'PY'
import json, re, sys
md = json.load(open(sys.argv[2]))['data'].get('markdown', '')
# Block-level tags have a markdown equivalent, so any that survive are a bug.
leaked = re.findall(r'</?(table|tbody|thead|tr|td|th|div|span|ul|ol|li|p)[\s/>]', md)
# A table row split across lines leaves a bare pipe behind.
torn = len(re.findall(r'^\s*\|\s*$', md, re.M))
print(f"  {sys.argv[1][:58]:58s} {len(md):7d} chars  raw_tags={len(leaked)}  torn_rows={torn}")
sys.exit(0 if not leaked and torn == 0 else 1)
PY
  # shellcheck disable=SC2181
  if [ $? -eq 0 ]; then
    echo "  PASS  clean markdown"; PASS=$((PASS + 1))
  else
    echo "  FAIL  raw HTML or torn table rows in markdown"; FAIL=$((FAIL + 1))
  fi
done

hr; printf 'passed %d, failed %d\nfinished %s\n' "$PASS" "$FAIL" "$(date -u +%FT%TZ)"; hr
exit $((FAIL > 0))

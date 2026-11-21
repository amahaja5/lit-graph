#!/usr/bin/env bash
# Starts GROBID + wrapper with docker compose and checks:
#   /health returns ok, /extract returns 401 without a key and XML with a valid key.
# Usage: deploy/cloud-run/local-test.sh [path/to/paper.pdf]   (KEEP_RUNNING=1 to leave it up)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export EXTRACTION_API_KEY="${EXTRACTION_API_KEY:-local-test-$(openssl rand -hex 16)}"
PORT="${WRAPPER_PORT:-8000}"; export WRAPPER_PORT="$PORT"
BASE="http://127.0.0.1:$PORT"
COMPOSE=(docker compose -f "$HERE/docker-compose.yml" -p litgraph-grobid-test)
PDF="${1:-}"

cleanup() { [[ "${KEEP_RUNNING:-0}" == 1 ]] || "${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true; [[ -n "${TMP_PDF:-}" ]] && rm -f "$TMP_PDF"; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

"${COMPOSE[@]}" up -d --build

echo -n "Waiting for /health"
for _ in $(seq 1 90); do
  if body="$(curl -fsS "$BASE/health" 2>/dev/null)"; then echo; break; fi
  echo -n .; sleep 2
done
[[ "${body:-}" == *'"status":"ok"'* ]] || fail "/health never became ready"
echo "PASS: /health -> $body"

if [[ -z "$PDF" ]]; then
  TMP_PDF="$(mktemp -t grobid-test).pdf"; PDF="$TMP_PDF"
  python3 - "$PDF" <<'PY'
import sys
lines = ["Test Paper", "References", "[1] A. Vaswani et al. Attention is all you need. In NeurIPS, 2017.",
         "[2] D. Bahdanau, K. Cho, Y. Bengio. Neural machine translation by jointly learning to align and translate. ICLR, 2015."]
text = "BT /F1 11 Tf 50 750 Td 14 TL " + " ".join("(%s) '" % l.replace("(", r"\(").replace(")", r"\)") for l in lines) + " ET"
objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        "<< /Length %d >>\nstream\n%s\nendstream" % (len(text), text), "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
out, offsets = b"%PDF-1.4\n", []
for i, o in enumerate(objs, 1):
    offsets.append(len(out)); out += b"%d 0 obj\n%s\nendobj\n" % (i, o.encode())
xref = len(out)
out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % x for x in offsets)
out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
open(sys.argv[1], "wb").write(out)
PY
fi

code="$(curl -sS -o /dev/null -w '%{http_code}' -F "file=@$PDF;type=application/pdf" "$BASE/extract?mode=references")"
[[ "$code" == 401 ]] || fail "/extract without key returned $code, expected 401"
echo "PASS: /extract without key -> 401"
code="$(curl -sS -o /dev/null -w '%{http_code}' -H 'X-API-Key: wrong' -F "file=@$PDF;type=application/pdf" "$BASE/extract?mode=references")"
[[ "$code" == 401 ]] || fail "/extract with wrong key returned $code, expected 401"
echo "PASS: /extract with wrong key -> 401"

OUT="$(mktemp)"
code="$(curl -sS -o "$OUT" -w '%{http_code}' -H "X-API-Key: $EXTRACTION_API_KEY" -F "file=@$PDF;type=application/pdf" "$BASE/extract?mode=references")"
[[ "$code" == 200 ]] || { cat "$OUT" >&2; rm -f "$OUT"; fail "/extract with key returned $code, expected 200"; }
grep -q '<TEI' "$OUT" || { head -c 500 "$OUT" >&2; rm -f "$OUT"; fail "/extract did not return TEI XML"; }
echo "PASS: /extract with key -> 200 TEI XML ($(grep -o '<biblStruct' "$OUT" | wc -l | tr -d ' ') biblStruct entries)"
rm -f "$OUT"

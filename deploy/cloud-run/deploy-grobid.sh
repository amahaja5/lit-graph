#!/usr/bin/env bash
# Builds the wrapper image and deploys service.yaml (GROBID sidecar + wrapper) to Cloud Run.
# One-time GCP setup is in deploy/cloud-run/README.md.
#
# Usage:
#   GCP_PROJECT=my-project deploy/cloud-run/deploy-grobid.sh
set -euo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT to your Google Cloud project ID.}"
REGION="${GCP_REGION:-us-central1}"
REPO="${AR_REPO:-litgraph}"
SERVICE="${GROBID_SERVICE:-grobid}"
KEY_SECRET="${KEY_SECRET:-extraction-api-key}"
TAG="${WRAPPER_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}"
WRAPPER_IMAGE="$REGION-docker.pkg.dev/$GCP_PROJECT/$REPO/grobid-wrapper:$TAG"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building $WRAPPER_IMAGE"
gcloud builds submit "$HERE/wrapper" --project "$GCP_PROJECT" --region "$REGION" --tag "$WRAPPER_IMAGE"

RENDERED="$(mktemp)"
trap 'rm -f "$RENDERED"' EXIT
sed -e "s|\${SERVICE}|$SERVICE|g" \
    -e "s|\${WRAPPER_IMAGE}|$WRAPPER_IMAGE|g" \
    -e "s|\${KEY_SECRET}|$KEY_SECRET|g" \
    "$HERE/service.yaml" > "$RENDERED"

gcloud run services replace "$RENDERED" --project "$GCP_PROJECT" --region "$REGION"

# The wrapper enforces X-API-Key itself, so the service is public at the Cloud Run layer.
gcloud run services add-iam-policy-binding "$SERVICE" --project "$GCP_PROJECT" --region "$REGION" \
  --member allUsers --role roles/run.invoker >/dev/null

URL="$(gcloud run services describe "$SERVICE" --project "$GCP_PROJECT" --region "$REGION" --format 'value(status.url)')"
echo
echo "Set on Vercel (and in .env for local dev):"
echo "  GROBID_API_URL=$URL"
echo "  EXTRACTION_API_KEY=<value of secret $KEY_SECRET>"
echo "  GROBID_WARM_PATH=/health   (already the default)"

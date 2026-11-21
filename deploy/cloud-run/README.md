# GROBID on Cloud Run

Scale-to-zero PDF bibliography extraction for LitGraph. One Cloud Run service runs two containers:

| Container | Image | Port | Resources | Exposure |
| --- | --- | --- | --- | --- |
| `api` (wrapper, ingress) | built from `wrapper/` | 8000 | 1 vCPU, 1 GiB | public, requires `X-API-Key` on `/extract` |
| `grobid` (sidecar) | `grobid/grobid:0.9.1-crf` | 8070 | 2 vCPU, 8 GiB | none (`localhost` only) |

The service is set to request-based billing, min 0 and max 2 instances, so idle time costs nothing. LitGraph warms the service when a signed-in user loads the app, signs in to Zotero, or opens the Import panel. It does this by calling the wrapper's `/health` route, which returns 503 until GROBID is ready.

The wrapper runs at 1 vCPU rather than 0.5 because Cloud Run requires the first-generation environment and concurrency 1 for CPU below 1. With concurrency 1, a warm-up ping and an extraction arriving together would start a second instance.

## Files

- `wrapper/`: FastAPI wrapper (`app.py`, `requirements.txt`, `Dockerfile`). It reads `EXTRACTION_API_KEY` from the environment and refuses to start without it.
- `service.yaml`: the Cloud Run service definition (a template; `deploy-grobid.sh` fills in the image and secret names).
- `deploy-grobid.sh`: builds the wrapper with Cloud Build, then runs `gcloud run services replace` and grants public invoker access.
- `docker-compose.yml` and `local-test.sh`: run both containers locally and check `/health`, the 401 responses, and XML extraction.

## One-time GCP setup

```bash
PROJECT=your-project-id
REGION=us-central1

# 1. Project and billing
gcloud projects create "$PROJECT"            # or use an existing project
gcloud billing accounts list
gcloud billing projects link "$PROJECT" --billing-account=XXXXXX-XXXXXX-XXXXXX
gcloud config set project "$PROJECT"

# 2. APIs
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com

# 3. Artifact Registry repository for the wrapper image
gcloud artifacts repositories create litgraph --repository-format=docker --location="$REGION"

# 4. Extraction key secret (the same value goes into Vercel as EXTRACTION_API_KEY)
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create extraction-api-key --data-file=-

# 5. IAM: the Cloud Run runtime service account must be able to read the secret
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding extraction-api-key \
  --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
```

Cloud Build may also need permission to push to Artifact Registry. In new projects it builds as the Compute Engine default service account. If the build fails with a permission error, grant that account `roles/artifactregistry.writer` and `roles/logging.logWriter`.

`deploy-grobid.sh` grants `allUsers` the `roles/run.invoker` role, because the wrapper does its own key check. Some organizations block `allUsers` bindings with the "Domain restricted sharing" policy. In that case, use a standalone project or ask an org admin for an exception.

Set a billing budget alert (Billing → Budgets & alerts) as a backstop.

## Deploy

```bash
GCP_PROJECT="$PROJECT" deploy/cloud-run/deploy-grobid.sh
```

Optional: `GCP_REGION` (default `us-central1`), `AR_REPO` (`litgraph`), `GROBID_SERVICE` (`grobid`), `KEY_SECRET` (`extraction-api-key`), `WRAPPER_TAG` (current git commit).

Then set the following on Vercel, and in `.env` for local development:

```
GROBID_API_URL=<printed service URL>
EXTRACTION_API_KEY=<value of the extraction-api-key secret>
GROBID_WARM_PATH=/health   # default; optional
```

Read the key back with `gcloud secrets versions access latest --secret=extraction-api-key`.

## Local test

```bash
deploy/cloud-run/local-test.sh                 # generates a small test PDF
deploy/cloud-run/local-test.sh paper.pdf       # or use your own
KEEP_RUNNING=1 deploy/cloud-run/local-test.sh  # leave it up on 127.0.0.1:8000
```

## Previous setup

`deploy/akash/grobid.sdl.yaml` is the old Akash deployment, kept for reference only.

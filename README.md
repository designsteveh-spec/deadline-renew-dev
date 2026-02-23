# Deadline & Renewal Extractor (Deterministic MVP)

Production-lean MVP for extracting observable deadlines and renewal-related dates from:
- Pasted text
- Uploaded files (max 3): PDF (text-based), DOCX, TXT

No LLM calls. No OCR. No paid per-use APIs.

Plan-ready entitlement enforcement is included for:
- Free
- Pro Monthly
- Pro Annual

## Project Structure

```text
deadline-renew-dev/
  client/
  server/
  README.md
```

## How It Works

1. Server accepts `multipart/form-data` at `POST /api/extract`:
- `files` (0-3)
- `text` (optional)

2. Text extraction is local only:
- TXT: UTF-8 decode
- DOCX: `mammoth` raw text extraction
- PDF: `pdf-parse` text extraction

3. If PDF extracted text length is `< 50 chars`, it returns:
- `This PDF appears to be image-only (scanned). Please paste text or upload a text-based document.`

4. Deterministic pipeline:
- Normalize text and keep line mapping
- Detect absolute dates (`Jan 5, 2026`, `2026-01-05`, `01/05/2026`, etc.)
- Detect relative dates (`30 days prior`, `within 30 days`, etc.)
- Classify by keyword proximity
- Resolve relative anchors when possible
- Assign confidence (`high|medium|low`)
- Deduplicate by date+type+snippet overlap key

5. UI renders a Reminder Sheet table with:
- Item
- Date
- Type
- Source Snippet
- Confidence
- Source
- Notes

6. Export options:
- Download CSV
- Copy as plaintext

7. Plan entitlements are enforced server-side:
- Free: 3 extractions/day, 1 file/run, 5MB/file
- Pro Monthly: 300 extractions/month, 3 files/run, 10MB/file
- Pro Annual: 1500 extractions/month, 3 files/run, 20MB/file

## API Contract

`POST /api/extract`

Optional request headers (for current pre-auth MVP wiring):
- `x-plan`: `free` | `pro_monthly` | `pro_annual` (defaults to `free`)
- `x-account-id`: stable customer key for usage counting (falls back to IP if omitted)

`GET /api/plans`
- Returns active plan limits for frontend/paywall wiring.

Response:

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "renewal",
      "date": "2026-01-05",
      "confidence": "high",
      "item": "Renewal",
      "snippet": "....",
      "notes": "....",
      "source": "contract.pdf"
    }
  ],
  "fileReports": [
    {
      "source": "contract.pdf",
      "ok": true,
      "chars": 1932
    }
  ]
}
```

## Local Run

### 1) Server

```bash
cd server
npm install
copy .env.example .env
npm run dev
```

Server default: `http://localhost:4000`

### 2) Client

```bash
cd client
npm install
copy .env.example .env
npm run dev
```

Client default: `http://localhost:5173`

## Environment Variables

Server (`server/.env`):
- `PORT`
- `NODE_ENV`
- `STRIPE_SECRET_KEY` (reserved for future integration)
- `STRIPE_WEBHOOK_SECRET` (reserved for future integration)

Client (`client/.env`):
- `VITE_API_BASE` (default `http://localhost:4000`)

## Limitations

- No OCR. Image-only/scanned PDFs are not processed.
- Deterministic extraction only (regex + heuristics), so ambiguous contract language can be missed or misclassified.
- US numeric date assumption for slash format (`MM/DD/YYYY`).
- Usage counters are in-memory for MVP; move to persistent storage when Stripe/auth goes live.

## VPS Deployment (Namecheap, Basic)

1. Build client:
```bash
cd client
npm install
npm run build
```

2. Install server deps:
```bash
cd ../server
npm install --omit=dev
```

3. Configure `server/.env` for production (`NODE_ENV=production`, `PORT=<port>`).

4. Serve client static build behind Nginx (or copy `client/dist` to your static path).

5. Run Node service (PM2/systemd):
```bash
cd server
npm start
```

6. Nginx reverse proxy:
- `https://<subdomain>.trusted-tools.com/` -> client static
- `/api/*` -> Node service on localhost:`PORT`

This structure is ready for adding Stripe middleware/routes later without refactoring core extraction flow.

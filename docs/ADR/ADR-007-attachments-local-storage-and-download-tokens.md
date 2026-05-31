# ADR-007: Local Attachment Storage with One-Time Download Tokens

Status: Accepted  
Date: 2025-12-12  
Owner: Development Team  
Related Features: [Attachments](../Features/attachments.md)  
Supersedes: N/A  
Superseded by: N/A

---

## Context

Tasks can include file attachments coming from two sources:

- Telegram bot uploads (documents/photos) which are primarily referenced via Telegram file IDs.
- WebApp uploads (multipart form) which must be stored by the service.

The system needs to:

- Store attachment metadata consistently in PostgreSQL.
- Restrict downloads to authorized task participants.
- Avoid exposing raw file paths or permanent public URLs.
- Support large files up to Telegram’s limit (2GB).

---

## Decision

Store WebApp-uploaded files on local disk under `storage/uploads`, store Telegram-uploaded files as Telegram references, and gate all downloads through short-lived one-time tokens.

Key points:

- Web uploads are written to `storage/uploads` and persisted via `Attachment.storagePath`.
- Telegram uploads persist `telegramFileId` and a sentinel URL scheme `telegram-file://{file_id}`.
- Download flow is:
  - `POST /api/attachments/{id}/token` creates a `DownloadToken` with 5-minute TTL.
  - `GET /api/attachments/download/{token}` consumes (deletes) the token and serves the file.
- Telegram-origin files are proxied via Telegram Bot API using `BOT_TOKEN` (resolve `getFile`, then stream file).

---

## Alternatives considered

### Permanent signed URLs

- Pros: Simple client downloads, fewer server hops
- Cons: Harder revocation; more complex token/key management
- Rejected because: One-time tokens are simpler and provide explicit consumption semantics.

### Cloud storage (S3/GCS)

- Pros: Durability, scalability, CDN-friendly
- Cons: Additional infrastructure, credentials, bucket policies
- Rejected because: Current scope favors minimal infrastructure and local deployment.

### Store file bytes in the database

- Pros: Single persistence layer
- Cons: DB bloat, poor performance for large binaries, backup complexity
- Rejected because: Attachments may be large (up to 2GB).

---

## Consequences

### Positive

- Clear access control boundary: downloads only via token routes.
- One-time tokens reduce link leakage risk.
- Unified metadata model for both Telegram and Web uploads.

### Negative / risks

- Local storage is not horizontally scalable without shared volumes.
- File persistence depends on host volume/backups.
- Proxying Telegram files depends on Telegram API availability and `BOT_TOKEN`.

---

## Impact

### Code

- Affected modules / services:
  - `app/api/tasks/[taskId]/attachments/route.ts` (web upload)
  - `app/api/attachments/[attachmentId]/token/route.ts` (token generation)
  - `app/api/attachments/download/[token]/route.ts` (download)
  - `lib/attachments.ts`, `lib/download-tokens.ts`, `lib/storage.ts`
- New boundaries / responsibilities: Download authorization is enforced at token-creation time.
- Feature flags / toggles: N/A

### Data / configuration

- Data model / schema changes: `Attachment`, `DownloadToken` models in `prisma/schema.prisma`
- Config changes: `BOT_TOKEN` required for Telegram proxy downloads
- Backwards compatibility: N/A

### Documentation

- Feature docs to update: [Attachments](../Features/attachments.md)
- Testing docs to update: [Testing Strategy](../Testing/strategy.md)
- Architecture docs to update: N/A
- Notes for `AGENTS.md`: Never expose secrets; don’t expose internal ports in production compose.

---

## Verification (Mandatory: describe how to test this decision)

### Objectives

- Authorized user can upload via WebApp and download via token.
- Token expires and cannot be reused.
- Unauthorized user cannot mint download token.

### Test environment

- Environment: Local dev or Docker Compose with mounted storage
- Data and reset strategy: Create a task and upload a small file
- External dependencies: Telegram API (for Telegram-origin file proxying)

### Test commands

- build: `pnpm build`
- test: `pnpm lint`
- format: N/A

### New or changed tests

| ID          | Scenario                      | Level (Unit / Int / API / UI) | Expected result                | Notes / Data     |
| ----------- | ----------------------------- | ----------------------------- | ------------------------------ | ---------------- |
| TST-007-001 | Web upload creates Attachment | API                           | 200 + DB record + file on disk | multipart upload |
| TST-007-002 | Token download consumes token | API                           | 200, then 404 on reuse         | token reuse      |
| TST-007-003 | Expired token returns 410     | API                           | 410 Gone                       | wait > 5 min     |

---

## Rollout and migration

- Migration steps: Ensure writable `storage/` volume exists in deployments
- Backwards compatibility: N/A
- Rollback: Disable attachment routes or revert to previous storage strategy

---

## References

- Code: `lib/storage.ts`, `lib/download-tokens.ts`, `app/api/attachments/download/[token]/route.ts`
- Schema: `prisma/schema.prisma` (Attachment, DownloadToken)
- Related ADRs: [ADR-001: PostgreSQL Database](ADR-001-postgresql-database.md), [ADR-005: Telegram Bot](ADR-005-telegram-bot-integration.md)

---

## Filing checklist

- [x] File saved under `docs/ADR/ADR-007-attachments-local-storage-and-download-tokens.md`
- [x] Status reflects real state (`Accepted`)
- [x] Links to related features, tests, and ADRs are filled in

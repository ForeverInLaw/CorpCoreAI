# ADR-006: NVIDIA AI Integration for Task Parsing

Status: Accepted  
Date: 2025-12-12  
Owner: Development Team  
Related Features: [AI Task Parsing](../Features/ai-task-parsing.md)  
Supersedes: N/A  
Superseded by: N/A

---

## Context

The system needs to turn free-form Russian task descriptions received in Telegram into structured data that can be stored and processed:

- Short title (suitable for UI cards)
- Subtasks list
- Optional deadline with relative-date interpretation (e.g. “в пятницу”, “через 3 дня”)

A purely rule-based parser would be brittle for natural language, and the bot should support varied phrasing without requiring users to follow strict syntax.

---

## Decision

Use NVIDIA’s hosted LLM endpoint to parse task text, calling the model `minimaxai/minimax-m2` via the OpenAI SDK configured with NVIDIA’s `baseURL`.

Key points:

- Use `openai` SDK with `baseURL = https://integrate.api.nvidia.com/v1` and `apiKey = NVIDIA_API_KEY`.
- Constrain output to JSON using `response_format: { type: "json_object" }`.
- Validate the parsed payload strictly (types, arrays), and retry up to 2 attempts on failure.
- Strip model “reasoning” wrappers (`<think>...</think>`) and Markdown code fences before JSON parsing.

---

## Alternatives considered

### Deterministic regex/rule parser

- Pros: No external dependency, deterministic, cheap
- Cons: Poor coverage for natural language and relative dates; high maintenance
- Rejected because: The product goal is conversational task entry in Russian with flexible phrasing.

### OpenAI-hosted models (direct)

- Pros: Mature platform, broad model options
- Cons: Different vendor/cost profile; may require additional compliance review
- Rejected because: The implementation is already built around NVIDIA’s endpoint and key management.

### Self-hosted LLM

- Pros: Full control of data path, potentially lower variable cost at scale
- Cons: Operational complexity, GPU requirements, model lifecycle management
- Rejected because: Overkill for current scope and deployment model.

---

## Consequences

### Positive

- Handles varied Russian phrasing without strict syntax.
- Supports relative-date interpretation using a reference date.
- JSON-only response format simplifies downstream validation.

### Negative / risks

- External dependency (availability/latency/cost).
- Non-determinism: same input may yield different outputs.
- Secret management: `NVIDIA_API_KEY` must be present in all environments that parse tasks.

---

## Impact

### Code

- Affected modules / services: `lib/ai.ts`, `lib/bot/index.ts`
- New boundaries / responsibilities: `parseTask()` is the single entry point for AI parsing.
- Feature flags / toggles: N/A

### Data / configuration

- Data model / schema changes: N/A
- Config changes: `NVIDIA_API_KEY` required
- Backwards compatibility: N/A

### Documentation

- Feature docs to update: [AI Task Parsing](../Features/ai-task-parsing.md)
- Testing docs to update: [Testing Strategy](../Testing/strategy.md)
- Architecture docs to update: N/A
- Notes for `AGENTS.md`: Do not mock internal systems; treat NVIDIA as an external dependency.

---

## Verification (Mandatory: describe how to test this decision)

### Objectives

- Parser returns `{title, subtasks, deadline}` for typical Russian task text.
- Parser rejects malformed responses and retries once.

### Test environment

- Environment: Local development
- Data and reset strategy: N/A
- External dependencies: NVIDIA API with `NVIDIA_API_KEY`

### Test commands

- build: `pnpm build`
- test: `pnpm lint`
- format: N/A

### New or changed tests

| ID          | Scenario                | Level (Unit / Int / API / UI) | Expected result             | Notes / Data              |
| ----------- | ----------------------- | ----------------------------- | --------------------------- | ------------------------- |
| TST-006-001 | Parse Russian task text | Integration                   | Valid JSON payload returned | Requires `NVIDIA_API_KEY` |

---

## Rollout and migration

- Migration steps: Configure `NVIDIA_API_KEY` in runtime env
- Backwards compatibility: N/A
- Rollback: Disable bot flow that calls parsing, or revert to previous parsing logic

---

## References

- Code: `lib/ai.ts`
- Vendor endpoint: `https://integrate.api.nvidia.com/v1`
- Related ADRs: [ADR-005: Telegram Bot Integration](ADR-005-telegram-bot-integration.md)

---

## Filing checklist

- [x] File saved under `docs/ADR/ADR-006-nvidia-ai-task-parsing.md`
- [x] Status reflects real state (`Accepted`)
- [x] Links to related features, tests, and ADRs are filled in

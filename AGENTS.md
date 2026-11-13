# billing-substrate — Codex Project Guide

## OpenAI documentation (Codex and Agy)

When a task needs facts about OpenAI products or APIs, including Codex
configuration, use current official OpenAI documentation. This applies to
both Codex and Agy (Antigravity/Gemini).

- If `openai-docs` is available in the current client, use it and follow its
  source routing. Do not assume another client's skills or global config apply.
- Otherwise, use the OpenAI documentation MCP tools when available: search for
  the topic, then fetch the relevant page. If unavailable or unhelpful, search
  and open official pages on `developers.openai.com`, `platform.openai.com`,
  or `learn.chatgpt.com`.
- Cite supporting pages; state uncertainty when the sources do not establish
  the answer. Preserve explicitly requested model targets and existing
  provider choices unless the task authorizes a change.
- Keep documentation queries generic; never send secrets, personal data, or
  private repository content to documentation tools or web search.

OSS multi-jurisdiction healthcare claims-adapter substrate. Apache 2.0 + DCO. See [README.md](README.md) for what ships here, [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow, and [docs/architecture/contract-design.md](docs/architecture/contract-design.md) for the formal contract spec.

## Public-Repo Policy

This repo is public. Keep repository content suitable for public readers:

- Do not reference non-public repositories, systems, incidents, or trackers by name.
- Do not document deployment-specific wiring, app slugs, secret names, or escalation paths beyond the public templates.
- Keep compliance and security rationale generic; do not include organization-specific evidence or customer-specific details.
- Put project-specific consumer details in that consumer's own repository, not here.

If work needs non-public context, discuss that context outside this public repository and keep any public issue or PR focused on the reusable change.

## Working Rules

- Start each session by reading this file and checking `git status --short --branch`.
- Use `rg` / `rg --files` for search and file discovery.
- Use `apply_patch` for manual file edits where practical.
- Do not revert user changes or unrelated dirty worktree state.
- Keep changes scoped to the user's request and the existing repo architecture.
- Run the smallest meaningful validation command after edits; report anything that could not be run.

## Adapter Contract

Every jurisdictional adapter must satisfy:

- No consumer domain types in adapters. Adapters operate on `ClaimBatch` shapes only.
- No business logic in adapters. Adapters validate wire-format correctness only.
- `validate` aggregates every finding and never short-circuits on first error.
- `render` is deterministic for identical input.
- `submit` is idempotent for the same rendered claim.
- `SubmitterCredentials.material` is never written to disk, logs, or non-volatile storage.
- Adapter instances are stateless across invocations; persisted state belongs in `SubmitReceipt`.

Full spec: [docs/architecture/contract-design.md](docs/architecture/contract-design.md).

## Cross-References

- [README.md](README.md) — project overview and hard rules.
- [CONTRIBUTING.md](CONTRIBUTING.md) — DCO, scope, workflow.
- [SECURITY.md](SECURITY.md) — responsible disclosure.
- [docs/architecture/contract-design.md](docs/architecture/contract-design.md) — formal contract spec.
- [docs/architecture/authoring-an-adapter.md](docs/architecture/authoring-an-adapter.md) — adapter authoring walkthrough.
- [docs/architecture/ohip-record-format.md](docs/architecture/ohip-record-format.md) — Ontario MCEDT byte-layout reference.

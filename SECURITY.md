# Security

This substrate handles healthcare claim data and (in deployments) cryptographic signing material for jurisdictional submission. Security issues affect downstream regulated systems.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **security@loomantix.com** with:

1. Description of the vulnerability
2. Steps to reproduce (or proof-of-concept)
3. Affected packages/versions
4. Your name and contact (for follow-up)

You will receive an acknowledgement within 3 business days. We aim to triage within 7 business days and ship a fix or mitigation within 30 days for confirmed vulnerabilities.

## Scope

In scope:

- Vulnerabilities in any `@loomantix/*` package published from this repo
- CI/build supply-chain vulnerabilities affecting this repo
- Cryptographic weaknesses in adapter implementations that could allow forged or replayed claims

Out of scope:

- Security of *deployments* of this substrate (each deployment owns its own threat model)
- Vulnerabilities in upstream dependencies (please report to the upstream)
- Vulnerabilities in jurisdiction-specific external systems (e.g. Ontario MOH MCEDT itself)

## Disclosure policy

We follow coordinated disclosure:

- We will work with you to understand the issue and ship a fix
- Once a fix is released, we publish a security advisory crediting you (unless you prefer to remain anonymous)
- 90 days after the fix is published, the full technical details may be disclosed

If a vulnerability is being actively exploited, we may shorten this timeline.

## Cryptographic posture

For deployments using `@loomantix/billing-adapter-*` packages with jurisdictional certificates:

- Private keys are the deployment's responsibility — the substrate packages MUST NOT log, persist, or otherwise retain them
- Submission audit trails are recommended at the deployment layer, not in the substrate
- Cert rotation is the deployment's responsibility

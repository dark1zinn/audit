# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately, never in a public issue or discussion:

- Use GitHub's "Report a vulnerability" button on the repository's Security tab, or
- email **dark1zinn00@gmail.com** with the subject `audit security`.

Include the affected version, a description of the issue, steps to reproduce and the impact you
expect. You will get an acknowledgement within 5 working days.

## Disclosure policy

We follow a 90-day coordinated disclosure policy: we aim to release a fix within 90 days of the
report and publish an advisory once the fix is available. If a fix needs longer, we agree a new date
with the reporter. Reporters are credited in the advisory unless they ask otherwise.

## Supported versions

Security fixes go to the latest minor release. Upgrades within a major version are automatic and
backward-compatible, so staying current is the supported path.

## Scope

In scope: the audit server, web app, container image and release artefacts. Out of scope: issues
that need a compromised host, a malicious administrator acting within their documented powers, or
third-party AI providers configured by an administrator.

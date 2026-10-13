# Splitbon licensing guide

> This document explains the repository licensing policy in plain language. It
> is not legal advice. The binding terms are in [`LICENSE`](LICENSE),
> [`NOTICE.md`](NOTICE.md), and the applicable license files.

## What is free to do?

The BSL 1.1 Additional Use Grant lets you use **Splitbon Original Work** in
production without charge when you use it:

- personally or with your household; or
- internally within one organization for that organization's own operations.

Self-hosting for those purposes is allowed.

## What needs a commercial license?

A commercial license from `cyborcc` is required to use Splitbon Original Work
outside that grant, including to:

- host or operate Splitbon for third parties;
- offer it as SaaS, a managed service, or an agency service;
- resell, sublicense, distribute as a paid offering, or white-label it; or
- embed it in a commercial service for third parties.

## What does not change?

Splitbon grew out of ShareTab and contains historic MIT-licensed material. MIT
rights already granted for that code, including earlier public Splitbon
versions, stay in force. The BSL cannot revoke them. See
[`NOTICE.md`](NOTICE.md) and [`LICENSES/ShareTab-MIT.txt`](LICENSES/ShareTab-MIT.txt).

The BSL scope starts with new, original Splitbon work published after this
licensing transition. A party may still use the MIT portions under MIT, but may
not rely on MIT to use a later BSL-covered original addition.

## When does BSL code become open source?

For this licensing transition, the Change Date is **October 12, 2030**. On
that date, or on the fourth anniversary of the first public BSL release of a
specific version if earlier, the BSL-covered work for that version is available
under Apache License 2.0.

Before publishing a later BSL release, maintainers should update the Change
Date in that release's `LICENSE` to no more than four years after its first
public availability. Git tags preserve the terms for historical releases.

## How to contribute

New pull requests must comply with the contributor license terms in
[`CONTRIBUTING.md`](CONTRIBUTING.md). Do not submit code you cannot license for
use under BSL 1.1 and the later Apache-2.0 Change License.

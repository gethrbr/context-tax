## What this changes

<!-- One or two sentences. What behaviour is different after this merges? -->

## Why

<!-- The problem. If it fixes an issue, link it: Fixes #123 -->

## How it was verified

<!--
Not "tests pass". What did you see?

If this fixes a bug, the standard here is a mutation check: put the bug back and
watch the new test fail. A test that has never been seen to fail is not evidence.
-->

## Checklist

- [ ] `npm run typecheck && npm run lint && npm test` pass locally
- [ ] New behaviour has a test, and I have seen that test fail without the change
- [ ] No new runtime dependency (CI enforces `dependencies === {}`)
- [ ] No real machine data in tests, fixtures, docs or output examples

# Contributing

1. Keep application-domain code out of `packages/*`.
2. Add or change a stable platform contract deliberately and document the decision.
3. Run `npm run verify` and `npm run release:verify-manifest` before committing.
4. Do not add a third-party dependency without a concrete platform requirement.
5. Do not commit secrets or real user data.
6. Prefer a thin vertical platform slice over speculative abstractions.

# Repository Conventions

## Package naming

Shared packages use the `@green-hive/*` scope.

## Source language

TypeScript is the default application/platform source language.

## Package exports

Each package exposes its public API from `src/index.ts`. Applications must prefer package public APIs over internal file imports.

## Ownership

A shared package owns one coherent platform capability. It must not become a general `utils` dumping ground.

## Errors

Stable platform errors originate in `@green-hive/core`. Provider-specific details must not leak directly to consumer UI.

## Tests

Tests must cover contracts and invariants, not only happy-path implementation details.

## Secrets

No provider secret may be committed. `.env.example` contains names only.

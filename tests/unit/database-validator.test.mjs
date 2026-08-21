import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { validateDatabaseLayout } from "../../scripts/db-validate.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("database catalog, hashes, RLS coverage and boundaries are valid", async () => {
  assert.deepEqual(await validateDatabaseLayout(repositoryRoot), []);
});


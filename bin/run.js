#!/usr/bin/env node
import { execute, handle } from "@oclif/core";

function formatError(err) {
  const body = err?.body;
  if (body !== undefined) {
    const serialized = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    err.message = `${err.message}\n${serialized}`;
  }
  return err;
}

try {
  await execute({ dir: import.meta.url });
} catch (err) {
  await handle(formatError(err));
}

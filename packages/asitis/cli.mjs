#!/usr/bin/env node
// `npx asitis lint` instead of `npx -p @asitis/mcp asitis lint`. The CLI lives in @asitis/mcp,
// pinned to the same version; its bundle runs on import and reads process.argv itself.
import "@asitis/mcp/dist/asitis.mjs";

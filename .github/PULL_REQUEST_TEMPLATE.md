## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] `npm test` passes locally
- [ ] If `packages/mcp/src` or dependencies changed: ran `npm run sync-plugin` and committed `plugins/asitis/server/`
- [ ] New or changed checks stay linear on the 10 MB inputs in `packages/mcp/test/dos.test.ts`
- [ ] New lint rules link to the vendor docs they are based on
- [ ] Fixtures were added with a script or `printf`, not an editor
- [ ] No em-dashes or emoji in anything authored

## Catches
`permissions.defaultMode` set to `bypassPermissions` in `.claude/settings.json`, or in `.claude/settings.local.json` with `--include config-local`. With `config-local` it also reports `skipDangerousModePermissionPrompt: true` in the local file. Needs `--include config`.

## Bad
```json
{ "permissions": { "defaultMode": "bypassPermissions" } }
```
Claude Code 2.1.257 and later ignore this in project and local settings, but older versions honour it, so anyone on an older version runs every tool without a prompt. It also tells a reviewer that somebody wanted prompts off for the whole project.

## Good
```json
{ "permissions": { "defaultMode": "acceptEdits" } }
```

## Fix
Remove the line or choose a mode that keeps command prompts. For an unattended run, pass `--permission-mode` for that one session inside a disposable environment, not in the shared settings file.

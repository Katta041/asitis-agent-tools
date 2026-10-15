## Catches
`permissions.defaultMode` set to `bypassPermissions` in a project settings file. Needs `--include config`.

## Bad
```json
{ "permissions": { "defaultMode": "bypassPermissions" } }
```
Claude Code ignores this in project settings (the mode cannot be set from a file others commit), so it does nothing today. It still tells a reviewer that somebody wanted prompts off for the whole project, and a future version or another tool reading the file may honour it.

## Good
```json
{ "permissions": { "defaultMode": "acceptEdits" } }
```

## Fix
Remove the line or choose a mode that keeps command prompts. For unattended runs use a disposable environment and the CLI flag there, not the shared settings file.

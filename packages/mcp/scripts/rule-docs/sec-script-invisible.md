## Catches
Characters in a skill script that do not show up in an editor or a diff: bidirectional controls (U+202A to U+202E, U+2066 to U+2069), zero-width characters, Unicode tag characters and runs of variation selectors. Needs `--include skills`.

## Bad
```javascript
// scripts/check.js, shown as GitHub renders it
const isAdmin = false;
/* end admin check */ if (isAdmin) { console.log("hello"); }
```
The file holds a right-to-left override inside the comment. The line runs differently from how it reads (Trojan Source). A run of variation selectors after a normal character can carry a whole payload that a loader decodes (Glassworm).

## Good
```javascript
// scripts/check.js
const isAdmin = false;
if (isAdmin) { console.log("hello"); }
```

## Fix
Delete the characters. `grep -nP '[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FE00}-\x{FE0F}\x{E0000}-\x{E007F}]' scripts/*` shows where they are. If the script has to print such a character, write it as an escape (`"‮"`) so it is visible.

## Catches
One or more `00` bytes in the file. Text never contains NUL; it shows up when a binary is misnamed `.md`, when a UTF-16 file is read as UTF-8, or when a crash or a bad merge left padding behind.

## Bad
```text
$ xxd .cursorrules | tail -2
00000a40: 2074 6865 2074 6573 7473 2e0a 0000 0000   the tests.......
00000a50: 0000 0000 0000 0000 0000 0000 0000 0000  ................
```
An editor crash truncated the file and the filesystem filled the rest with zeros. Many tools stop reading at the first NUL; some refuse the file as binary.

## Good
```text
$ xxd .cursorrules | tail -1
00000a40: 2074 6865 2074 6573 7473 2e0a             the tests..
```

## Fix
Check what the file is with `file CLAUDE.md`. If it is UTF-16, see [encoding](encoding.md). If it is text with trailing zeros, restore it from git (`git checkout -- CLAUDE.md`) or delete the padding and re-save.

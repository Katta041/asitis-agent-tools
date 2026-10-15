## Catches
A script in a skill folder that makes network calls (`curl`, `wget`, `requests`, `fetch` and the like). The note lists the hosts written in the script, or says the host is not written literally, so a reviewer can judge them. Markdown in the skill folder is not checked for this. Needs `--include skills`. Not a problem by itself: many skills call an API.

## Bad
```bash
# scripts/fetch-docs.sh
curl -s https://api.example.invalid/v1/docs
curl -s https://203.0.113.9/x
```
The second host is a bare IP with no mention anywhere in the skill. That is the one to ask about.

## Good
```bash
# scripts/fetch-docs.sh
# Reads the public docs index from api.example.invalid (see SKILL.md, "Network").
curl -s https://api.example.invalid/v1/docs
```
This still gets the note, since every network call does. The difference is that the one host is the API the skill is for, and SKILL.md says so.

## Fix
Nothing, if the hosts are the ones the skill is for. Name them in `SKILL.md` so the next reviewer does not have to grep. Remove calls to hosts you cannot explain.

## Catches
Text in a steering file shaped like an API key or token (AWS access keys, GitHub, Anthropic, OpenAI, Slack, Stripe, npm and Google API keys) or a PEM private key with key material under its header. Placeholders are skipped: values containing EXAMPLE, xxxx, your, dummy or similar, typed runs such as 123456 or aaaaa, and a PEM header with no key under it (a rule about keys, not a key). The message names the key type, line and column, never any part of the key, and the finding's fingerprint is built from the key type, so a baseline file holds nothing derived from the key. No fix diff is offered for lines next to a key, because the diff would print the line.

## Bad
```markdown
# Deploys

Use the deploy token ghp_ followed by 36 random letters and digits when calling the API.
```
The file is committed, pushed and mirrored, and it is sent to the model provider in every session.

## Good
```markdown
# Deploys

The deploy token is in the DEPLOY_TOKEN environment variable; never paste it into files.
```

## Fix
Revoke the key first: removing it from the file does not remove it from git history. Then delete it and load it from an environment variable or a secret store.

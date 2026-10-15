## Catches
A skill `description` over 1,024 characters, the limit in the Agent Skills spec.

## Bad
```markdown
---
name: incident-report
description: Write an incident report. Start by collecting the timeline from the on-call channel, then list every alert that fired with its timestamp, then the customer impact in minutes and affected regions, then the root cause in the five-whys format we agreed in 2024, then the remediation items with owners and due dates, then... (1,400 characters)
---
```
The whole procedure was pasted into the description. Validators reject it, and every character of it sits in the skill listing of every session whether or not the skill is used.

## Good
```markdown
---
name: incident-report
description: Write a post-incident report in the team template. Use after an incident is resolved or when asked for a postmortem.
---

# Incident report

1. Collect the timeline from the on-call channel.
2. List every alert with its timestamp.
...
```

## Fix
Keep the description to what the skill does and when to use it, with the words a user would say. Move the steps into the body, which loads only when the skill runs.

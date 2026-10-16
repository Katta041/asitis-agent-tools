# skills-sec

Defanged copies of patterns from malicious agent skills (Snyk ToxicSkills, OpenSourceMalware ClawHub
reports, the Nx incident). Every host is `example.invalid`, every payload is `echo hello`, and no file
is executable. test/skills.test.ts says which rule each file must trigger. Binaries, symlinks and
invisible characters are built inside the tests, not stored here.

# Runs the same prebuilt server the Claude Code plugin ships (plugins/asitis/server).
# It has no dependencies, so there is no npm install step.
#
#   docker build -t asitis-mcp .
#   docker run -i --rm --network none --read-only -v "$PWD":/workspace:ro asitis-mcp
#
# Mount your project read-only at /workspace, or pass --root with another mounted path.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a

LABEL org.opencontainers.image.source="https://github.com/Katta041/asitis-agent-tools" \
      org.opencontainers.image.description="Read-only MCP server and linter for CLAUDE.md, AGENTS.md and SKILL.md" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="0.4.4" \
      io.modelcontextprotocol.server.name="io.github.Katta041/asitis-mcp"

WORKDIR /app
COPY plugins/asitis/server/asitis-mcp.mjs plugins/asitis/server/asitis.mjs plugins/asitis/server/THIRD_PARTY_NOTICES.md plugins/asitis/server/VERSION ./
COPY LICENSE ./

USER node
ENTRYPOINT ["node", "/app/asitis-mcp.mjs"]
CMD ["--root", "/workspace"]

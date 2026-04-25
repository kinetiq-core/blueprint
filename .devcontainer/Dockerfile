FROM mcr.microsoft.com/devcontainers/typescript-node:22

# Claude Code CLI + Codex CLI. Both CLIs' runtime state lives in shared
# Docker volumes (kinetiq-claude-home, kinetiq-codex-home) mounted at
# /home/node/.claude and /home/node/.codex respectively.
RUN npm install -g \
    @anthropic-ai/claude-code \
    @openai/codex

RUN codex --version

RUN git config --system --add safe.directory '*'

# Bind-mounted repo lives on the Windows host filesystem where line endings
# are CRLF (after Windows git's autocrlf conversion on checkout). The Linux
# container's default git has no autocrlf, so it sees CRLF-in-working-tree
# vs LF-in-index blobs and reports many "modified" files. Match the host's
# behaviour so status is consistent across host and container.
RUN git config --system core.autocrlf true

# Pre-create named-volume mount paths with `node` ownership. When compose
# first attaches an empty Docker volume, it copies the image directory's
# ownership into the volume. Without this, the mount point is created as
# root:root and writes (npm install, claude/codex sessions) fail with EACCES.
RUN mkdir -p /workspaces/kinetiq-core/blueprint/node_modules \
    /home/node/.codex \
    /home/node/.claude \
 && chown -R node:node /workspaces /home/node/.codex /home/node/.claude

USER node

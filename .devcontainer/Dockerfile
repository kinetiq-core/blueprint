FROM mcr.microsoft.com/devcontainers/typescript-node:22

RUN npm install -g @anthropic-ai/claude-code

RUN git config --system --add safe.directory '*'

# Bind-mounted repo lives on the Windows host filesystem where line endings
# are CRLF (after Windows git's autocrlf conversion on checkout). The Linux
# container's default git has no autocrlf, so it sees CRLF-in-working-tree
# vs LF-in-index blobs and reports many "modified" files. Match the host's
# behaviour so status is consistent across host and container.
RUN git config --system core.autocrlf true

USER node

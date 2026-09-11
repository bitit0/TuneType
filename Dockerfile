# The API server. The client is a static bundle and goes to Pages, not in here.
FROM node:22-slim

WORKDIR /app

# Manifests first, so a source change does not reinstall the world on every build.
#
# The client manifest is copied even though the client is never installed: npm resolves the
# workspace graph from the lockfile and refuses to run if a declared member is missing. `shared/`
# is not a workspace — it is plain source reached through tsconfig paths — so it has none.
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/

# Only what the server actually runs. Without the workspace filter this would pull React, Chakra
# and Playwright into an image that never serves a page — bigger to push, and slower to cold-start,
# which is the metric that matters on a platform that scales to zero.
#
# tsx is a runtime dependency here, not a dev one: `npm start` executes TypeScript directly rather
# than a build output, so --omit=dev must not remove it.
RUN npm ci --omit=dev --workspace=server --include-workspace-root

# `shared/` is types only and erases at runtime, but server/tsconfig.json maps @shared/* into it and
# tsx reads those paths while transpiling. Missing, the import fails to resolve at startup.
COPY shared/ shared/
COPY server/ server/

ENV NODE_ENV=production

# Cloud Run supplies PORT and expects the process to bind it. The server already reads it, and
# Node's listen() binds every interface by default, which is what the platform health check needs.
EXPOSE 8080

CMD ["npm", "start", "--workspace", "server"]

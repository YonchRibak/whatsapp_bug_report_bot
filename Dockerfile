# The Docker build context is the repo root. Install the full pnpm workspace (so the
# bot's devDeps like typescript are present), compile with tsc, and bake dist/ into the
# image. A Dockerfile gives deterministic control over the runtime image contents, unlike
# nixpacks which non-deterministically dropped compiled output and source.
FROM node:20-slim

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true

# pnpm 10.23.0 via corepack (bundled with Node).
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

# Install workspace deps from the committed lockfile. Manifests first for layer caching.
# onlyBuiltDependencies (in package.json / pnpm-workspace.yaml) approves esbuild/protobufjs
# so pnpm 10 doesn't abort on its ignored-build-scripts gate.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot-server/package.json ./apps/bot-server/
RUN pnpm install --frozen-lockfile

# Copy source and compile TypeScript to apps/bot-server/dist/.
COPY . .
RUN pnpm build

# Env is provided by Railway at runtime.
CMD ["node", "apps/bot-server/dist/index.js"]

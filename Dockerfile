# Railway's Root Directory for this service is apps/bot-server, so the Docker build
# context is that folder (all paths below are relative to it). A Dockerfile gives full
# control over the runtime image contents, unlike nixpacks which was non-deterministic
# about carrying the compiled dist/ and source into the runtime.
FROM node:20-slim

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# pnpm via corepack (bundled with Node).
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

# Install deps. There's no lockfile in this sub-package context, so resolve fresh
# (--no-frozen-lockfile) and skip dependency build scripts (esbuild's binary is only
# for tsx, unused at runtime; protobufjs's postinstall isn't needed by the Vision client).
COPY package.json ./
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# Compile TypeScript to dist/, which lives in this final image.
COPY . .
RUN pnpm build

# Env is provided by Railway at runtime.
CMD ["node", "dist/index.js"]

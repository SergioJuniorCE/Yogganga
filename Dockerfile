FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Pin the workspace package manager; the repo declares pnpm@12.6.0.
RUN npm install --global pnpm@12.6.0

# The app package file is needed for pnpm to resolve the workspace; its
# dependencies are not installed because the server filter selects only one.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/package.json ./app/
COPY server/package.json ./server/
RUN pnpm install --filter @yogganga/server --prod --frozen-lockfile

COPY server ./server

WORKDIR /app/server
EXPOSE 8787

# Node 24 runs the TypeScript entrypoint directly. server/.env is supplied at
# runtime through compose, not baked into the image.
CMD ["node", "--env-file-if-exists=.env", "src/index.ts"]

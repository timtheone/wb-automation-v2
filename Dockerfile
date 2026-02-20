FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.6.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/bot/package.json apps/bot/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/wb-clients/package.json packages/wb-clients/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

RUN SUPERCRONIC_VERSION=v0.2.43 \
  && ARCH="$(dpkg --print-architecture)" \
  && case "${ARCH}" in \
  amd64) SUPERCRONIC_ARCH="amd64" ;; \
  arm64) SUPERCRONIC_ARCH="arm64" ;; \
  *) echo "Unsupported architecture: ${ARCH}" && exit 1 ;; \
  esac \
  && curl -fsSL "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${SUPERCRONIC_ARCH}" -o /usr/local/bin/supercronic \
  && chmod +x /usr/local/bin/supercronic

EXPOSE 3000

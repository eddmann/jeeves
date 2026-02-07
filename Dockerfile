# ---- base: shared runtime with system tools ----
FROM oven/bun:1-debian AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    jq \
    ca-certificates \
    unzip \
    make \
  && rm -rf /var/lib/apt/lists/*

# uv (Astral's Python package manager — handles Python itself)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
  && mv /root/.local/bin/uv /usr/local/bin/uv

# buns (TypeScript script runner with inline dependencies)
RUN ARCH=$(dpkg --print-architecture) \
  && case "$ARCH" in arm64) SUFFIX=arm64 ;; amd64) SUFFIX=x64 ;; esac \
  && curl -fsSL "https://github.com/eddmann/buns/releases/latest/download/buns-linux-${SUFFIX}" -o /usr/local/bin/buns \
  && chmod +x /usr/local/bin/buns

# phpx (PHP script runner with inline dependencies)
RUN ARCH=$(dpkg --print-architecture) \
  && case "$ARCH" in arm64) SUFFIX=arm64 ;; amd64) SUFFIX=x64 ;; esac \
  && curl -fsSL "https://github.com/eddmann/phpx/releases/latest/download/phpx-linux-${SUFFIX}" -o /usr/local/bin/phpx \
  && chmod +x /usr/local/bin/phpx

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# Tailscale (optional — activated when TS_AUTHKEY is set)
RUN curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg \
    > /usr/share/keyrings/tailscale-archive-keyring.gpg \
  && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list \
    > /etc/apt/sources.list.d/tailscale.list \
  && apt-get update && apt-get install -y --no-install-recommends tailscale \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- deps: install node dependencies ----
FROM base AS deps

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- prod: production target ----
FROM base AS prod

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src/ ./src/
COPY skills/ ./skills/
COPY Makefile ./
COPY entrypoint.sh ./

RUN make build && chmod +x entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
CMD ["make", "run"]

# ---- dev: development target ----
FROM base AS dev

COPY --from=deps /app/node_modules ./node_modules

# Source is bind-mounted at runtime: -v $(pwd):/app
CMD ["make", "dev"]

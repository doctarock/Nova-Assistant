FROM node:22-slim

ARG OPENCLAW_UID=1001
ARG OPENCLAW_GID=1001

# Install system deps for npm/git and Playwright Chromium
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    zip \
    unzip \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libatspi2.0-0 \
    libxshmfence1 \
    libx11-xcb1 \
    libgtk-3-0 \
    libpango-1.0-0 \
    libcairo2 \
    fonts-liberation \
    xdg-utils \
 && rm -rf /var/lib/apt/lists/*

# Create a stable non-root user and pre-seed the sandbox state layout.
RUN groupadd --gid ${OPENCLAW_GID} openclaw \
 && useradd -m --uid ${OPENCLAW_UID} --gid ${OPENCLAW_GID} openclaw \
 && install -d -o ${OPENCLAW_UID} -g ${OPENCLAW_GID} \
    /home/openclaw/.observer-sandbox \
    /home/openclaw/.observer-sandbox/workspace \
    /home/openclaw/.observer-sandbox/workspace/memory \
    /home/openclaw/.observer-sandbox/workspace/memory/questions \
    /home/openclaw/.observer-sandbox/workspace/memory/personal \
    /home/openclaw/.observer-sandbox/workspace/memory/briefings \
    /home/openclaw/.observer-sandbox/workspace/skills \
    /home/openclaw/observer-output

USER openclaw
WORKDIR /home/openclaw

COPY patch-openclaw.mjs /tmp/patch-openclaw.mjs

# Install OpenClaw via npm into a user-owned prefix
RUN npm config set prefix /home/openclaw/.npm-global \
 && npm install -g openclaw playwright \
 && /home/openclaw/.npm-global/bin/playwright install chromium \
 && node /tmp/patch-openclaw.mjs

ENV PATH="/home/openclaw/.npm-global/bin:${PATH}"

CMD ["openclaw", "--help"]

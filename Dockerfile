FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Playwright base image already ships with Chromium, so skip the download
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NODE_ENV=production

# Install deps (use --ignore-scripts to also bypass our postinstall hook)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Build TS
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc && npm prune --omit=dev

# Drop privileges — the pwuser user is provided by the base image
USER pwuser

ENTRYPOINT ["node", "dist/index.js"]
CMD ["--help"]

# The Playwright image already carries Chromium and every system library it needs.
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PORT=3000

WORKDIR /app

# Install dependencies first so code edits do not invalidate the npm layer.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts

COPY . .

# Build the playground, then drop the dev-only dependencies from the image.
RUN npm run build && npm prune --omit=dev --ignore-scripts

# Job and cache databases live here; mount a volume to keep them across deploys.
RUN mkdir -p /app/.freecrawl && chown -R pwuser:pwuser /app
USER pwuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]

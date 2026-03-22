FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/core/package.json packages/core/
COPY packages/agent/package.json packages/agent/
COPY packages/gateway/package.json packages/gateway/
COPY packages/channels/package.json packages/channels/
COPY packages/plugins/package.json packages/plugins/
COPY packages/cli/package.json packages/cli/
COPY packages/ui/package.json packages/ui/
RUN npm ci
COPY . .
RUN cd packages/ui && npx vite build

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app .
RUN npm prune --production
EXPOSE 19200
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:19200/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "packages/cli/src/index.ts", "gateway", "run", "--bind", "lan"]

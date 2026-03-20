FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts

FROM node:22-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY dist ./dist
COPY package.json ./
ENV NODE_ENV=production
EXPOSE 8080
COPY .fly/tls.crt /app/tls.crt
COPY .fly/tls.key /app/tls.key
RUN chmod 600 /app/tls.key
CMD ["sh", "-c", "node dist/cli.js service --admin-token=$NANO_ADMIN_TOKEN --secret=$NANO_SECRET --data-dir=${DATA_DIR:-/data} --service-port=${PORT:-8080} --tls-cert=/app/tls.crt --tls-key=/app/tls.key"]

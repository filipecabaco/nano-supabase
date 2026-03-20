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
ENTRYPOINT ["node", "dist/cli.js", "service"]

# Single image: builds the PWA, builds the API, serves both from Fastify.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci
COPY api api
COPY web web
RUN npm run build -w web && npm run build -w api

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY api/package.json api/
RUN npm ci --omit=dev -w api
COPY --from=build /app/api/dist api/dist
COPY --from=build /app/api/drizzle api/drizzle
COPY --from=build /app/web/dist web/dist
EXPOSE 3001
# Run pending migrations, then start the server.
CMD ["sh", "-c", "node api/dist/migrate.js && node api/dist/index.js"]

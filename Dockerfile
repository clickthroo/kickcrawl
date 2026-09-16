# --- deps: install workspace dependencies once, cached across builds ---
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN npm install

# --- build: compile the API and build the admin SPA ---
FROM deps AS build
COPY . .
RUN npm run build

# --- runtime: Playwright's own image already ships Chromium + its OS deps,
# which keeps this the only place we need to worry about browser deps at all ---
FROM mcr.microsoft.com/playwright:v1.48.0-jammy AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
# npm workspaces doesn't always hoist every dependency to the root
# node_modules above - which package lands where depends on version
# ranges across the whole tree, so it isn't something to rely on staying
# put. Copy apps/api's own node_modules too so anything npm placed there
# instead (e.g. playwright, whose exact pinned version needs to match
# this image's bundled Chromium build) still resolves at runtime.
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/admin/dist ./apps/admin/dist

EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]

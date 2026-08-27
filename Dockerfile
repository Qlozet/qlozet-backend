# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=22.13.1
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="NestJS"

# NestJS app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Dependencies stage. Kept separate from the build so the (large, rarely
# changing) node_modules layer keeps its digest when only source changes —
# package-lock.json has changed once in the last ~290 pushes to main. No
# build toolchain is installed: nothing here compiles from source. argon2 and
# bcrypt both ship prebuilds/linux-x64/*.node consumed by node-gyp-build, and
# `find node_modules -path '*/build/Release/*.node'` returns zero.
FROM base AS deps

COPY package-lock.json package.json ./
RUN npm ci --include=dev


# Throw-away build stage to reduce size of final image
FROM deps AS build

# Copy application code
COPY . .

# Build application
RUN npm run build


# Final stage for app image
FROM base

# Copied piecewise rather than `COPY --from=build /app /app`, so that
# node_modules is its own layer and is not re-pushed and re-pulled on every
# commit. Each path below is required at runtime:
#   node_modules  — devDeps included on purpose; @gradio/client is imported at
#                   src/modules/measurement/measurement.service.ts:11, and
#                   run-script.yml drives the maintenance scripts with ts-node
#   dist          — CMD runs dist/src/main
#   src           — app.module.ts:89 resolves mail templates from
#                   process.cwd()/src/modules/notifications/mail
#   scripts       — run-script.yml executes ts-node against scripts/*.ts
#   tsconfig*     — ts-node reads them for those script runs
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY package.json package-lock.json tsconfig.json tsconfig.build.json nest-cli.json ./

# Start the server by default, this can be overwritten at runtime
EXPOSE 5000
CMD [ "npm", "run", "start:prod" ]

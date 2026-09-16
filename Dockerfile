# syntax=docker/dockerfile:1

# O client do Prisma 7 e gerado como TypeScript puro e compilado pelo tsc,
# e o acesso ao banco passa por @prisma/adapter-pg. Nao ha engine nativo nem
# wasm no bundle, entao alpine/musl e seguro e nao existe binaryTarget a declarar.

########################  deps  ########################
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

########################  build  #######################
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate \
 && npm run build

#######################  migrate  ######################
# Alvo separado porque `prisma migrate deploy` precisa do Prisma CLI, que e
# devDependency. Rode como job/one-shot, nunca no start do app: com mais de
# uma instancia, migrar no boot gera corrida entre replicas.
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

#######################  runtime  ######################
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache tini

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# `nest build` emite dist/src/** e dist/generated/** porque o rootDir inferido
# e a raiz comum de src/ e generated/. O entrypoint real e dist/src/main.js.
COPY --from=build /app/dist ./dist

USER node
EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/main"]

# Imagen de Dockyard. La herramienta controla el Docker del anfitrión a través de su socket,
# así que la imagen solo necesita el cliente de Docker y el complemento de compose, no el motor.

# --- Etapa de compilación: instala dependencias y compila core, api y web.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# --- Etapa final: Node, git, unzip y el cliente de Docker con compose.
FROM node:24-slim
# Repositorio oficial de Docker para Debian, según https://docs.docker.com/engine/install/debian/
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git unzip \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4300
CMD ["npm", "run", "start"]

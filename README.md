# Dockyard

Aplicación web local para que el docente registre proyectos de estudiantes (desde un repositorio de GitHub o un ZIP), los encienda, los apague y los abra en el navegador. Cada proyecto corre con su propio `docker compose`.

## Instalar en la PC del docente

Requisitos: Linux con Docker y el complemento `docker compose`.

```bash
git clone https://github.com/N0Namesir/Dockyard.git
cd Dockyard
./install.sh                 # o TOOL_PORT=4400 ./install.sh
```

Queda disponible en http://localhost:4300 y vuelve sola después de reiniciar la PC.

## Desarrollar en una laptop

Requisitos: Node 24 o superior, `docker`, `docker compose`, `git` y `unzip`.

```bash
git clone https://github.com/N0Namesir/Dockyard.git
cd Dockyard
npm install
npm run dev                  # api y web en modo desarrollo
```

En desarrollo no se usa el contenedor: la herramienta usa el Docker de la laptop directamente.

| Comando | Qué hace |
|---|---|
| `npm run build` | Compila `core`, `api` y `web` |
| `npm run start` | Arranca la herramienta compilada |
| `npm test` | Pruebas del núcleo que no necesitan Docker |
| `npm run test:docker -w core` | Pruebas del núcleo con Docker real (publican 8081 a 8083) |
| `npm run try -w core -- <url \| zip \| carpeta>` | Prueba manual del núcleo con un proyecto |
| `npm run typecheck` | Revisa los tipos de todos los paquetes |

## Estructura

| Carpeta | Qué contiene | Responsable |
|---|---|---|
| `core/` | Núcleo: obtiene el código y controla los proyectos con `docker compose` | Área 1 (0V3R) |
| `api/` | Servidor Fastify y base de datos SQLite | Área 2 (Isaac) |
| `web/` | Interfaz con Astro y Tailwind | Área 3 (Isaac) |
| `docs/` | Guía técnica, manual de usuario y requisitos para los proyectos | Área 4 (0V3R) |
| `ejemplos/` | Proyectos de prueba con compose | Área 4 (0V3R) |

## Documentación

- [Guía técnica](docs/guia-tecnica.md): para quien continúe el proyecto.
- [Manual de usuario](docs/manual-usuario.md): para el docente.
- [Requisitos para proyectos de estudiantes](docs/requisitos-proyectos.md): para repartir a los equipos.

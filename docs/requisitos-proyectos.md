# Requisitos para proyectos de estudiantes

Para que el docente pueda encender tu proyecto en Dockyard, debe cumplir estas reglas.

1. **El archivo compose va en la raíz**, con el nombre `compose.yaml` o `docker-compose.yml`. En un ZIP puede estar dentro de una única carpeta principal.
2. **Cada servicio usa una imagen publicada** (`image: nginx:alpine`) **o un `build:` con su Dockerfile** incluido en el proyecto.
3. **La base de datos va dentro del mismo compose**, con un volumen con nombre para que los datos no se pierdan al apagar.
4. **Si el proyecto necesita variables, incluye un `.env.example`** con valores que funcionen. Dockyard lo copia como `.env` al registrar el proyecto. No subas tu `.env` real.
5. **Publica puertos poco comunes y distintos de los de otros equipos** (por ejemplo, del 8100 en adelante, según te asigne el docente). Dos proyectos no pueden encenderse a la vez si usan el mismo puerto. Evita el 4300, que usa Dockyard.
6. **No uses `container_name` en tu compose.** Dos proyectos no pueden tener contenedores con el mismo nombre, aunque uno esté apagado.
7. **En un ZIP no incluyas `node_modules` ni `.git`.**
8. **El repositorio debe ser público** y su URL debe empezar con `https://`.

## Ejemplo mínimo

```yaml
services:
  web:
    build: .
    ports:
      - "8110:3000"
    environment:
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@db:5432/postgres
    depends_on:
      - db
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - datos:/var/lib/postgresql/data
volumes:
  datos:
```

Con un `.env.example` que contenga `POSTGRES_PASSWORD=ejemplo`.

Antes de entregar, comprueba que tu proyecto enciende desde cero en una carpeta limpia:

```bash
cp .env.example .env
docker compose up -d --build
```

# Guía para estudiantes: cómo preparar su proyecto con Docker

Todo proyecto entregado a la especialidad debe poder ejecutarse en la plataforma del docente con Docker, sin instalar nada a mano. Esta guía dice qué archivos debe traer su proyecto, qué debe evitar y cómo comprobar, antes de entregar, que funciona.

La plataforma levanta cada proyecto con un solo comando, `docker compose up -d --build`, desde la carpeta que ustedes entregan. Si ese comando funciona en una computadora limpia, funcionará en la plataforma.

No se espera que todo el proyecto funcione al cien por ciento. Basta con que se levante y muestre lo más básico o lo más llamativo. Se puede usar internet (APIs, fuentes, librerías externas), sabiendo que esa parte depende de que haya conexión.

## Qué debe traer su proyecto

Cuatro requisitos son obligatorios. Si falta alguno, el proyecto no se puede alojar.

1. **Un archivo `docker-compose.yml` en la raíz** del repositorio o del ZIP. Si el ZIP trae una sola carpeta contenedora, se acepta; con varias carpetas en la raíz no se puede detectar el proyecto.
2. **Todo lo que el proyecto necesita, dentro del compose.** La base de datos es un servicio más del compose. No puede depender de un MySQL, PostgreSQL o similar instalado en la computadora de alguien.
3. **Arranque desde cero, sin pasos manuales.** Con `docker compose up -d --build` el sitio debe quedar funcionando. Las tablas y los datos iniciales se cargan solos, con scripts de inicio de la base de datos, migraciones o un seed al arrancar.
4. **Un puerto publicado para la interfaz web.** Debe aparecer en `ports:` del servicio que se abre en el navegador. Si el frontend llama al backend por un puerto fijo (por ejemplo `localhost:4000`), ese puerto también debe estar publicado.

## Qué evitar

Estas prácticas funcionan en la computadora del estudiante, pero rompen el alojamiento o chocan con otros proyectos.

| Evitar | Por qué | Qué hacer en su lugar |
|---|---|---|
| `container_name: algo` | Los nombres fijos chocan entre proyectos | Quitarlo; Compose genera nombres únicos |
| Volúmenes o redes con `external: true` | Dependen de algo que no existe en la plataforma | Declararlos dentro del mismo compose |
| Rutas absolutas como `/home/usuario/datos` | Esa carpeta no existe en el servidor | Rutas relativas (`./datos`) o volúmenes con nombre |
| Un `.env` que no está en el repositorio | Las variables quedan vacías y el proyecto falla | Valores por defecto en el compose (`${VAR:-valor}`), escritos directamente o en un `.env.example`, que la plataforma copia como `.env` |
| `privileged: true`, montar `/var/run/docker.sock`, `network_mode: host` | Dan control del servidor y de otros proyectos | No usarlos |
| Claves reales, respaldos de bases de datos o datos de personas reales | Viajan con el proyecto y otras personas pueden leerlos. Cada equipo responde por lo que entrega ([aviso legal](aviso-legal.md)) | Datos ficticios y claves de prueba. Si una clave real se filtró, hay que cambiarla |
| Pasos interactivos o instalar cosas a mano dentro del contenedor | Nadie estará para responder | Automatizar todo en el `Dockerfile` o en un script de inicio |

## Plantillas para empezar

Adapten los nombres, puertos y credenciales a su proyecto. Los archivos van en la raíz, junto al código. En los ejemplos se usa el puerto del Equipo 1; usen el de su equipo.

### `docker-compose.yml` (aplicación con base de datos)

```yaml
services:
  app:
    build: .
    ports:
      - "8101:3000"          # puerto del host : puerto de la app
    environment:
      DB_HOST: db
      DB_USER: alumno
      DB_PASS: alumno
      DB_NAME: mi_proyecto
    depends_on:
      db:
        condition: service_healthy

  db:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: rootpass
      MYSQL_DATABASE: mi_proyecto
      MYSQL_USER: alumno
      MYSQL_PASSWORD: alumno
    volumes:
      - db_data:/var/lib/mysql
      - ./db/init:/docker-entrypoint-initdb.d   # los .sql de esta carpeta crean tablas y datos
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1"]
      interval: 5s
      retries: 20
      start_period: 30s

volumes:
  db_data:
```

- La base de datos se conecta con el nombre del servicio (`db`), no con `localhost`.
- Los scripts de `db/init` solo se ejecutan la primera vez que se crea el volumen.
- Empiecen cada `.sql` con `SET NAMES utf8mb4;`. Sin esa línea, los acentos y las eñes se dañan al cargarlo.
- El healthcheck usa `127.0.0.1` a propósito: con `localhost` da "listo" antes de que MySQL acepte conexiones de la app.

### `Dockerfile` para Node.js

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### `Dockerfile` para un sitio estático

```dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
```

En el compose, el servicio publica el puerto de su equipo hacia el 80, por ejemplo `"8101:80"`.

### `Dockerfile` para PHP

```dockerfile
FROM php:8-apache
COPY . /var/www/html
```

En el compose, el servicio publica el puerto de su equipo hacia el 80, por ejemplo `"8101:80"`. Si usan MySQL desde PHP, agreguen la extensión con `RUN docker-php-ext-install pdo_mysql mysqli`.

## Puertos

Cada proyecto publica su puerto en el host, y dos proyectos no pueden usar el mismo mientras estén encendidos. La plataforma avisa del choque antes de encender un proyecto, pero no cambia los puertos por su cuenta.

| Equipo | Puerto principal (interfaz web) | Rango disponible |
|---|---|---|
| Equipo 1 | 8101 | 8101 a 8109 |
| Equipo 2 | 8201 | 8201 a 8209 |
| Equipo 3 | 8301 | 8301 a 8309 |
| Equipo 4 | 8401 | 8401 a 8409 |
| Equipo 5 | 8501 | 8501 a 8509 |

El puerto principal es el de la interfaz que se abre en el navegador. Los otros del rango se usan solo si el proyecto necesita publicar más servicios.

- Usen el puerto de su equipo. Si necesitan publicar más de uno (por ejemplo, frontend y backend), tomen los siguientes dentro de su rango.
- No usen puertos comunes como 80, 3000, 3306, 5432 u 8080 en el lado del host (el número de la izquierda en `"8101:3000"`). Pueden estar ocupados por otras cosas.
- No publiquen el puerto de la base de datos. Basta con que la app la alcance por la red interna del compose; así se evitan choques.
- Si el frontend llama al backend por una dirección con puerto, usen el mismo puerto que publicaron. Con una ruta relativa (`/api/...`) el problema desaparece.
- La plataforma misma usa el puerto 4300; no lo utilicen.

## Cómo se entrega

El docente confirmará si se recibe por repositorio de GitHub, por archivo ZIP o por ambos. En cualquiera de los dos casos, la estructura es la misma:

```text
mi-proyecto/
  docker-compose.yml
  Dockerfile
  README.md
  db/init/01-esquema.sql
  src/ ...
```

- **Repositorio de GitHub:** debe ser accesible sin iniciar sesión y estar en HTTPS (`https://github.com/usuario/repositorio`). Un repositorio privado no se puede clonar.
- **ZIP:** el `docker-compose.yml` debe quedar en la raíz del ZIP o dentro de una única carpeta contenedora. No incluyan `node_modules`, carpetas `.git` ni archivos pesados que no se necesiten; el ZIP tiene un límite de 200 MB.

## Prueba antes de entregar

Hagan la prueba en una carpeta limpia: clonen de nuevo el repositorio o descompriman el ZIP en otra carpeta. Si prueban en su carpeta de trabajo, pueden ocultar archivos que falten en la entrega.

1. Abran una terminal en la carpeta y ejecuten `docker compose up -d --build`.
2. Esperen a que termine y abran el sitio en `http://localhost:<puerto publicado>`.
3. Comprueben que los datos iniciales aparecen y que las funciones principales responden.
4. Ejecuten `docker compose down -v` (borra también los datos) y luego otra vez `docker compose up -d --build`. Debe funcionar igual.
5. Si algo falla, revisen `docker compose logs` y corrijan antes de entregar.

## Lista de verificación

- [ ] Hay un `docker-compose.yml` en la raíz
- [ ] La base de datos es un servicio del compose y se llena sola
- [ ] `docker compose up -d --build` funciona en una carpeta recién clonada
- [ ] El sitio abre en el puerto publicado
- [ ] Usan el puerto de su equipo (tabla de la sección Puertos)
- [ ] No hay `container_name`, `external: true`, rutas absolutas ni `privileged`
- [ ] Las variables necesarias tienen valor por defecto o están en el compose
- [ ] El `README.md` indica puerto, usuarios de prueba y equipo responsable

## README del proyecto

El `README.md` de la raíz debe incluir estos cuatro datos, para que el docente registre el proyecto sin adivinar:

- nombre del proyecto y equipo responsable;
- puerto en el que abre la interfaz web;
- usuarios y contraseñas de prueba, si el sistema tiene inicio de sesión;
- qué hace el proyecto, en dos o tres líneas.

## Errores frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| La app no conecta con la base de datos | Usa `localhost` como host de la BD | Usar el nombre del servicio (`db`) |
| La app arranca antes que la BD y falla | Falta esperar a que la BD esté lista | `healthcheck` en la BD y `depends_on` con `condition: service_healthy` |
| Las tablas no existen | Los scripts de `db/init` no se ejecutaron | Se ejecutan solo con el volumen nuevo: `docker compose down -v` y volver a levantar |
| Acentos dañados (`aÃ±os`) | El `.sql` se cargó sin indicar la codificación | `SET NAMES utf8mb4;` al inicio del `.sql`, luego `docker compose down -v` y volver a levantar |
| "port is already allocated" | Otro programa o proyecto usa ese puerto | Cambiar el puerto del host en `ports:` |
| El frontend carga pero no recibe datos | Llama al backend en un puerto que no está publicado | Publicar ese puerto o usar rutas relativas |
| Funciona en su computadora pero no al clonar | Falta un archivo en el repositorio (`.env`, `.sql`) | Clonar de nuevo y probar en carpeta limpia |

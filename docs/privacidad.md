# Política de privacidad

**Dockyard no recolecta datos.** No tiene cuentas, cookies, analítica ni telemetría, y sus autores no reciben información de quien la usa. Lo poco que necesita para funcionar se queda en la PC donde está instalada.

Esta política cubre a Dockyard, no a los proyectos alojados en ella.

Última actualización: noviembre de 2026.

## Qué se guarda en la PC

| Qué | Dónde | Cuánto dura |
|---|---|---|
| Nombre del proyecto, equipo, origen (URL del repositorio o nombre del ZIP), carpeta y fecha de registro | Base de datos en `data/` | Hasta eliminar el proyecto |
| Código del proyecto | Carpeta `projects/` | Hasta eliminar el proyecto |
| ZIP subido | Carpeta temporal | Se borra al terminar de prepararlo |
| Peticiones a la herramienta, con la ruta pedida y la dirección IP de origen | Registro del contenedor de Dockyard | Hasta que se recrea el contenedor |
| Registros y datos de cada proyecto | Contenedores y volúmenes de Docker | Hasta eliminar el proyecto |

Nada de esto se envía a los autores de Dockyard.

Para el campo Equipo, usa un nombre como "Equipo 3" en lugar de nombres de estudiantes. Dockyard no necesita datos personales.

## Cuándo se conecta a internet

Solo para obtener lo que hace falta, nunca para enviar información sobre su uso:

- **Al registrar desde GitHub:** clona la URL indicada.
- **Al encender un proyecto:** Docker descarga las imágenes y dependencias que ese proyecto pide.
- **Al instalar o compilar Dockyard:** se descargan Docker, Node y las dependencias.

Esos servicios (GitHub, Docker Hub, npm y otros) reciben lo normal en cualquier descarga, como la dirección IP, y aplican sus propias políticas. La telemetría de Astro, la herramienta con la que se compila la interfaz, está desactivada en los comandos del proyecto. La interfaz no carga fuentes, scripts ni imágenes de otros sitios.

## Los proyectos alojados

Cada proyecto es un programa independiente. Puede pedir datos, guardarlos o conectarse a servicios externos sin que Dockyard lo sepa ni lo controle. Esa parte le corresponde al equipo autor. Consulta también el [aviso legal](aviso-legal.md).

## Cómo borrar los datos

- **Un proyecto:** usa Eliminar en la interfaz. Borra su registro, su código, sus contenedores y sus volúmenes.
- **Todo Dockyard:** elimina primero los proyectos, ejecuta `docker compose down` en la carpeta de Dockyard y borra esa carpeta, con `data/` y `projects/`.

## Contacto

Para dudas, abre un caso en [el repositorio](https://github.com/N0Namesir/Dockyard/issues). No incluyas datos personales: los casos son públicos.

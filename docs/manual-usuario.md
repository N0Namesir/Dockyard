# Manual de usuario de Dockyard

Dockyard te permite registrar los proyectos de tus estudiantes, encenderlos, verlos funcionando y apagarlos desde el navegador, sin usar la terminal.

> Pendiente: completar los nombres exactos de botones y pantallas, y agregar capturas, cuando la interfaz esté terminada (Área 3).

## Abrir la herramienta

Abre en el navegador http://localhost:4300. Dockyard arranca sola al encender la PC; no hace falta ejecutar nada.

Si la página no carga, abre una terminal en la carpeta de Dockyard y ejecuta `./install.sh`.

## Registrar un proyecto

Cada proyecto se registra una vez, con un nombre y el equipo al que pertenece. Dockyard ajusta el nombre a un formato válido: por ejemplo, `Tienda Equipo 3` queda como `tienda-equipo-3`.

**Desde un repositorio de GitHub.** Pega la URL del repositorio, que debe empezar con `https://` y ser pública (por ejemplo, `https://github.com/equipo3/tienda`). Dockyard descarga el código.

**Desde un archivo ZIP.** Sube el ZIP que te entregó el equipo. Dockyard lo descomprime.

En los dos casos, el proyecto debe traer su archivo compose. Reparte entre los equipos el documento [Requisitos para proyectos de estudiantes](requisitos-proyectos.md) para evitar problemas.

## Buscar, encender, apagar y abrir

- **Buscar:** escribe parte del nombre del proyecto o del equipo.
- **Encender:** la primera vez puede tardar varios minutos, porque Docker descarga y construye las imágenes del proyecto. Las siguientes veces es rápido.
- **Abrir:** cuando el proyecto está encendido, aparece el enlace a la dirección donde funciona (por ejemplo, http://localhost:8081).
- **Apagar:** detiene el proyecto sin borrar nada. Sus datos se conservan para la próxima vez.

## Problemas frecuentes

| Mensaje | Qué pasa | Qué hacer |
|---|---|---|
| El puerto 8081 ya está en uso por el contenedor … | Otro proyecto encendido usa el mismo puerto | Apaga el otro proyecto y vuelve a intentar, o pide al equipo que cambie el puerto en su compose |
| Docker no responde | El servicio de Docker está apagado | En una terminal: `sudo systemctl start docker` |
| El proyecto tardó más de 10 minutos en encender | La descarga o la construcción de imágenes es muy lenta | Revisa la conexión a internet y vuelve a intentar |
| El proyecto se encendió, pero sus contenedores se detuvieron enseguida | El proyecto tiene un error propio; el mensaje muestra las últimas líneas de su registro | Comparte ese mensaje con el equipo para que lo corrija |
| No se encontró un archivo compose en la raíz del proyecto | El proyecto no cumple los requisitos | Pide al equipo que agregue su `compose.yaml` en la raíz |
| No se pudo clonar el repositorio … | La URL está mal o el repositorio es privado | Revisa la URL o pide al equipo que haga público el repositorio |
| No se pudo descomprimir el archivo | El ZIP está dañado o no es un ZIP | Pide al equipo que lo vuelva a generar |
| Ya existe un proyecto con ese nombre | Ya registraste un proyecto con ese nombre | Usa otro nombre, por ejemplo agregando el número de equipo |

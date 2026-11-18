# Manual de usuario de Dockyard

Dockyard te permite registrar los proyectos de tus estudiantes, encenderlos, verlos funcionando y apagarlos desde el navegador, sin usar la terminal.

![Pantalla principal de Dockyard: listado de proyectos del aula](img/pantalla-principal.png)

## Abrir la herramienta

Abre en el navegador http://localhost:4300. Dockyard arranca sola al encender la PC; no hace falta ejecutar nada. Por seguridad, solo funciona desde esa PC.

Si la página no carga, abre una terminal en la carpeta de Dockyard y ejecuta `./update.sh`. Vuelve a levantar Dockyard, y si hay una versión nueva, la instala.

Al reiniciar la PC, Dockyard vuelve solo y enciende de nuevo los proyectos que dejaste encendidos. Los que apagaste desde Dockyard siguen apagados. Mientras se encienden, la lista muestra su avance. Si alguno no logra encender, queda apagado: al presionar **Encender** verás la causa.

## Instalar el acceso en el escritorio

1. Abre la dirección local de Dockyard en **Chrome o Edge**, en la PC del docente (por defecto `http://localhost:4300`).
2. Pulsa **Instalar app**, en la cabecera, y confirma en el navegador. Si el navegador todavía no ofrece la solicitud, el botón muestra cómo instalarlo desde su menú.
3. Busca **Dockyard** en el menú de aplicaciones de Ubuntu y fíjalo a favoritos. Se abrirá en una ventana propia, sin tener que recordar la dirección.

El navegador decide dónde crear los accesos; no siempre deja un icono directamente sobre el escritorio. Si ya lo instalaste, ábrelo desde el menú de aplicaciones. En navegadores sin instalación de PWA, puedes seguir usando Dockyard en una pestaña y guardar un marcador.

**El icono no enciende Docker ni el servicio de Dockyard.** Ambos deben arrancar con la PC. Si el servicio no responde, el acceso muestra una pantalla de ayuda y **Volver a intentar**. Si continúa detenido, desde la carpeta donde se instaló Dockyard ejecuta `docker compose up -d`. Esto requiere que Docker ya esté disponible.

Instala desde la dirección habitual, siempre en esta PC: `localhost` y `127.0.0.1` se consideran direcciones distintas. Si se cambia el puerto de Dockyard, desinstala el acceso anterior e instálalo desde la nueva dirección.

La aplicación sigue necesitando el servicio local para consultar o cambiar proyectos. No guarda estados antiguos ni deja acciones pendientes para ejecutarlas después. Al actualizar Dockyard, cierra y vuelve a abrir su ventana para cargar la interfaz nueva.

## Registrar un proyecto

Pulsa **+ Registrar proyecto** para abrir el panel lateral. Llena **Equipo**, **Nombre del proyecto** y **Año** (el actual, si no lo cambias), elige el **Origen** y presiona **Registrar proyecto**. Cada proyecto se registra una vez. El nombre se muestra tal como lo escribiste, pero Docker y la carpeta del proyecto usan un **nombre técnico** en minúsculas y con guiones: por ejemplo, `Tienda Equipo 3` queda como `tienda-equipo-3`.

El nombre técnico no se puede repetir, ni entre años. Si el año pasado ya registraste una «Tienda», Dockyard avisa y ofrece **Usar el nombre «tienda-2026»** con un clic: el proyecto se sigue mostrando como «Tienda», y el año lo distingue.

**Origen GitHub.** Pega la **URL del repositorio**, que debe empezar con `https://` y ser pública (por ejemplo, `https://github.com/equipo3/tienda`). Dockyard descarga el código.

**Origen Archivo ZIP.** Elige el ZIP que te entregó el equipo, de 200 MB como máximo. Dockyard lo descomprime.

Al enviar, el panel se cierra y aparece un aviso inmediato mientras se envía y prepara el proyecto. Activa **Seguir registrando proyectos** para mantener el formulario abierto. Cuando la API recibe el proyecto, aparece arriba en la lista como **Registrando**, con lo que está haciendo y, al descargar de GitHub, el porcentaje. Puedes registrar otro mientras tanto, seguir usando Dockyard o cerrar la pestaña una vez recibido el proyecto: la preparación sigue en segundo plano. No cierres la pestaña mientras se está subiendo un ZIP. Cuando termina, aparece como un proyecto más. Si falla, aparece un aviso; abre **Registrar proyecto** para corregir los datos recuperados (si no habías empezado otro registro); si ya habías cerrado la pestaña, la fila dice **No se registró** con el motivo, y **Descartar** la quita.

En los dos casos, el proyecto debe traer su archivo compose. Reparte entre los equipos la [Guía para estudiantes](guia-estudiantes.md) para evitar problemas. Toda la documentación se puede leer dentro de Dockyard, en la sección **Documentación**.

### Revisar antes de encender

Al registrar un proyecto, Dockyard lo revisa sin ejecutarlo. Si encuentra algo, la fila del proyecto muestra **Revisar antes de encender** con la lista de avisos. Por ejemplo, que el proyecto pide control de la PC, que monta carpetas de fuera de su carpeta o que trae claves o respaldos de base de datos.

Los avisos no impiden encender: tú decides. Si no entiendes uno, pregúntale al equipo antes de encender el proyecto. Si avisa de claves, pídele al equipo que las cambie y que las quite del proyecto, porque ya quedaron expuestas.

Que no aparezcan avisos no garantiza que el proyecto sea seguro, así que registra solo proyectos que conozcas.

## Buscar, encender, apagar y abrir

**Abrir** y **Encender/Apagar** están siempre a mano. El nombre de cada proyecto lleva a su ficha. En el botón de tres puntos (**⋯**, Más acciones) están **Actualizar**, **Reemplazar ZIP**, **Editar ficha** y **Ver registro**, según el origen del proyecto, y al final, separadas, las que borran datos: **Reiniciar datos** y **Eliminar**. El menú se abre sobre la tabla sin mover los demás botones. Si una acción no se puede usar en ese momento, como Actualizar con el proyecto encendido, al pasar el puntero o intentar usarla aparece el motivo. En pantallas pequeñas cada proyecto se presenta en una fila apilada.

- **Buscar:** escribe parte del nombre del proyecto, del equipo o de su descripción en **Buscar nombre o equipo**. No importan las mayúsculas ni las tildes.
- **Encender:** la primera vez puede tardar varios minutos, porque Docker descarga y construye las imágenes del proyecto. Mientras tanto, el botón dice **Encendiendo…** y debajo del proyecto se ve qué está haciendo Docker, cuánto lleva y sus últimas líneas. Puedes recargar la página sin interrumpirlo, pero si falla mientras tanto no verás el motivo: usa **Ver registro**. Las siguientes veces es rápido.
- **Abrir:** cuando el proyecto está **Encendido**, este botón abre en otra pestaña la dirección donde funciona (por ejemplo, http://localhost:8081). Si no abre la página correcta, prueba con los números de la columna **Puertos**: cada uno es un enlace.
- **Actualizar:** solo en proyectos de GitHub y con el proyecto apagado. Trae la última versión del repositorio y la revisa de nuevo, sin encenderla. Lee los avisos, si los hay, y usa **Encender**: esa vez reconstruye el proyecto con el código nuevo. Sus datos se conservan, así que una base de datos sigue con lo que tenía. Para los proyectos registrados desde un ZIP está **Reemplazar ZIP**.
- **Reemplazar ZIP:** solo en proyectos registrados desde un ZIP y con el proyecto apagado. Sirve cuando el equipo entrega una versión corregida: eliges el ZIP nuevo, escribes el nombre del proyecto para confirmar, y su código se cambia por el del ZIP sin perder el nombre ni el equipo. Se revisa de nuevo y la siguiente vez que lo enciendas se reconstruye. Los datos que el proyecto guarda en volúmenes de Docker, como la mayoría de las bases de datos, se conservan; lo que guardó dentro de su propia carpeta se borra. Si el ZIP nuevo está dañado o no trae compose, el proyecto queda como estaba.
- **Apagar:** detiene el proyecto sin borrar nada. Sus datos se conservan para la próxima vez.
- **Apagar todos:** aparece sobre la lista cuando hay proyectos encendidos. Apaga todos los proyectos de Dockyard, también los que la búsqueda no muestra, sin borrar nada. Sirve al terminar la clase o cuando la PC se pone lenta. Pide confirmar, y al final dice cuántos apagó y si alguno falló. Los que se están encendiendo, actualizando o eliminando no se tocan.
- **Editar ficha:** abre la ficha del proyecto lista para editar (ver [La ficha del proyecto](#la-ficha-del-proyecto)).
- **Ver registro:** muestra las últimas líneas que escribió el proyecto. Sirve para saber por qué falla y compartirlo con el equipo. Si el proyecto está encendido, se actualiza solo cada pocos segundos. Si subes a leer o seleccionas texto, se detiene para no moverte; baja hasta el final para que siga.
- **Reiniciar datos:** solo con el proyecto apagado. Borra sus bases de datos y lo demás que guardó en volúmenes de Docker, pero conserva su código, su ficha y sus notas. Úsalo cuando el equipo corrige el `.sql` de su base (por ejemplo en `db/init/`) y quieres que se vuelva a cargar, o para empezar una revisión desde cero: al encenderlo, la base se crea de nuevo y carga su `.sql`. Es más rápido que eliminar y registrar de nuevo, porque no reconstruye las imágenes. Lo que el proyecto guarda en carpetas propias (como `./data`) no se toca, porque es parte de su código. Para confirmar hay que escribir el nombre del proyecto, porque no se puede deshacer.
- **Eliminar:** borra el proyecto, su código y sus datos, y libera su nombre. Para confirmar hay que escribir el nombre del proyecto, porque no se puede deshacer.

La tabla se actualiza sola cada 15 segundos. Si un proyecto aparece **Encendido** con el aviso **Con fallas**, uno de sus servicios se cayó; usa **Ver registro** para ver el motivo.

Despliega **Recursos** debajo de **Encendido** para ver cuánta CPU y memoria usa el proyecto. Al pie de la lista aparece el consumo total de los proyectos encendidos. La CPU es sobre toda la PC. Si un proyecto tiene varios servicios, deja el cursor sobre esos datos para ver el detalle. Sirve para saber cuál apagar si la PC se pone lenta.

Debajo de **Encendido** también se indica si la página del proyecto contesta:

- **Web disponible:** Dockyard recibió una respuesta. No revisa si cada función sirve, pero la página está arriba.
- **La web aún no responde:** es normal unos segundos o minutos después de encender, mientras arranca. Si no cambia, usa **Ver registro**.
- **La web responde con error:** el servidor contesta, pero falla. Suele ser un problema del proyecto, como una base de datos que no conecta.

Se comprueba solo el puerto que usa **Abrir**.

## La ficha del proyecto

Cada proyecto tiene una ficha: pulsa su nombre en la lista. Muestra su imagen, su nombre para mostrar, el nombre técnico (en pequeño), el equipo y el año, su estado con **Encender/Apagar** y **Abrir**, y lo que cuenta el equipo:

- **Descripción:** qué hace el proyecto.
- **Indicaciones del equipo:** cómo usarlo, por ejemplo los usuarios de prueba o las rutas importantes.
- **Contactos:** hasta 8 estudiantes, con nombre y, si quieres, correo y teléfono. Pulsar el correo abre tu programa de correo.
- **Notas del docente:** tus notas, por ejemplo qué falta revisar o una calificación. También se ven, cortas, debajo del nombre en la lista.
- Los avisos de la revisión, si los hay, y el consumo de CPU y memoria si está encendido.

**Editar ficha** abre un formulario en la misma página con todos los campos. Para borrar un texto, deja el campo vacío. Para la imagen, elige un PNG, JPEG o WebP de hasta 2 MB, como una captura de pantalla o el logo del proyecto, o pulsa **Quitar imagen**. Si no tiene imagen, se muestra la inicial de su nombre sobre un color.

El **nombre técnico** solo cambia con el proyecto apagado, y se ajusta a minúsculas y guiones como al registrar; la siguiente vez que lo enciendas se reconstruye. Si el proyecto ya guarda datos en volúmenes de Docker, como una base de datos que ya se encendió, no se puede cambiar, porque con otro nombre empezaría sin esos datos. El nombre para mostrar, el equipo y lo demás se cambian siempre.

Los contactos son datos personales de los estudiantes: se guardan solo en esta PC y se borran al eliminar el proyecto (ver [Privacidad](privacidad.md)).

## Espacio en disco

Cada vez que un proyecto se actualiza y se enciende, Docker construye sus imágenes de nuevo y la versión anterior queda guardada. Con el tiempo eso ocupa varios GB.

En **Configuración**, la sección **Espacio en disco** muestra cuánto ocupan los proyectos registrados en total y, en una tabla, cada uno: **Imágenes** (lo que construyó y usa), **Versiones viejas** (lo que se puede liberar) y **Datos** (sus volúmenes de Docker, como una base de datos). El que más ocupa aparece primero.

**Liberar espacio** borra las versiones viejas de todos los proyectos registrados, después de confirmar cuánto se recuperará, y al final dice cuánto se liberó. No apaga ni reconstruye nada, y no toca los datos: esos se borran con **Reiniciar datos** o **Eliminar**, en Proyectos. Tampoco toca las imágenes, volúmenes ni nada más de Docker que no sea de un proyecto registrado. Si algún proyecto se está encendiendo, actualizando o registrando, pide esperar a que termine.

Las imágenes que un proyecto descarga ya hechas (como `postgres` o `nginx`) no cuentan: pueden ser de varios proyectos o de otros programas de la PC.

## Instalar una versión nueva de Dockyard

Cuando hay una versión nueva, aparece un aviso sobre la lista de proyectos. Solo avisa: Dockyard no cambia nada por su cuenta.

Para instalarla, abre **Configuración** en el menú. En **Actualizaciones** ves la versión instalada, la última publicada y cuándo se comprobó. **Comprobar ahora** pregunta a GitHub en ese momento, sin esperar al aviso. Si hay una versión nueva, **Ver qué cambió en GitHub** muestra sus cambios y **Actualizar ahora** la instala después de confirmar.

Mientras se actualiza, Dockyard se reinicia y la página no responde, unos minutos a lo sumo. La página de Configuración espera y se recarga sola con la versión nueva. Tus proyectos registrados y sus datos se conservan, y los que estén encendidos siguen encendidos. Si algo falla, Dockyard sigue con la versión que tenía y Configuración muestra la causa. Dockyard no deja actualizar mientras un proyecto se está encendiendo, apagando o registrando, porque esa operación se cortaría.

También puedes actualizar desde una terminal, en la carpeta de Dockyard:

```bash
./update.sh
```

Es lo que hace **Actualizar ahora** por dentro, y sirve también si la página no carga. `./install.sh` es solo para la primera instalación: si lo ejecutas en una PC donde Dockyard ya está, te indica que uses `./update.sh`. Ninguno de los dos se ejecuta con `sudo`.

Sin internet simplemente no aparece el aviso. Para que Dockyard no consulte versiones nuevas por su cuenta, desmarca **Buscar versiones nuevas automáticamente** en Configuración; **Comprobar ahora** sigue funcionando.

## Problemas frecuentes

| Mensaje | Qué pasa | Qué hacer |
|---|---|---|
| El puerto 8081 ya lo usa el proyecto … | Otro proyecto registrado y encendido usa el mismo puerto | Pulsa **Apagar … y encender este**: Dockyard pide confirmar, apaga el otro sin borrar nada y enciende este. O pide al equipo que cambie el puerto en su compose |
| El puerto 8081 ya está en uso por el contenedor … | Algo que no está en Dockyard usa ese puerto | Apágalo fuera de Dockyard, o pide al equipo que cambie el puerto en su compose |
| El nombre de contenedor … ya lo usa … | Dos proyectos fijan el mismo `container_name` en su compose | Pide al equipo que lo quite de su compose |
| El nombre … ya lo usa otro proyecto de Docker | Hay contenedores con ese nombre fuera de Dockyard | Usa otro nombre al registrar |
| Dockyard solo acepta peticiones desde su propia página | Se intentó usar desde otra página o dirección | Abre http://localhost:4300 en esta PC |
| Docker no responde | El servicio de Docker está apagado | En una terminal: `sudo systemctl start docker` |
| El proyecto tardó más de 10 minutos en encender | La descarga o la construcción de imágenes es muy lenta | Revisa la conexión a internet y vuelve a intentar |
| El proyecto se encendió, pero sus contenedores se detuvieron enseguida | El proyecto tiene un error propio; el mensaje muestra las últimas líneas de su registro | Comparte ese mensaje con el equipo para que lo corrija |
| No se encontró un archivo compose en la raíz del proyecto | El proyecto no cumple los requisitos | Pide al equipo que agregue su `compose.yaml` en la raíz |
| No se pudo clonar el repositorio … | La URL está mal o el repositorio es privado | Revisa la URL o pide al equipo que haga público el repositorio |
| Los contenedores se borraron, pero el proyecto dejó archivos sin permiso de borrado | El proyecto creó archivos como administrador | Ejecuta en una terminal el comando `sudo rm -rf …` que indica el mensaje y presiona **Eliminar** otra vez |
| No se puede conectar con Dockyard | La herramienta no responde | Recarga la página; si sigue igual, ejecuta `./update.sh` en la carpeta de Dockyard |
| Hay archivos de Dockyard modificados en esta PC | Alguien cambió archivos de Dockyard, así que `update.sh` no actualiza para no perderlos | Guárdalos aparte con `git stash` y vuelve a ejecutar `./update.sh` |
| No se pudo descomprimir el archivo | El ZIP está dañado o no es un ZIP | Pide al equipo que lo vuelva a generar |
| La actualización pisaría un archivo que cambió en esta PC | El proyecto escribe en su propia carpeta y la versión nueva cambia ese archivo | Elimina el proyecto y regístralo de nuevo. Se borran sus datos |
| Ya existe un proyecto con el nombre … | Ya registraste un proyecto con ese nombre técnico, quizá en otro año, o quedó su carpeta | Pulsa **Usar el nombre «…»** para usar el que propone Dockyard (con el año), o escribe otro |

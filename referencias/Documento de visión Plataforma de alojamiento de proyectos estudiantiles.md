# Documento de visión: Dockyard, plataforma de alojamiento de proyectos estudiantiles

Oct 31, 2026 · @Eduardo Rivas

## Resumen del proyecto

Se construirá Dockyard, una aplicación web local que permite al docente alojar y ejecutar proyectos de estudiantes en contenedores Docker, verlos funcionando y encenderlos o apagarlos desde una interfaz. El desarrollo dura unos 3 días y lo harán 2 personas. Al entregarse debe estar funcional y tener una estructura limpia, para que el grupo del próximo año pueda escalarla sin problemas.

## Contexto y propósito

El proyecto es un encargo y, a la vez, un legado del equipo para la especialidad de Desarrollo de Software, de la que se graduará pronto. Es una herramienta de apoyo cuyo insumo son proyectos desarrollados por estudiantes y cuyo beneficiario principal es el docente.

Hay dos prioridades, en este orden:

1. Que funcione al momento de la entrega.
2. Que su estructura sea clara y escalable, porque otro grupo la tomará el próximo año.

## Usuarios y entorno de ejecución

La herramienta corre en la PC del docente y se usa desde su navegador, sin exponerse a internet. Se desarrolla en las laptops del equipo y el día de la entrega se clona en esa PC, que tiene Ubuntu 26 y permiso para configurarla como haga falta. Docker se instaló con el script oficial, por lo que debería ser una versión reciente; si no lo es, se actualiza.

| Aspecto | Definición actual |
| --- | --- |
| Usuario principal | El docente |
| Equipo de ejecución | PC del docente, con Ubuntu 26 |
| Acceso | Local, desde la misma PC |
| Autenticación | No entra en la primera versión |
| Volumen inicial | Menos de 10 proyectos a la vez, con capacidad de crecer |
| Tipo de proyectos | Web variada, con base de datos |

## Alcance

La primera versión cubre cuatro capacidades: listar y buscar proyectos, verlos funcionando y administrar sus contenedores desde la interfaz.

**Incluido en la primera versión**

- Registro de proyectos de estudiantes, cada uno con su propio docker-compose.
- Listado y búsqueda de proyectos.
- Encendido y apagado de los contenedores de cada proyecto.
- Visualización del proyecto en ejecución.
- Documentación técnica y manual de usuario.

**Extras opcionales, si el tiempo alcanza**

- Visualización de registros (logs) en vivo.
- Métricas de uso de recursos.
- Proxy inverso con subdominios por proyecto.

**No contemplado por ahora**

- Login para el docente.
- Acceso remoto o desde internet.
- Acceso de estudiantes o público.

## Requisitos funcionales

La herramienta debe cumplir los siguientes once requisitos para considerarse funcional.

1. Registrar un proyecto desde un repositorio de GitHub o un archivo ZIP (formato por confirmar con el profesor).
2. Guardar los datos de cada proyecto: nombre, equipo, ruta, puerto y estado.
3. Listar todos los proyectos registrados.
4. Buscar proyectos por nombre o equipo.
5. Levantar los contenedores de un proyecto desde la interfaz.
6. Apagar los contenedores de un proyecto desde la interfaz.
7. Mostrar el estado actual de cada proyecto (encendido o apagado).
8. Abrir el proyecto en ejecución desde la interfaz.
9. Soportar proyectos web con base de datos, cada uno con su propio docker-compose.
10. Detectar los choques de puertos entre proyectos que corren al mismo tiempo y avisar antes de encender.
11. Normalizar el nombre de cada proyecto para que cumpla las reglas de Docker Compose: minúsculas, dígitos, guiones y guiones bajos, empezando con letra minúscula o dígito.

## Requisitos no funcionales

La calidad de la estructura pesa tanto como las funciones, porque el proyecto lo heredará otro grupo.

| Atributo | Requisito |
| --- | --- |
| Escalabilidad | Debe poder crecer más allá de 10 proyectos sin rediseñar la base |
| Mantenibilidad | Código separado en capas (rutas, servicios, adaptador de Docker, datos) y nombres claros |
| Portabilidad | La herramienta se despliega con su propio docker-compose en Linux |
| Simplicidad operativa | Sin servicios adicionales obligatorios para funcionar |
| Seguridad | En esta entrega no se validan los compose de los proyectos; queda documentado como mejora para el próximo grupo |
| Documentación | Guía técnica que permita a un nuevo grupo continuar el trabajo |

## Arquitectura y stack propuesto

La interfaz web solo habla con la API, y la API es la única que controla Docker.

&#91;embedded content: arquitectura propuesta · 7 componentes\]

La API registra cada proyecto en SQLite, guarda su código en una carpeta propia y usa un adaptador que ejecuta docker compose sobre el Docker Engine del anfitrión. El stack es una propuesta a validar con el equipo.

| Capa | Tecnología | Motivo |
| --- | --- | --- |
| Interfaz | Astro + Tailwind CSS | Rápida de construir y fácil de heredar |
| API | Node.js + TypeScript con Fastify 5 y TypeBox | Valida las entradas con tipos; el proveedor de tipos debe aplicarse de nuevo dentro de cada plugin |
| Control de contenedores | CLI de docker compose (`-p`, `-f`, `ps --format json`), invocada desde un módulo propio | La API de Docker por sí sola no maneja bien los compose, y dockerode-compose deja parte de la especificación sin implementar |
| Validación de proyectos | Fuera de esta entrega (dclint como candidato) | Queda como mejora para el próximo grupo: dclint cubre puertos duplicados y etiquetas de imagen, pero el modo privilegiado, los montajes del sistema y el acceso al socket de Docker requieren reglas propias |
| Datos | SQLite con node:sqlite (Node 24 o superior) | No requiere compilación nativa; se prueba primero en la PC del docente y, si falla, se usa better-sqlite3 |
| Despliegue | docker-compose propio, con acceso al Docker del anfitrión | Instalación simple en Linux |

## Herramientas evaluadas

Se revisaron siete herramientas; ninguna entra en la primera versión; dclint y Traefik quedan para después.

| Herramienta | Decisión | Motivo |
| --- | --- | --- |
| dclint | Para después | Podría validar los compose al registrar un proyecto; queda fuera de esta entrega |
| Traefik | Extra | Da subdominios `.localhost` y responde 503 a los proyectos apagados; exige saber qué servicio y qué puerto interno expone cada proyecto |
| Dockge | Referencia | Gestor de stacks de compose parecido; no cubre catálogo por equipo, importación desde GitHub o ZIP ni la vista del proyecto en ejecución |
| Coolify, Dokploy, CapRover | Descartadas como base | Son plataformas para servidores, demasiado grandes para menos de 10 proyectos en una laptop |
| dockerode-compose | Descartada | Deja parte de la especificación de compose sin implementar |

## Riesgos y consideraciones

El mayor riesgo técnico es ejecutar código de terceros en la PC del docente; el mayor riesgo de gestión es el plazo de 3 días.

| Riesgo | Efecto | Mitigación propuesta |
| --- | --- | --- |
| Choques de puertos | Un proyecto no logra levantar | Detectar el choque antes de encender y avisar qué contenedor ya usa el puerto |
| Ejecutar el compose de terceros | Un compose podría montar rutas del sistema o usar modo privilegiado | Fuera del alcance de esta entrega: se documenta como mejora para el próximo grupo; mientras tanto, el docente registra solo proyectos que conozca |
| Formato de entrega sin definir | Retraso en el registro de proyectos | Soportar repositorio de GitHub y ZIP desde el diseño |
| Plazo de 3 días | Funciones sin terminar | Priorizar las funciones base y dejar los extras para después |
| Proyectos con requisitos distintos | Fallos al ejecutar algunos proyectos | Pedir que cada proyecto traiga su docker-compose y documentar los requisitos mínimos |

## Reparto de áreas

El equipo es de 2 personas y quedan 3 días, así que el trabajo se divide en cuatro áreas con fronteras claras. Cada área entrega algo que las demás pueden usar sin esperar: hasta que llegue lo real, se trabaja con datos simulados. Si una tarea no cabe en tu área, avisa antes de hacerla.

### Área 1: Núcleo Docker y fuentes

- **Qué incluye:** encender, apagar y consultar el estado de un proyecto con docker compose; normalizar el nombre del proyecto; detectar choques de puertos y avisar; obtener el código desde un repositorio de GitHub o un ZIP y dejarlo en una carpeta.
- **Hasta dónde llega:** recibe una carpeta o una fuente y devuelve resultados. No sabe nada de HTTP, de la base de datos ni de la interfaz.
- **Te pasaste si:** escribes rutas de la API, guardas datos en SQLite o dibujas pantallas.
- **Qué entrega:** un módulo con las funciones del contrato, probado a mano con proyectos reales.

### Área 2: API y datos

- **Qué incluye:** el servidor Fastify con las rutas del contrato; la tabla de proyectos en SQLite; guardar y leer proyectos; llamar a las funciones del Área 1 para registrar, encender, apagar y consultar el estado.
- **Hasta dónde llega:** orquesta, no ejecuta. Nunca corre docker compose, git ni descomprime un ZIP por su cuenta.
- **Te pasaste si:** ejecutas un comando de Docker directamente o escribes HTML.
- **Qué entrega:** una API que responde según el contrato y se puede probar con una petición simple, aunque el Área 1 todavía esté simulada.

### Área 3: Interfaz web

- **Qué incluye:** la página con el listado de proyectos y la búsqueda; el formulario para registrar (URL de repositorio o subida de ZIP); los botones de encender y apagar con el estado visible; el enlace para abrir el proyecto en ejecución.
- **Hasta dónde llega:** muestra y envía datos según el contrato. La lógica de estados, puertos y nombres vive en la API y en el Área 1.
- **Te pasaste si:** calculas puertos, decides estados o tratas los datos del navegador como si fueran la fuente de verdad.
- **Qué entrega:** la interfaz funcionando contra la API real o contra datos simulados con la misma forma.

### Área 4: Infraestructura y documentación

- **Qué incluye:** la estructura del repositorio y la configuración de TypeScript; el Dockerfile y el docker-compose de la herramienta; las instrucciones de arranque e instalación en la PC del docente; dos o tres proyectos de prueba con compose, uno de ellos con base de datos; las pruebas de punta a punta; la guía técnica y el manual de usuario.
- **Hasta dónde llega:** prepara el terreno y documenta lo que entregan las demás áreas. No escribe lógica de las otras áreas. Cada área deja notas breves (qué hace y cómo se prueba) para armar la guía.
- **Te pasaste si:** modificas código de otra área sin avisar a su responsable.
- **Qué entrega:** la herramienta se instala con un comando en Ubuntu, los proyectos de prueba corren y los documentos están completos.

### Reparto para dos personas

| Persona | Áreas | Por qué |
| --- | --- | --- |
| 0V3R | Áreas 1 y 4 | Reúne todo lo que toca Docker, archivos e instalación |
| Isaac | Áreas 2 y 3 | Reúne toda la capa web: API, datos e interfaz |

0V3R toma las Áreas 1 y 4; Isaac, las Áreas 2 y 3. Si una persona termina antes, toma trabajo de la otra empezando por lo menos acoplado: pruebas y documentación.

## Contrato entre áreas

Este contrato es una propuesta que permite trabajar en paralelo. Cambiarlo exige avisar a las dos personas.

**Rutas de la API (Áreas 2 y 3)**

| Ruta | Qué hace | Devuelve |
| --- | --- | --- |
| `GET /api/projects?q=` | Lista proyectos, con búsqueda opcional por nombre o equipo | Lista de proyectos |
| `POST /api/projects` | Registra un proyecto desde una URL de repositorio o un ZIP | El proyecto creado |
| `GET /api/projects/:id` | Consulta un proyecto | El proyecto con su estado actual |
| `POST /api/projects/:id/start` | Enciende los contenedores | El proyecto con su nuevo estado |
| `POST /api/projects/:id/stop` | Apaga los contenedores | El proyecto con su nuevo estado |

Un proyecto tiene: id, nombre, equipo, estado (encendido o apagado), dirección de acceso y puertos.

**Funciones del Área 1 (usadas por el Área 2)**

| Función | Recibe | Devuelve |
| --- | --- | --- |
| `prepareProject(source, name)` | URL de repositorio o archivo ZIP, y el nombre del proyecto | Carpeta del proyecto y nombre normalizado |
| `startProject(dir, name)` | Carpeta y nombre | Estado y puertos |
| `stopProject(dir, name)` | Carpeta y nombre | Estado |
| `getProjectStatus(name)` | Nombre | Estado y puertos |
| normalizeProjectName(name) | Nombre libre del proyecto | Nombre válido para docker compose |

## Plan de trabajo en 3 días

Quedan el domingo y el lunes para desarrollar, y el martes es la entrega. Cada persona avanza en sus áreas y el lunes por la tarde se integra todo.

&#91;embedded content: plan de trabajo · 3 días\]

Las áreas se desarrollan en paralelo contra el contrato y con datos simulados; la integración real ocurre el lunes por la tarde.

## Entregables

Se entregan tres productos, no solo el software.

1. **Software funcional:** la plataforma completa, con su propio docker-compose para instalarla en Linux.
2. **Documentación técnica:** arquitectura, estructura de carpetas, modelo de datos y guía para agregar funciones, pensada para el grupo que herede el proyecto.
3. **Manual de usuario:** guía para el docente sobre cómo registrar, buscar, encender y apagar proyectos.

## Decisiones pendientes

Tres puntos deben cerrarse antes o durante el primer día de trabajo.

- [ ] Confirmar con el profesor si acepta repositorio de GitHub, ZIP o ambos.
- [ ] Probar node:sqlite en una laptop y en la PC del docente; si imprime advertencias o falla, usar better-sqlite3.
- [ ] Definir cómo se indica qué servicio y qué puerto web expone cada proyecto (necesario si se usa Traefik).

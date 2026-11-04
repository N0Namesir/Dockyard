# Aviso legal y límites de responsabilidad

Dockyard es una herramienta hecha por estudiantes de Desarrollo de Software (DS3). Permite que un docente aloje en su propia PC los proyectos de otros equipos y los encienda, los apague y los abra desde un solo lugar.

Este aviso explica hasta dónde llega la participación de Dockyard y de sus autores, y qué le corresponde a cada quien. Sobre los datos, consulta la [política de privacidad](privacidad.md).

Última actualización: noviembre de 2026.

## Qué hace Dockyard y qué no

Dockyard descarga o descomprime el proyecto, lo ejecuta con Docker Compose tal como viene y muestra su estado y sus registros. Lo que hace cada proyecto una vez encendido no depende de Dockyard.

Dockyard **no**:

- revisa, audita, corrige ni mantiene el código de los proyectos;
- garantiza que un proyecto encienda o funcione bien, ni que sea seguro;
- hace copias de seguridad;
- es un servicio de alojamiento público ni promete disponibilidad.

## Quién responde por qué

| Quién | De qué responde |
|---|---|
| El equipo autor de cada proyecto | Su código, contenido y funcionamiento; el derecho a usar lo que incluye; los datos y las claves que trae; los servicios externos a los que se conecta |
| El docente o quien instala Dockyard | Qué proyectos registra; la PC y la red donde corre; sus respaldos; quién tiene acceso |
| Los autores de Dockyard | El código de la herramienta, entregado sin garantía, como se indica abajo |

Registrar un proyecto en Dockyard no significa que sus autores lo hayan revisado, aprobado o que respalden su contenido.

## Riesgos que debes conocer

- **Los proyectos ejecutan código en tu PC.** Dockyard no valida el archivo de compose ni protege la descompresión de ZIP. Un proyecto malicioso o mal hecho podría dañar la PC o acceder a sus archivos. Registra solo proyectos que conozcas.
- **La herramienta no tiene inicio de sesión y controla el Docker de la PC.** Por eso solo se publica en `127.0.0.1`. Quien use esa PC puede registrar, encender y eliminar proyectos. No la expongas a la red ni a internet.
- **Los proyectos pueden verse desde la red local.** Un puerto escrito como `"8101:80"` queda abierto en todas las interfaces de la PC, así que otros equipos conectados a la misma red podrían abrirlo.
- **Eliminar no se puede deshacer.** Borra los contenedores, el código y los datos del proyecto en esa PC.

## Datos reales y claves

Los proyectos deben usar datos ficticios y no deben traer claves reales. Si encuentras datos personales o credenciales en un proyecto, no lo compartas, elimina esa copia y avisa al equipo para que retire los datos y cambie las claves.

## Sin garantía

Dockyard se entrega "tal cual", sin garantías de ningún tipo. En la medida en que la ley lo permita, sus autores no responden por daños, pérdida de datos, interrupciones o fallas derivadas de usar la herramienta o de los proyectos alojados en ella.

Dockyard es un trabajo estudiantil. No es un servicio oficial de INSAMT.

## Licencia

El código de Dockyard se publica con la [licencia MIT](https://github.com/N0Namesir/Dockyard/blob/main/LICENSE): se puede usar, copiar y modificar, siempre que se conserve el aviso de autoría y de licencia. Hay tres excepciones:

- **Emblema de Desarrollo de Software:** pertenece a sus titulares y no entra en la licencia MIT. Es de uso público, siempre que no sea con fines de lucro o de desinformación.
- **Proyectos de estudiantes:** conservan la licencia y los derechos de sus autores. Registrarlos en Dockyard no cede ningún derecho.
- **Dependencias:** cada una conserva su propia licencia, indicada en su paquete.

## Cambios y contacto

Este aviso puede cambiar junto con la herramienta; la versión vigente es la que acompaña a cada copia. Para dudas o reportes, abre un caso en [el repositorio](https://github.com/N0Namesir/Dockyard/issues).

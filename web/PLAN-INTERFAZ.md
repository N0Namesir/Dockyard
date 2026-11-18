# Mejora de la interfaz del aula

Objetivo: dar prioridad al listado conservando amarillo, negro y emblema de Software.

- [x] Listado a ancho completo, registro en panel lateral y opción de registrar varios seguidos.
- [x] Acciones principales visibles, secundarias agrupadas, recursos bajo demanda y filas apiladas en móvil.
- [x] Foco visible en origen, conservación de foco y detalles al refrescar, mensaje inmediato durante el registro.
- [x] Paleta institucional con azul petróleo, tipografía de lectura y franja amarilla discreta.
- [x] Compilación, tipos, pruebas existentes y recorridos de navegador con API simulada.

El contrato de la API y la ejecución de Docker se conservan. Las pruebas visuales no deben modificar proyectos reales.

Validación: compilación y tipos correctos; 80 pruebas del núcleo y 54 de API aprobadas. Se añadieron seis recorridos funcionales de Chromium y un caso opcional para capturas. Se verificaron anchos de 320, 375, 768, 1024 y 1440 px.

Rama: `mejora/interfaz-aula`. Manual, captura y guía técnica actualizados. Las pruebas de navegador usan datos simulados, sin encender ni apagar proyectos reales.

# Contribuir a PixelFrame

Gracias por mejorar una herramienta local y privada para trabajar con fotogramas.

## Preparar el proyecto

Usa Node.js 22 o posterior. Después de clonar el repositorio:

```sh
npm ci
npm test
npm run dev
```

Antes de abrir un pull request, ejecuta `npm test` y `npm run build`. Las pruebas de navegador son opcionales y se describen en el README.

## Alcance y principios

- No subas videos de ejemplo privados ni medios con licencias inciertas.
- Mantén el procesamiento en el navegador: PixelFrame no debe requerir una API ni enviar el video del usuario a terceros.
- Conserva la navegación basada en timestamps de presentación; no sustituyas pasos de fotograma por aproximaciones de FPS.
- Añade una prueba cuando cambies aritmética de timecode, almacenamiento, exportación o límites.

## Pull requests

Explica qué cambia, cómo lo probaste y cualquier limitación de navegador o códec. Divide los cambios grandes en PRs pequeños y revisables. Para cambios visibles, incluye una captura o una descripción concreta del comportamiento antes y después.

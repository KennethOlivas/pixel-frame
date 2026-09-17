# Futuro cliente de escritorio

PixelFrame funciona hoy como una aplicación web local-first. Un cliente de escritorio se planificará como un paquete separado con Tauri, no como una dependencia necesaria para el uso web.

## Objetivo

- Abrir archivos locales con permisos explícitos del sistema.
- Mantener exactamente la misma interfaz React y los mismos formatos de exportación.
- Guardar proyectos y hojas de contacto en rutas elegidas por el usuario.
- Ofrecer binarios firmados para macOS, Windows y Linux.

## Decisiones antes de implementarlo

1. Confirmar los targets de escritorio y el proceso de firma/notarización.
2. Diseñar persistencia de proyectos sin copiar el video original automáticamente.
3. Definir una estrategia de actualización sin telemetría obligatoria.

El cliente web seguirá siendo la versión principal y no depende de esta futura integración.

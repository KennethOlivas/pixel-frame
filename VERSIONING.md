# Versionado y releases

PixelFrame usa [Semantic Versioning](https://semver.org/lang/es/):

- `MAJOR`: cambios incompatibles para usuarios o integraciones.
- `MINOR`: nuevas funciones compatibles.
- `PATCH`: correcciones compatibles.

## Publicar una versión

1. Actualiza `version` en `package.json` y `package-lock.json`.
2. Mueve las notas correspondientes de `Unreleased` a `CHANGELOG.md` con la fecha.
3. Ejecuta `npm test` y `npm run build`.
4. Fusiona el cambio en `main`, crea y publica un tag con el formato `vMAJOR.MINOR.PATCH`.

El workflow **Release** valida que el tag coincide con `package.json`, genera la build y publica un archivo `pixel-frame-vX.Y.Z-dist.tar.gz` junto con las notas automáticas de GitHub. El tag es la fuente de verdad; nunca se publican versiones desde ramas sin tag.

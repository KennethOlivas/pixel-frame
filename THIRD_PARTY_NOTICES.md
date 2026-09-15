# Dependencias de terceros

PixelFrame utiliza paquetes de código abierto. Sus versiones exactas están fijadas en `package-lock.json`; los textos de licencia completos están disponibles en los paquetes instalados y repositorios originales.

- React y React DOM: MIT — https://github.com/facebook/react
- Vite: MIT — https://github.com/vitejs/vite
- TypeScript: Apache-2.0 — https://github.com/microsoft/TypeScript
- Radix UI Select y sus primitivas: MIT — https://github.com/radix-ui/primitives
- Phosphor Icons (`@phosphor-icons/react`): MIT — https://github.com/phosphor-icons/react
- Mediabunny y su extensión ProRes: MPL-2.0 — https://github.com/Vanilagy/mediabunny
- fflate: MIT — https://github.com/101arrowz/fflate
- Wrapper `@ffmpeg/ffmpeg`: MIT — https://github.com/ffmpegwasm/ffmpeg.wasm
- Núcleo `@ffmpeg/core`: GPL-2.0-or-later, con los componentes/configuración publicados por ffmpeg.wasm — https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core
- Playwright (solo desarrollo/pruebas): Apache-2.0 — https://github.com/microsoft/playwright

Los binarios FFmpeg locales copiados a `public/ffmpeg/` forman parte de la distribución de la app compilada; sus licencias y obligaciones de distribución deben conservarse al distribuir ese núcleo. El código fuente/build del núcleo está en el proyecto ffmpeg.wasm y sus submódulos.

## Phosphor Icons — MIT License

MIT License

Copyright (c) 2020 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Radix UI Select — MIT License

MIT License

Copyright (c) 2022 WorkOS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

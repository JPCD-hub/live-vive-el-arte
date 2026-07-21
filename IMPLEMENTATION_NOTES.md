# Live! Vive el Arte: Notas de implementación

## Diagnóstico real

La presentación defectuosa no era un problema de Firebase, Firestore ni de los tokens. El diagnóstico encontró cuatro causas visuales y de despliegue:

- Las posiciones anteriores de las estampas no correspondían a los centros reales de las imágenes. La boleta regular se documentó erróneamente como `1080×1440`, pero el archivo real mide `1086×1448`.
- `app.js` y `public.js` mantenían dos implementaciones de marcado y actualización de boleta. El enlace público no contenía acciones ni barra de progreso.
- La cortesía y la regular compartían parcialmente reglas internas aunque sus ilustraciones tienen orientaciones distintas.
- El service worker cacheaba recursos por versión; los recursos `v=5` podían seguir siendo atendidos por un worker previo hasta recibir rutas nuevas.

No se modificaron Firebase Authentication, Firestore Rules, colecciones, tokens, asistencia, beneficios ni generación de enlaces.

## Método de despliegue confirmado

GitHub Pages se consultó mediante `gh api repos/JPCD-hub/live-vive-el-arte/pages`:

- Repositorio: `JPCD-hub/live-vive-el-arte`.
- Rama publicada: `main`.
- Directorio publicado: `/` (raíz).
- Tipo de build: `legacy` de GitHub Pages.
- URL: `https://jpcd-hub.github.io/live-vive-el-arte/`.

No existen `.github/workflows`, `docs/`, `dist/`, `build/`, rama `gh-pages` ni otro `service-worker.js`. El único worker publicado es `sw.js` en la raíz.

## Archivos cargados en producción

La página pública carga:

- `styles.css?v=6`
- `public.css?v=6`
- `public.js?v=6`
- `ticket.js?v=6` como import ES module de `public.js`

La administración carga:

- `../styles.css?v=6`
- `../app.js?v=6`
- `../ticket.js?v=6` como import ES module de `app.js`

`styles.css` es la única fuente de estilos internos de la boleta. `public.css` contiene exclusivamente la portada, encabezado, contenedor exterior de enlace público, espaciado y footer.

## Dimensiones de imágenes

Las dimensiones se midieron programáticamente mediante `System.Drawing.Image.FromFile`:

| Archivo | Dimensiones naturales | Relación | Orientación |
| --- | --- | --- | --- |
| `Boleta 2.jpeg` | 1086×1448 | 3:4 | Vertical, regular |
| `boleta 1.jpeg` | 1536×1024 | 3:2 | Horizontal, cortesía |

Las imágenes conservan su proporción con `width: 100%`, `max-width: 100%`, `height: auto` y `object-fit: contain`. No se usa `cover`, alturas fijas, `vh` para su ancho ni recortes en el componente de boleta.

## Coordenadas y máscaras finales

`ticket.js` contiene la única constante `TICKET_STAMP_LAYOUTS`. Los centros se midieron sobre los píxeles marrones de los granos impresos y se normalizaron con `center / naturalDimension * 100`.

### Regular: `Boleta 2.jpeg`

| Visita | Centro px | Coordenada % | Zona | Máscara | Grano |
| --- | --- | --- | --- | --- | --- |
| 1 | 568.76, 845.11 | 52.37, 58.36 | 16% | 54% | 29% × 40% |
| 2 | 763.49, 845.18 | 70.30, 58.37 | 16% | 54% | 29% × 40% |
| 3 | 954.17, 845.22 | 87.86, 58.37 | 16% | 54% | 29% × 40% |
| 4 | 567.57, 1060.51 | 52.26, 73.24 | 16% | 54% | 29% × 40% |
| 5 | 762.85, 1060.10 | 70.24, 73.21 | 16% | 54% | 29% × 40% |

### Cortesía: `boleta 1.jpeg`

| Visita | Centro px | Coordenada % | Zona | Máscara | Grano |
| --- | --- | --- | --- | --- | --- |
| 1 | 919.78, 623.63 | 59.88, 60.90 | 12% | 56% | 30% × 41% |
| 2 | 1134.11, 622.63 | 73.84, 60.80 | 12% | 56% | 30% × 41% |
| 3 | 1346.78, 622.55 | 87.68, 60.80 | 12% | 56% | 30% × 41% |

Cada marcador recibe solamente estas propiedades CSS desde JavaScript: `--stamp-x`, `--stamp-y`, `--stamp-zone-size`, `--stamp-mask-size`, `--bean-width`, `--bean-height` y `--bean-rotation`. No hay coordenadas CSS, clases `.reference-stamp-1` a `.reference-stamp-5` ni variantes por media query.

La máscara `::before` y el grano activo `::after` usan el mismo centro (`left: 50%`, `top: 50%`, `translate(-50%, -50%)`). La máscara permanente usa `--ticket-cream`; el grano activo usa `--coffee-dark` y un gradiente CSS para su línea central.

## Boleta regular

- Escritorio: `.ticket-regular` usa `grid-template-columns: minmax(300px, 44%) minmax(0, 1fr)` y `align-items: start`.
- Móvil: cambia a una columna con `grid-template-columns: 1fr`.
- La información inicia arriba: tipo, nombre, código, visitas, barra, QR y beneficios.
- No tiene alturas fijas, `align-items: stretch`, `margin-top: auto` ni lógica que iguale artificialmente la altura de columnas.

## Boleta de cortesía

- `.ticket-courtesy` usa `display: block` en todos los tamaños.
- La imagen horizontal ocupa todo el ancho antes de los datos.
- En escritorio, `.ticket-courtesy .ticket-personal` es una grilla `minmax(0, 1fr) auto` para datos y QR.
- En móvil, los datos y QR vuelven a una columna.

## Modal administrativo

- `.ticket-modal`: `width: min(1050px, calc(100vw - 32px))`, `max-height: min(92dvh, 900px)`, scroll vertical interno y sin scroll horizontal.
- En móvil ocupa el viewport con `100dvh`.
- El botón de cierre usa `position: sticky` para permanecer disponible durante el scroll.
- Las acciones usan `flex-wrap`, `gap: 10px`, mínimo de 150px y altura mínima de 44px; en móvil ocupan la fila completa sin deformarse.

## Enlace público

- La sección directa usa `.public-ticket-container` con `width: min(1120px, calc(100% - 32px))`.
- Al abrir `?boleta=TOKEN`, el contenido principal no conserva la altura mínima de la portada, el encabezado se compacta y el footer sigue al contenido real.
- El enlace ahora incluye botones de compartir y copiar debajo del componente compartido.

## Tiempo real y QR

`onSnapshot()` continúa activo para la página pública y para los listeners administrativos existentes. Ambos usan la función compartida `updateTicketRealtimeState(container, ticket)` de `ticket.js`:

- Activa o desactiva las estampas.
- Actualiza texto, barra y contador de progreso.
- Conserva imagen, QR de ingreso, scroll y modal cuando solo cambian visitas.
- Indica al llamador si cambió la lista de beneficios; solo entonces se reemplazan los QR de beneficio.

El QR usa `.qr-container { flex: 0 0 auto }` y `.qr { width: clamp(112px, 14vw, 150px); aspect-ratio: 1 }`. Tras generar un QR se elimina el `img` fallback añadido después de `canvas`, evitando dos representaciones visibles.

## Modo de calibración

Agrega `?debugStamps=1` al enlace público o a `/admin/`:

- Contorno de `.ticket-art`.
- Nombre de layout.
- Tamaño natural y renderizado de la imagen.
- Cruz del centro de cada posición.
- Número y coordenadas normalizadas.
- Contorno verde de zona, cyan de máscara y magenta de grano activo.

No modifica Firestore ni datos de boleta.

## Caché y producción

- `sw.js` cache actual: `live-vive-el-arte-public-v11`.
- Al activarse elimina cualquier caché anterior con el mismo prefijo y ejecuta `clients.claim()`.
- Navegaciones: network-first con fallback a `index.html`.
- CSS y JavaScript: stale-while-revalidate; las URLs `v=6` evitan coincidencias con recursos previos.
- Las navegaciones con `?boleta=` no se cachean; Firestore, Firebase Auth, datos personales y rutas administrativas no se almacenan en el worker.

## Pruebas realizadas

- Sintaxis: `node --check ticket.js`, `node --check public.js`, `node --check app.js`.
- Producción antes del cambio: se comprobó que GitHub Pages responde `main/root` y sirve los recursos versionados.
- Medición programática de ambas imágenes y detección de centros basada en los píxeles marrones de los granos.
- Capturas headless de escritorio a 1366px con boleta regular y cortesía, incluyendo modo debug. Se verificó visualmente proporción, máscara, centro, QR cuadrado, acciones y layout horizontal de cortesía.
- Validación estática de las reglas móviles para 320, 360, 390, 430, 568, 800, 768 y 1024px; regular pasa a una columna bajo 820px y cortesía conserva `display: block`.

## Limitaciones reales

La consola no contiene credenciales de administrador ni un token público de boleta utilizable, por lo que no es posible desde este entorno ejecutar el flujo autenticado real de registro de asistencia ni una captura de Firestore de cada estado 0–5 / 0–3. La implementación mantiene esos listeners y se validó que los cambios de visita no reconstruyen el componente. Tras el despliegue se verifican los archivos `v=6` publicados antes de declarar producción actualizada.

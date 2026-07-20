# Live! Vive el Arte: Notas de implementación

## Arquitectura

- `index.html`, `public.css` y `public.js` forman la portada pública y la consulta de boletas mediante `?boleta=<token>`.
- `admin/index.html` es la consola privada. Carga `../app.js` y mantiene autenticación, personas, eventos, ingresos, beneficios y lector QR.
- `app.js` carga `qrcodejs` al abrir una boleta y `html5-qrcode` únicamente al solicitar la cámara.
- `manifest.webmanifest` y `sw.js` convierten la portada en una PWA básica. El worker solo cachea archivos estáticos públicos; nunca respuestas de Firestore ni enlaces de boletas.

## Sistema de posiciones de granos (stamps)

Las coordenadas de los granos de café se definen en un único objeto JavaScript `TICKET_STAMP_LAYOUTS` presente tanto en `public.js` como en `app.js`. Cada entrada contiene el centro del círculo como porcentaje del ancho y alto de la imagen:

```js
const TICKET_STAMP_LAYOUTS = {
  regular: [
    { x: 49, y: 55, size: 15 },  // Fila 1, círculo 1
    { x: 61, y: 55, size: 15 },  // Fila 1, círculo 2
    { x: 73, y: 55, size: 15 },  // Fila 1, círculo 3
    { x: 49, y: 67, size: 15 },  // Fila 2, círculo 1
    { x: 61, y: 67, size: 15 },  // Fila 2, círculo 2
  ],
  courtesy: [
    { x: 60, y: 55, size: 11 },  // Círculo 1
    { x: 72, y: 55, size: 11 },  // Círculo 2
    { x: 83, y: 55, size: 11 },  // Círculo 3
  ],
};
```

### Imágenes de boleta

- **Regular**: `Boleta 2.jpeg` — 1080×1440 (retrato, 3:4).
- **Cortesía**: `boleta 1.jpeg` — 1536×1024 (paisaje, 3:2).

### Cómo se calcularon

Las posiciones se midieron inspeccionando las imágenes `Boleta 2.jpeg` (1080×1440, retrato) y `boleta 1.jpeg` (1536×1024, paisaje). Se identificaron los centros de los círculos impresos en cada imagen y se convirtieron a porcentajes del ancho/alto total.

### Cómo ajustar un marcador en el futuro

1. Activa el modo debug: `?debugStamps=1` (funciona tanto en la boleta pública como en el admin).
2. Observa los bordes verdes y los números de índice sobre cada marcador.
3. Ajusta los valores `x`, `y` y `size` en `TICKET_STAMP_LAYOUTS` en `public.js` y `app.js`.
4. Los cambios se aplican sin recargar la página en la boleta pública (usa `onSnapshot`).

### Estructura CSS

Los marcadores usan propiedades CSS personalizadas inline:
```html
<span class="reference-stamp active"
  style="--stamp-x: 49%; --stamp-y: 55%; --stamp-size: 15%;"
  aria-label="Visita 1 registrada"
  data-stamp-index="0"></span>
```

```css
.reference-stamp {
  position: absolute;
  left: var(--stamp-x);
  top: var(--stamp-y);
  width: var(--stamp-size);
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
}
```

## Modo calibración (`?debugStamps=1`)

Agrega `?debugStamps=1` a la URL de la boleta pública o del admin para:

- Ver borde rojo en `.ticket-art`.
- Ver bordes verdes en cada marcador.
- Ver el índice del marcador y sus coordenadas.
- Identificar si algún marcador está desplazado.

Este modo es únicamente visual y no modifica Firestore.

## Actualización en tiempo real

### Boleta pública

La boleta pública usa `onSnapshot()` sobre el documento del ticket en Firestore. Se implementan funciones separadas:

- `updateTicketStamps()` — activa/desactiva granos sin reconstruir el HTML.
- `updateTicketVisitText()` — actualiza el texto de progreso.
- `updateTicketBenefits()` — solo regenera QR de beneficios si la lista de tokens cambió.
- `updatePublicTicketRealtime()` — orquesta las actualizaciones incrementales.

Cuando solo cambia `visits`: no se reconstruye la boleta, no se reemplaza la imagen, no se regenera el QR de ingreso.

### Modal administrativo

Cuando el listener de `tickets` recibe nuevos datos, `refreshDisplayedTicketFromState()` verifica si hay una boleta abierta y actualiza:

- Los granos (sin reconstruir el HTML).
- El texto de visitas.
- Anuncia el cambio a usuarios de lectores de pantalla mediante `aria-live`.

### Evitar regeneración de QR

Los QR solo se regeneran cuando cambia:
- El token de la boleta.
- La lista de beneficios (comparada por tokens).

## Cómo probar con dos dispositivos

1. Abre `/admin/` en el computador (ventana A).
2. Abre `/?boleta=TOKEN` en el celular (ventana B).
3. Registra un ingreso desde la ventana A.
4. Verifica que el nuevo grano aparece en ambas ventanas sin recargar.
5. Verifica que el QR no parpadea.
6. Verifica que el modal administrativo permanece abierto.

## Configuración pública

Edita `PUBLIC_CONFIG` en `public.js` para añadir solo canales públicos verificados:

```js
const PUBLIC_CONFIG = {
  address: '',
  whatsappUrl: '',
  instagramUrl: '',
  mapsUrl: '',
};
```

Los botones se ocultan mientras su valor esté vacío. No se incluyen números, direcciones ni cuentas inventadas.

La imagen social está en `assets/social-live.svg`. El icono PWA y favicon están en `assets/icon.svg`.

## Eventos públicos

La portada lee la colección `events`, que contiene información pública de programación:

- `name` y `date` son obligatorios.
- `description`, `time`, `location` e `imageUrl` son opcionales.
- `status` puede ser `published`, `draft` o `cancelled`. Solo `published` puede leerse desde la portada.
- Los eventos pasados no aparecen en la agenda pública.
- Al iniciar la consola con una cuenta administradora, los eventos heredados sin `status` se migran a `published`.

## Edición de personas

Desde la lista de comunidad, selecciona **Editar**. Se pueden actualizar nombre, correo, teléfono y nota. El tipo de boleta se mantiene. Si cambia el nombre, también se actualiza el nombre visible en su boleta pública.

## Regenerar una boleta

1. Entra a `admin/` con una cuenta autorizada.
2. En la persona correspondiente selecciona **Regenerar enlace** o abre la boleta y selecciona **Regenerar boleta**.
3. Confirma la acción.
4. Copia o comparte el nuevo enlace.

La regeneración crea un token nuevo, invalida la URL anterior, conserva las visitas y rota los QR de beneficios aún disponibles. Se limita a 12 beneficios por persona desde el navegador.

## Beneficios

La regla actual es cinco asistencias por ciclo para boleta regular. El beneficio se genera para el siguiente evento disponible. El QR rojo registra el uso del beneficio. Las cortesías tienen 3 ingresos sin beneficios.

## Lector QR

El lector se carga al pulsar **Escanear QR**. Requiere HTTPS y permiso de cámara. Si la cámara no está disponible, usa **Código o enlace de boleta** en el ingreso manual.

La cámara se detiene al pulsar detener, ocultar la pestaña, abandonar la página o cerrar sesión.

## Firebase y privacidad

- `people`, `checkins`, `benefits` y `tickets` requieren una cuenta cuyo UID exista en `admins/<uid>`.
- Las boletas públicas se consultan solo por un token aleatorio de 43 caracteres.
- Configura Firebase App Check, alertas de presupuesto y dominios autorizados antes de un evento grande.

## Despliegue

GitHub Pages sirve la rama `main` desde la raíz. Todas las rutas usan enlaces relativos bajo `https://jpcd-hub.github.io/live-vive-el-arte/`.

Publica las reglas con:

```powershell
firebase deploy --only firestore:rules --project ticket-service-c2eac
```

Al cambiar recursos cacheados, incrementa `CACHE` y el listado `SHELL` en `sw.js`; incrementa los parámetros de versión de `public.css`, `public.js`, `styles.css` o `app.js` cuando corresponda.

## Versión actual

- `sw.js` cache: `v9`
- `styles.css`: `v35`
- `public.css`: `v11`
- `public.js`: `v6`
- `app.js`: `v17`

## Arquitectura CSS unificada

`styles.css` es la fuente única de verdad para el componente de boleta (`.ticket`, `.ticket-art`, `.reference-stamp`, `.ticket-personal`, `.ticket-codes`, `.qr`, etc.). `public.css` solo contiene estilos de layout de la página pública (`.ticket-page`, `.ticket-access`, etc.). `index.html` carga ambos: `styles.css` primero, `public.css` después.

## Archivos modificados

- `app.js` — Layout unificado, actualización en tiempo real del modal, modo debug, accesibilidad.
- `public.js` — Layout unificado usando clases admin (`.ticket`, `.reference-stamp`, `.ticket-personal`), actualización incremental sin reconstrucción completa, modo debug.
- `public.css` — Solo layout de página pública; componentes de boleta removidos (ahora están en `styles.css`).
- `styles.css` — Fuente única de verdad para componente de boleta; grid regular sin `45vh`, modal ampliado a 1040px, botones con `flex-wrap`, cortesía con imagen full-width.
- `admin/index.html` — Región `aria-live`, versión actualizada.
- `index.html` — Carga `styles.css?v=35` antes de `public.css?v=11`.
- `sw.js` — Cache incrementado a v9 con stale-while-revalidate para CSS/JS.
- `IMPLEMENTATION_NOTES.md` — Esta documentación.

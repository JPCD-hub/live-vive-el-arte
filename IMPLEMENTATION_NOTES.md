# Live! Vive el Arte: Notas de implementación

## Arquitectura

- `index.html`, `public.css` y `public.js` forman la portada pública y la consulta de boletas mediante `?boleta=<token>`.
- `admin/index.html` es la consola privada. Carga `../app.js` y mantiene autenticación, personas, eventos, ingresos, beneficios y lector QR.
- `app.js` carga `qrcodejs` al abrir una boleta y `html5-qrcode` únicamente al solicitar la cámara.
- `manifest.webmanifest` y `sw.js` convierten la portada en una PWA básica. El worker solo cachea archivos estáticos públicos; nunca respuestas de Firestore ni enlaces de boletas.

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

La imagen social está en `assets/social-live.svg`. El icono PWA y favicon están en `assets/icon.svg`. Puedes reemplazarlos por versiones PNG equivalentes si necesitas máxima compatibilidad con instaladores antiguos.

## Eventos públicos

La portada lee la colección `events`, que ahora solo contiene información pública de programación. Los campos existentes siguen funcionando:

- `name` y `date` son obligatorios.
- `description`, `time` y `location` son opcionales.
- `createdAt` se conserva; `updatedAt` se agrega al editar.

Los eventos pasados no aparecen en la agenda pública. No guardes información privada en documentos de `events`.

## Regenerar una boleta

1. Entra a `admin/` con una cuenta autorizada.
2. En la persona correspondiente selecciona **Regenerar enlace** o abre la boleta y selecciona **Regenerar boleta**.
3. Confirma la acción.
4. Copia o comparte el nuevo enlace.

La regeneración crea un token nuevo, invalida la URL anterior, conserva las visitas y rota los QR de beneficios aún disponibles. Para mantener las transacciones seguras desde el navegador, se limita a 12 beneficios por persona; un historial excepcionalmente grande requiere una función de administración en servidor.

## Beneficios

La regla actual para una boleta regular es cinco asistencias por ciclo. El beneficio se genera para el siguiente evento disponible. El QR rojo registra el uso del beneficio para impedir un segundo acceso en ese evento, pero no incrementa el progreso de fidelización.

## Lector QR

El lector se carga al pulsar **Escanear QR**. Requiere HTTPS y permiso de cámara. Si la cámara está bloqueada o no existe, usa **Código o enlace de boleta** en el ingreso manual; admite el enlace personal, el token completo o el contenido JSON del QR.

La cámara se detiene al pulsar detener, ocultar la pestaña, abandonar la página o cerrar sesión.

## Firebase y privacidad

- `people`, `checkins`, `benefits` y `tickets` administrativos requieren una cuenta cuyo UID exista en `admins/<uid>`.
- Las boletas públicas se consultan solo por un token aleatorio de 43 caracteres; no se pueden listar públicamente.
- El enlace de boleta es una credencial personal. Evita compartirlo.
- Después de esta versión, los administradores deben borrar los datos del sitio en navegadores usados anteriormente si quieren retirar la caché privada de Firestore creada por versiones previas.
- Configura Firebase App Check, alertas de presupuesto y dominios autorizados antes de un evento grande.

## Despliegue

GitHub Pages sirve la rama `main` desde la raíz. Todas las rutas usan enlaces relativos para funcionar bajo `https://jpcd-hub.github.io/live-vive-el-arte/`.

Publica las reglas con:

```powershell
firebase deploy --only firestore:rules --project ticket-service-c2eac
```

Al cambiar recursos cacheados, incrementa `CACHE` y el listado `SHELL` en `sw.js`; también incrementa los parámetros de versión de `public.css`, `public.js`, `styles.css` o `app.js` cuando corresponda.

## Diagnóstico

- Revisa los errores técnicos en la consola del navegador; la interfaz muestra mensajes comprensibles sin exponer detalles internos.
- Verifica Firebase Console para errores de autenticación, Firestore y App Check.
- Si una boleta no abre, confirma que el enlace tenga `?boleta=` seguido de 43 caracteres y que el token no haya sido regenerado.
- Si la portada no muestra eventos, comprueba que los documentos tengan fecha `YYYY-MM-DD` y que las reglas de Firestore estén desplegadas.

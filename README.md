# Live! Vive el Arte

Aplicación web para administrar boletas virtuales, QR y asistencias en tiempo real durante los eventos de Live! Vive el Arte.

La portada pública está en `./`; la administración protegida está en `./admin/`. Consulta `IMPLEMENTATION_NOTES.md` para la arquitectura, PWA, variables públicas y procedimientos operativos.

## Operación En El Evento

1. Abre la aplicación mediante HTTPS y entra con una cuenta administradora autorizada.
2. Confirma que la puerta muestre `Datos sincronizados` antes de registrar ingresos.
3. Selecciona explícitamente el evento activo. La aplicación no selecciona eventos automáticamente para evitar registros en fechas equivocadas.
4. Escanea el QR de ingreso o selecciona la persona para un ingreso manual. Cada persona solo puede tener un registro por evento.
5. El QR rojo canjea un beneficio. Se registra su uso para impedir un segundo acceso en el mismo evento, pero no suma visitas ni marca un grano de café en el siguiente ciclo.
6. Si la aplicación indica que está sin conexión o sincronizando, no registres ingresos: usa una lista manual temporal y regístralos cuando vuelva la conexión.

## Preparación Antes De Abrir Puertas

1. Crea el evento con fecha correcta y verifica que aparece en el selector.
2. Prueba un QR regular, un QR de cortesía, un QR de beneficio y un registro manual desde dos teléfonos.
3. Permite el acceso a la cámara del navegador del dispositivo de puerta.
4. Lleva un segundo teléfono o computador administrador y una conexión de respaldo.
5. No abras la consola en navegadores incrustados de WhatsApp o Instagram; usa Chrome, Safari o Firefox directamente.

## Administración Y Seguridad

1. Habilita **Email/Password** en Firebase Authentication.
2. Crea las cuentas administrativas desde **Authentication > Users > Add user** en Firebase Console. La aplicación no permite registrar cuentas nuevas.
3. Crea manualmente `admins/<UID>` en Firestore para cada cuenta autorizada, por ejemplo con `{ "role": "admin" }`.
4. Añade el dominio de GitHub Pages en **Authentication > Settings > Authorized domains**.
5. Configura Firebase App Check para el proyecto y activa presupuestos y alertas de Firestore antes de operar a gran escala.

## Despliegue

GitHub Pages publica la rama `main` desde `/(root)`. Las reglas de Firestore se despliegan por separado:

```powershell
firebase deploy --only firestore:rules --project ticket-service-c2eac
```

El archivo `.firebaserc` ya fija `ticket-service-c2eac` como proyecto predeterminado. Verifica el resultado del despliegue en Firebase Console antes del evento.

## Límites Operativos

- Los ingresos requieren conexión para preservar la prevención de duplicados. La caché local sirve para mostrar información, no para confirmar ingresos offline.
- Una boleta compartida por WhatsApp es un enlace personal reutilizable. El equipo de puerta debe verificar el nombre de la persona cuando sea necesario.
- Los administradores tienen capacidad de eliminar personas, eventos y datos asociados. Restringe el acceso a cuentas de confianza.

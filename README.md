# Live! Vive el Arte

Aplicacion estatica para administrar la comunidad, generar boletas virtuales con QR y registrar asistencias para el programa de cinco visitas.

## Uso

1. Abre `index.html` en un navegador o publica estos archivos con GitHub Pages.
2. Crea eventos y registra personas desde la seccion correspondiente.
3. Abre la boleta de cada persona y usa **Enviar por WhatsApp** para compartir su enlace y codigo QR.
4. En la puerta, selecciona el evento y escanea el QR o registra el ingreso manualmente.
5. Exporta un respaldo JSON con frecuencia. Puede importarse desde la misma seccion.

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub y sube `index.html`, `styles.css`, `app.js` y `README.md`.
2. En el repositorio abre **Settings > Pages**.
3. En **Build and deployment**, selecciona **Deploy from a branch**, la rama `main` y la carpeta `/(root)`.
4. Guarda. GitHub mostrara la URL publica tras el despliegue.

## Nota sobre los datos

Esta primera version guarda la base de datos en `localStorage`: permanece en el navegador y dispositivo donde se usa, pero no se comparte automaticamente entre equipos. GitHub Pages solo hospeda archivos estaticos. La boleta enviada por WhatsApp puede abrirse desde cualquier celular, pero el registro de nuevos ingresos debe hacerse desde el equipo que contiene la base. Para que varias personas puedan consultar y registrar la misma base en tiempo real, el siguiente paso es conectar Firebase, Supabase u otro servicio de base de datos.

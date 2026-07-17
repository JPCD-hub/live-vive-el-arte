# Live! Vive el Arte

Aplicación estática con Firebase para administrar la comunidad, generar boletas virtuales con QR y registrar asistencias en tiempo real.

## Uso

1. Configura Firebase siguiendo la sección siguiente y publica la app en un host HTTPS.
2. Inicia sesión con Google. Solo una cuenta cuyo UID exista en `admins/{uid}` verá la administración.
3. Crea eventos y registra personas. Cada boleta recibe un token aleatorio y se puede compartir por WhatsApp.
4. En la puerta, selecciona el evento y escanea el QR o registra el ingreso manualmente.
5. Las boletas compartidas usan `?boleta=<token>` y reciben sus asistencias y beneficios en tiempo real.

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub y sube `index.html`, `styles.css`, `app.js` y `README.md`.
2. En el repositorio abre **Settings > Pages**.
3. En **Build and deployment**, selecciona **Deploy from a branch**, la rama `main` y la carpeta `/(root)`.
4. Guarda. GitHub mostrara la URL publica tras el despliegue.

## Configuración de Firebase

1. En Firebase Console crea la base de datos **Cloud Firestore** en modo producción.
2. En **Authentication > Sign-in method**, habilita Google y añade los dominios donde se hospeda la app en **Authorized domains**.
3. Inicia sesión una vez con la cuenta que será administradora y copia su UID desde Authentication.
4. Crea manualmente `admins/<UID>` en Firestore con cualquier campo, por ejemplo `{ "role": "admin" }`. La app no puede crear administradores.
5. Instala Firebase CLI y publica las reglas incluidas con `firebase deploy --only firestore:rules` cuando estés listo. No uses reglas de prueba.

## Datos y seguridad

Los datos operativos (`people`, `events`, `checkins` y `benefits`) solo pueden ser leídos o modificados por administradores autenticados. `tickets/{token}` contiene únicamente el nombre, tipo, total de visitas y beneficios vigentes necesarios para mostrar una boleta; no expone correo, teléfono, notas ni identificadores de persona. Las reglas permiten consultar un ticket por token, pero nunca listar tickets públicamente.

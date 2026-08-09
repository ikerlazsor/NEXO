# Push notifications (Nexo)

## 1. SQL en Supabase
Ejecuta `supabase/push-notifications.sql` en el SQL Editor (incluye tokens, prefs por categoría y `push_chat_mutes`).

## 2. Edge Function
```bash
npx supabase functions deploy send-push
```
(o súbela desde el dashboard). No hace falta secreto extra: usa la service role de Supabase.

## 3. EAS projectId
```bash
npx eas-cli login
npx eas init
```
Sustituye `REPLACE_WITH_EAS_PROJECT_ID` en `app.json` → `extra.eas.projectId` por el ID que te dé EAS.
También puedes poner `EXPO_PUBLIC_EAS_PROJECT_ID` en `.env`.

## 4. Build nativo (obligatorio)
Las push **no funcionan en Expo Go** de forma fiable. Necesitas un APK/IPA:
```bash
npx eas build -p android --profile preview
```
Para Android en producción hace falta configurar FCM en EAS (credenciales de Firebase). En builds preview suele bastar con las de Expo.

## 5. Comportamiento
- **Canales Android:** `messages`, `social`, `reminders` (el usuario puede silenciar por tipo en el sistema).
- **Silenciar chat:** se sincroniza a `push_chat_mutes` → no llega push con la app cerrada.
- **Prefs:** global + mensajes / social / recordatorios en Ajustes.
- **Badge:** chats no leídos + solicitudes/invites/valoraciones pendientes.
- **Foreground:** no muestra banner si ya estás en ese chat.

## 6. Probar
1. Instala el APK en dos móviles.
2. Acepta el permiso de notificaciones.
3. Envía solicitud de amistad / mensaje / etc. desde una cuenta a la otra (app en segundo plano).
4. Silencia un chat de plan y verifica que no llega push al otro dispositivo.

-- Limpia cuentas que quedaron a medias (registro_completado = false).
-- Útil para restos antiguos. Con el nuevo flujo ya no se crea Auth hasta terminar.
DELETE FROM auth.users
WHERE id IN (
    SELECT p.id
    FROM public.perfiles p
    WHERE COALESCE(p.registro_completado, false) = false
)
AND created_at < now() - interval '24 hours';

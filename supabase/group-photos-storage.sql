-- Fotos de grupos (bucket avatars, carpeta groups/)
-- Ejecutar si falla la subida de foto de grupo

DROP POLICY IF EXISTS "avatars_groups_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_groups_update" ON storage.objects;

CREATE POLICY "avatars_groups_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'groups'
);

CREATE POLICY "avatars_groups_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = 'groups'
);

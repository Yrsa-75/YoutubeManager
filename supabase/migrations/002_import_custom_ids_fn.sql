-- Moteur d'import ID Perso (brique 2).
-- Appliqué en base le 2026-07-01. Ce fichier est le miroir versionné.
--
-- Reçoit un tableau JSON de paires {youtube_id, custom_id}.
--   do_commit = false -> aperçu : compte seulement, n'écrit rien.
--   do_commit = true  -> applique la mise à jour.
-- Non destructif : ne touche que les vidéos présentes en base ; ignore le reste.
-- Garde-fous : une ligne sans custom_id n'efface jamais une valeur existante ;
--              on ne réécrit pas une vidéo qui a déjà la bonne valeur.
CREATE OR REPLACE FUNCTION public.import_custom_ids(pairs jsonb, do_commit boolean DEFAULT false)
RETURNS TABLE(matched bigint, ignored bigint, updated bigint)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_matched bigint := 0;
  v_ignored bigint := 0;
  v_updated bigint := 0;
BEGIN
  -- Aperçu : lignes du fichier présentes en base vs hors base
  SELECT
    count(*) FILTER (WHERE vid.youtube_id IS NOT NULL),
    count(*) FILTER (WHERE vid.youtube_id IS NULL)
  INTO v_matched, v_ignored
  FROM jsonb_to_recordset(pairs) AS p(youtube_id text, custom_id text)
  LEFT JOIN public.videos vid ON vid.youtube_id = p.youtube_id
  WHERE p.youtube_id IS NOT NULL AND p.youtube_id <> '';

  IF do_commit THEN
    WITH dedup AS (
      SELECT DISTINCT ON (p.youtube_id) p.youtube_id, p.custom_id
      FROM jsonb_to_recordset(pairs) AS p(youtube_id text, custom_id text)
      WHERE p.youtube_id IS NOT NULL AND p.youtube_id <> ''
        AND p.custom_id IS NOT NULL AND p.custom_id <> ''
      ORDER BY p.youtube_id
    )
    UPDATE public.videos v
    SET custom_id = d.custom_id
    FROM dedup d
    WHERE v.youtube_id = d.youtube_id
      AND v.custom_id IS DISTINCT FROM d.custom_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_matched, v_ignored, v_updated;
END $$;

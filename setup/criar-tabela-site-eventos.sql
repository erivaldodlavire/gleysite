-- Rode isso no SQL Editor do Supabase, no schema DE TESTE primeiro (gleyciane_teste)
-- Depois de validar, rode de novo trocando para o schema real (gleyciane)

DO $$
DECLARE
    v_schema TEXT := 'gleyciane_teste';  -- troque para 'gleyciane' quando for para produção
BEGIN
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.site_eventos (
            id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            evento      text NOT NULL,
            texto_botao text,
            destino     text,
            pagina_url  text,
            created_at  timestamptz DEFAULT now()
        );
    ', v_schema);

    EXECUTE format('ALTER TABLE %I.site_eventos ENABLE ROW LEVEL SECURITY', v_schema);

    EXECUTE format('
        CREATE POLICY "eventos_insercao_publica" ON %I.site_eventos
        FOR INSERT TO anon, authenticated WITH CHECK (true);
    ', v_schema);

    EXECUTE format('
        CREATE POLICY "eventos_leitura_admin" ON %I.site_eventos
        FOR ALL TO authenticated
        USING (true) WITH CHECK (true);
    ', v_schema);
END $$;

GRANT ALL ON gleyciane_teste.site_eventos TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA gleyciane_teste TO anon, authenticated, service_role;

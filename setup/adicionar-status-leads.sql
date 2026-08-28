-- Rode primeiro no schema de TESTE (gleyciane_teste), depois em produção (gleyciane)

ALTER TABLE gleyciane_teste.site_leads
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'novo';

-- Valores esperados no código: 'novo' (vermelho), 'andamento' (amarelo), 'concluido' (verde)
-- Não precisa de nova política de segurança: a policy "leads_leitura_admin_..." já
-- criada pelo create_client_schema() usa "FOR ALL", que já cobre UPDATE.

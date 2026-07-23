/* ============================================================================
 * AUTH.JS — Módulo de Segurança e Autenticação (Supabase Auth)
 * ============================================================================
 * Responsabilidades:
 *   1. Login com e-mail/senha (sessão JWT gerenciada pelo Supabase — nada de
 *      senha em localStorage como na versão antiga).
 *   2. Primeiro acesso: detecta a flag `must_change_password` no metadata do
 *      usuário e FORÇA a troca da senha padrão antes de liberar o painel.
 *   3. Recuperação de senha: fluxo por código OTP de 6 dígitos enviado ao
 *      e-mail (ou SMS, se o provedor de telefonia estiver configurado).
 *   4. Guarda de página: `Auth.protegerPagina()` deve ser a PRIMEIRA coisa
 *      executada no admin.html — sem sessão válida, redireciona pro login.
 *   5. Logout global.
 *
 * Dependências (carregar ANTES deste arquivo):
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="js/supabase-config.js"></script>
 *
 * Padrão de retorno: todas as funções assíncronas retornam
 *   { ok: boolean, erro?: string, ...dadosExtras }
 * para que a camada de UI nunca precise de try/catch próprio.
 * ========================================================================== */

window.Auth = (() => {
    'use strict';

    // ------------------------------------------------------------------ //
    // CLIENTE SUPABASE (singleton)
    // ------------------------------------------------------------------ //
    // 🔒 CRÍTICO: o schema precisa vir daqui, senão o Supabase usa o
    // padrão "public" — e TODOS os clientes (Gleyciane, Erivaldo, etc.)
    // acabariam lendo/escrevendo na MESMA tabela public.site_config.
    // Isso é exatamente o que causava o vazamento entre os sites.
    const cfg = window.SUPABASE_CONFIG;
    const schemaCliente = cfg.cliente.schema;

    if (!schemaCliente || schemaCliente.trim() === '') {
        throw new Error('❌ [Auth] schema do cliente não definido em SUPABASE_CONFIG. Abortando para evitar vazamento entre tenants.');
    }

    const client = supabase.createClient(cfg.url, cfg.anonKey, {
        auth: {
            persistSession: true,       // mantém sessão entre abas/reloads
            autoRefreshToken: true,     // renova o JWT automaticamente
            detectSessionInUrl: true,   // captura tokens de links de recuperação
        },
        db: {
            schema: schemaCliente,      // 🔒 força TODAS as queries deste cliente
                                         //    para o schema isolado (ex: "erivaldo")
        },
    });

    console.log(`🔒 [Auth] Cliente Supabase isolado no schema: "${schemaCliente}"`);

    // Tradução amigável dos erros mais comuns do Supabase Auth
    const MAPA_ERROS = {
        'Invalid login credentials': 'E-mail ou senha incorretos.',
        'Email not confirmed': 'E-mail ainda não confirmado. Verifique sua caixa de entrada.',
        'Token has expired or is invalid': 'Código expirado ou inválido. Solicite um novo.',
        'New password should be different from the old password.': 'A nova senha precisa ser diferente da anterior.',
        'Password should be at least 6 characters.': 'A senha precisa ter no mínimo 6 caracteres.',
        'For security purposes, you can only request this once every 60 seconds': 'Aguarde 60 segundos antes de solicitar um novo código.',
    };
    const traduzErro = (e) => MAPA_ERROS[e?.message] || e?.message || 'Erro inesperado. Tente novamente.';

    // ------------------------------------------------------------------ //
    // POLÍTICA DE SENHA (validação client-side; o Supabase revalida no server)
    // ------------------------------------------------------------------ //
    function validarForcaSenha(senha) {
        if (!senha || senha.length < 8)       return { ok: false, erro: 'Mínimo de 8 caracteres.' };
        if (!/[A-Za-z]/.test(senha))          return { ok: false, erro: 'Inclua ao menos uma letra.' };
        if (!/[0-9]/.test(senha))             return { ok: false, erro: 'Inclua ao menos um número.' };
        if (senha === '123456' || /^(.)\1+$/.test(senha)) return { ok: false, erro: 'Senha muito fraca.' };
        return { ok: true };
    }

    // ------------------------------------------------------------------ //
    // 1) LOGIN
    // ------------------------------------------------------------------ //
    async function login(email, senha) {
        const { data, error } = await client.auth.signInWithPassword({ email, password: senha });
        if (error) return { ok: false, erro: traduzErro(error) };

        // Flag gravada no metadata do usuário na criação (ver 01_auth_setup.sql):
        // enquanto true, o painel exige troca da senha padrão de fábrica.
        const precisaTrocarSenha = data.user?.user_metadata?.must_change_password === true;
        return { ok: true, precisaTrocarSenha, usuario: data.user };
    }

    // ------------------------------------------------------------------ //
    // 2) PRIMEIRO ACESSO — troca obrigatória da senha padrão
    // ------------------------------------------------------------------ //
    async function trocarSenhaPrimeiroAcesso(novaSenha) {
        const forca = validarForcaSenha(novaSenha);
        if (!forca.ok) return forca;

        const { error } = await client.auth.updateUser({
            password: novaSenha,
            data: { must_change_password: false },  // desarma a flag
        });
        if (error) return { ok: false, erro: traduzErro(error) };
        return { ok: true };
    }

    // ------------------------------------------------------------------ //
    // 3) RECUPERAÇÃO DE SENHA VIA OTP (código de 6 dígitos)
    // ------------------------------------------------------------------ //
    // 3a. Envia o código. `destino` pode ser e-mail OU telefone (+55...).
    //     - E-mail: funciona nativamente. IMPORTANTE: no Dashboard →
    //       Authentication → Email Templates → "Magic Link", inclua a
    //       variável {{ .Token }} no corpo para o código de 6 dígitos aparecer.
    //     - SMS: exige provedor configurado (Twilio/MessageBird) em
    //       Authentication → Providers → Phone. A estrutura já está pronta.
    async function enviarOtp(destino) {
        const ehTelefone = /^\+?[0-9\s()-]{10,}$/.test(destino);
        const payload = ehTelefone
            ? { phone: destino.replace(/[\s()-]/g, '') }
            : { email: destino.trim().toLowerCase() };

        // shouldCreateUser:false → OTP só funciona para usuários já cadastrados
        // (impede que estranhos criem contas no painel do seu cliente).
        const { error } = await client.auth.signInWithOtp({
            ...payload,
            options: { shouldCreateUser: false },
        });
        if (error) return { ok: false, erro: traduzErro(error) };
        return { ok: true, canal: ehTelefone ? 'sms' : 'email', destino };
    }

    // 3b. Valida o código digitado. Se correto, o Supabase abre uma sessão
    //     temporária que autoriza a redefinição de senha logo em seguida.
    async function verificarOtp(destino, token) {
        const ehTelefone = /^\+?[0-9\s()-]{10,}$/.test(destino);
        const payload = ehTelefone
            ? { phone: destino.replace(/[\s()-]/g, ''), token, type: 'sms' }
            : { email: destino.trim().toLowerCase(), token, type: 'email' };

        const { data, error } = await client.auth.verifyOtp(payload);
        if (error) return { ok: false, erro: traduzErro(error) };
        return { ok: true, usuario: data.user };
    }

    // 3c. Redefine a senha (chamado após verificarOtp OU link de recuperação).
    async function redefinirSenha(novaSenha) {
        const forca = validarForcaSenha(novaSenha);
        if (!forca.ok) return forca;

        const { error } = await client.auth.updateUser({
            password: novaSenha,
            data: { must_change_password: false },
        });
        if (error) return { ok: false, erro: traduzErro(error) };
        return { ok: true };
    }

    // Alternativa clássica por LINK de e-mail (mantida para flexibilidade)
    async function enviarLinkRecuperacao(email) {
        const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: `${location.origin}/${cfg.rotas.login}?modo=recuperacao`,
        });
        if (error) return { ok: false, erro: traduzErro(error) };
        return { ok: true };
    }

    // ------------------------------------------------------------------ //
    // 4) GUARDA DE PÁGINA — proteger o admin.html
    // ------------------------------------------------------------------ //
    // Uso no topo do admin.js:  const user = await Auth.protegerPagina();
    // Sem sessão válida → redirect imediato pro login (com ?voltar= para UX).
    // Com sessão mas senha padrão ainda ativa → manda pro login trocar.
    async function protegerPagina() {
        const { data: { session } } = await client.auth.getSession();

        if (!session) {
            location.replace(`${cfg.rotas.login}?voltar=${encodeURIComponent(location.pathname)}`);
            return null;
        }
        if (session.user.user_metadata?.must_change_password === true) {
            location.replace(`${cfg.rotas.login}?modo=primeiro-acesso`);
            return null;
        }

        // Se a sessão morrer no meio do uso (logout em outra aba, token revogado),
        // expulsa do painel na hora — sem "zumbis" logados.
        client.auth.onAuthStateChange((evento) => {
            if (evento === 'SIGNED_OUT') location.replace(cfg.rotas.login);
        });

        return session.user;
    }

    // ------------------------------------------------------------------ //
    // 5) LOGOUT + utilidades
    // ------------------------------------------------------------------ //
    async function logout() {
        await client.auth.signOut();
        location.replace(cfg.rotas.login);
    }

    async function getUsuario() {
        const { data: { user } } = await client.auth.getUser();
        return user;
    }

    // Detecta chegada por link de recuperação (evento nativo do Supabase)
    function aoEntrarEmModoRecuperacao(callback) {
        client.auth.onAuthStateChange((evento) => {
            if (evento === 'PASSWORD_RECOVERY') callback();
        });
    }

    // ------------------------------------------------------------------ //
    // API PÚBLICA DO MÓDULO
    // ------------------------------------------------------------------ //
    return {
        client,                    // exposto para admin.js/app.js consultarem tabelas
        login,
        trocarSenhaPrimeiroAcesso,
        enviarOtp,
        verificarOtp,
        redefinirSenha,
        enviarLinkRecuperacao,
        protegerPagina,
        logout,
        getUsuario,
        validarForcaSenha,
        aoEntrarEmModoRecuperacao,
    };
})();

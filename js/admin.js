/* ============================================================================
 * ADMIN.JS — Cérebro do Painel Administrativo (Fase 2)
 * ============================================================================
 * Arquitetura em camadas:
 *   Auth (js/auth.js)          → sessão, guarda de página, senha
 *   ThemeEngine / AudioEngine  → motores compartilhados com o site
 *   Este arquivo               → estado da configuração + UI do painel
 *
 * Fluxo de dados (unidirecional, simples de depurar):
 *   Supabase → carregar() → `estado` → preencher UI
 *   UI (inputs/uploads/drag) → mutações no `estado`
 *   Botão "Salvar e Publicar" → coletarFormulario() → upsert no Supabase
 * ========================================================================== */

(async () => {
    'use strict';

    /* ==================================================================== */
    /* 0) GUARDA DE SEGURANÇA — nada roda sem sessão válida                 */
    /* ==================================================================== */
    const usuario = await Auth.protegerPagina();
    if (!usuario) return;                       // já foi redirecionado ao login
    document.body.classList.add('autenticado'); // revela o painel

    const db = Auth.client;
    const $ = (sel) => document.querySelector(sel);

    /* ==================================================================== */
    /* 1) CATÁLOGO DE SEÇÕES DO SITE (fonte da verdade do Layout Builder)   */
    /* ==================================================================== */
    // `id` casa com o id da <section> no index.html (Fase 3 lê esta ordem).
    const CATALOGO_SECOES = [
        { id: 'hero',         nome: 'Topo / Apresentação', icone: 'fa-star',        fixa: true },
        { id: 'sobre',        nome: 'Sobre Mim',           icone: 'fa-user' },
        { id: 'atuacao',      nome: 'Áreas de Atuação',    icone: 'fa-briefcase' },
        { id: 'depoimentos',  nome: 'Depoimentos',         icone: 'fa-star-half-stroke' },
        { id: 'nosso-espaco', nome: 'Nosso Espaço',        icone: 'fa-building' },
        { id: 'publicacoes',  nome: 'Publicações',         icone: 'fa-video' },
        { id: 'info-contato', nome: 'Informações de Contato', icone: 'fa-address-book' },
        { id: 'contato',      nome: 'Formulário de Contato',  icone: 'fa-envelope' },
    ];

    /* ==================================================================== */
    /* 2) ESTADO — espelho local do site_config                             */
    /* ==================================================================== */
    let estado = {};

    const ESTADO_PADRAO = () => ({
        nome: '', oab: '', slogan: '', sobre: '',
        endereco: '', tel: '', email: '', horario: '', copy: '', whats: '',
        identidade: { perfil: '', favicon: '', fundo: '' },
        fotos: { lista: [] },
        areas: [], depoimentos: [], pubs: [], redes: [],
        layout: CATALOGO_SECOES.map(s => ({ id: s.id, visivel: true })),
        aparencia: { tema: ThemeEngine.TEMA_PADRAO, custom: null },
        audio: { ativo: false, pacote: 'auto' },
        integracao: { webhookLeads: '', webhookEventos: '' },
    });

    async function carregar() {
        const { data, error } = await db.from('site_config').select('*').eq('id', 1).single();
        // Mescla: o que vier nulo do banco cai no padrão (config nova/incompleta)
        const base = ESTADO_PADRAO();
        estado = { ...base, ...(error ? {} : limparNulos(data)) };
        // Garante que seções novas do template entrem no layout de configs antigas
        const idsSalvos = new Set((estado.layout || []).map(s => s.id));
        CATALOGO_SECOES.forEach(s => { if (!idsSalvos.has(s.id)) estado.layout.push({ id: s.id, visivel: true }); });
        // Migração: formato antigo {f1,f2,f3} vira galeria ilimitada {lista:[]}
        if (!Array.isArray(estado.fotos?.lista)) {
            estado.fotos = { lista: ['f1', 'f2', 'f3'].map(k => estado.fotos?.[k]).filter(Boolean) };
        }
    }
    const limparNulos = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null));

    /* ==================================================================== */
    /* 3) CAMPOS DE TEXTO SIMPLES (mapa id do input → chave do estado)      */
    /* ==================================================================== */
    const CAMPOS = {
        'cfg-nome': 'nome', 'cfg-oab': 'oab', 'cfg-slogan': 'slogan', 'cfg-sobre': 'sobre',
        'cfg-endereco': 'endereco', 'cfg-tel': 'tel', 'cfg-email': 'email',
        'cfg-horario': 'horario', 'cfg-copy': 'copy', 'cfg-whats': 'whats',
    };

    function preencherCampos() {
        Object.entries(CAMPOS).forEach(([id, chave]) => { $('#' + id).value = estado[chave] || ''; });
        $('#cfg-webhook-leads').value = estado.integracao?.webhookLeads || '';
        $('#cfg-webhook-eventos').value = estado.integracao?.webhookEventos || '';
        $('#topo-nome').textContent = estado.nome || SUPABASE_CONFIG.cliente.nome;
        if (estado.identidade?.favicon) {
            $('#topo-logo').src = estado.identidade.favicon;
            $('#site-favicon').href = estado.identidade.favicon;
        }
    }

    function coletarCampos() {
        Object.entries(CAMPOS).forEach(([id, chave]) => { estado[chave] = $('#' + id).value.trim(); });
        estado.integracao = {
            webhookLeads: $('#cfg-webhook-leads').value.trim(),
            webhookEventos: $('#cfg-webhook-eventos').value.trim(),
        };
    }

    /* ==================================================================== */
    /* 4) UPLOADS DE IMAGEM — redimensiona no navegador antes de salvar     */
    /* ==================================================================== */
    // Por que redimensionar? As imagens vão em base64 dentro do site_config.
    // Uma foto de celular tem ~4MB; comprimida a 1280px/qualidade 0.82 cai
    // para ~150KB — banco leve, site rápido, sem servidor de arquivos.
    function otimizarImagem(arquivo, larguraMax = 1280) {
        return new Promise((resolver, rejeitar) => {
            const img = new Image();
            img.onload = () => {
                const escala = Math.min(1, larguraMax / img.width);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * escala);
                canvas.height = Math.round(img.height * escala);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                // PNG preserva transparência (logos); o resto vira JPEG comprimido
                const ehPng = arquivo.type === 'image/png';
                resolver(canvas.toDataURL(ehPng ? 'image/png' : 'image/jpeg', 0.82));
                URL.revokeObjectURL(img.src);
            };
            img.onerror = () => rejeitar(new Error('Imagem inválida'));
            img.src = URL.createObjectURL(arquivo);
        });
    }

    // Grava/lê caminhos aninhados tipo "identidade.perfil" no estado
    const setCaminho = (caminho, valor) => {
        const [a, b] = caminho.split('.');
        estado[a] = estado[a] || {};
        estado[a][b] = valor;
    };
    const getCaminho = (caminho) => {
        const [a, b] = caminho.split('.');
        return estado[a]?.[b] || '';
    };

    // Despachante único de upload: quem pede a imagem define o que fazer
    // com o base64 resultante (moldura fixa OU galeria do espaço).
    let acaoUpload = null;

    function pedirImagem(largura, aplicar) {
        acaoUpload = { largura, aplicar };
        $('#input-upload').click();
    }

    function ligarUploads() {
        const inputArquivo = $('#input-upload');

        // Molduras fixas da Identidade Visual (logo, perfil, fundo)
        document.querySelectorAll('.upload-item[data-chave]').forEach(item => {
            item.querySelector('.moldura').addEventListener('click', () => {
                const chave = item.dataset.chave;
                // Fundo do hero merece mais resolução; logos podem ser menores
                const largura = chave === 'identidade.fundo' ? 1600
                              : chave === 'identidade.favicon' ? 400 : 1280;
                pedirImagem(largura, (b64) => { setCaminho(chave, b64); preencherUploads(); });
            });
        });

        inputArquivo.addEventListener('change', async () => {
            const arquivo = inputArquivo.files[0];
            if (!arquivo || !acaoUpload) return;
            try {
                const base64 = await otimizarImagem(arquivo, acaoUpload.largura);
                acaoUpload.aplicar(base64);
                toast('Imagem otimizada! Clique em Salvar para publicar.', 'sucesso');
            } catch { toast('Não consegui ler essa imagem.', 'erro'); }
            inputArquivo.value = ''; // permite reenviar o mesmo arquivo
            acaoUpload = null;
        });
    }

    function preencherUploads() {
        document.querySelectorAll('.upload-item[data-chave]').forEach(item => {
            const src = getCaminho(item.dataset.chave);
            const img = item.querySelector('img');
            img.src = src;
            item.querySelector('.vazio').style.display = src ? 'none' : '';
        });
    }

    /* --- Galeria "Nosso Espaço": fotos ILIMITADAS --- */
    function renderizarGaleriaEspaco() {
        const galeria = $('#galeria-espaco');
        if (!galeria) return; // admin.html desatualizado em cache — segue o baile
        galeria.innerHTML = (estado.fotos.lista || []).map((src, i) => `
            <div class="upload-item foto-espaco" data-indice="${i}">
                <div class="moldura">
                    <img src="${src}" alt="">
                    <button type="button" class="btn-x-foto" title="Remover foto">&times;</button>
                </div>
                <p>Foto ${i + 1}</p>
            </div>`).join('');

        galeria.querySelectorAll('.foto-espaco').forEach(item => {
            const i = +item.dataset.indice;
            // Clicar na foto = substituir aquela posição
            item.querySelector('.moldura').addEventListener('click', (e) => {
                if (e.target.closest('.btn-x-foto')) return;
                pedirImagem(1280, (b64) => { estado.fotos.lista[i] = b64; renderizarGaleriaEspaco(); });
            });
            item.querySelector('.btn-x-foto').addEventListener('click', () => {
                estado.fotos.lista.splice(i, 1);
                renderizarGaleriaEspaco();
            });
        });
    }

    function ligarGaleriaEspaco() {
        const btn = $('#btn-add-foto-espaco');
        if (!btn) return; // idem: nunca derrubar o painel por um botão ausente
        btn.addEventListener('click', () =>
            pedirImagem(1280, (b64) => { estado.fotos.lista.push(b64); renderizarGaleriaEspaco(); }));
    }

    /* ==================================================================== */
    /* 5) LISTAS DINÂMICAS (áreas, depoimentos, publicações, redes)         */
    /* ==================================================================== */
    // Padrão único: cada lista tem um "molde" que desenha um item com inputs
    // ligados por data-campo. Adicionar/remover re-renderiza a lista inteira
    // (simples e à prova de bugs para o volume de itens de um site vitrine).
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

    const LISTAS = {
        areas: {
            el: '#lista-areas', vazio: () => ({ i: 'fas fa-star', t: '', d: '' }),
            molde: (item) => `
                <div style="flex:0 0 120px"><label>Ícone</label><input data-campo="i" value="${esc(item.i)}"></div>
                <div><label>Título</label><input data-campo="t" value="${esc(item.t)}"></div>
                <div style="flex:2"><label>Descrição</label><input data-campo="d" value="${esc(item.d)}"></div>`,
        },
        depoimentos: {
            el: '#lista-depoimentos', vazio: () => ({ t: '', n: '' }),
            molde: (item) => `
                <div style="flex:3"><label>Depoimento</label><input data-campo="t" value="${esc(item.t)}"></div>
                <div><label>Nome do cliente</label><input data-campo="n" value="${esc(item.n)}"></div>`,
        },
        pubs: {
            el: '#lista-pubs', vazio: () => ({ l: '', d: '' }),
            molde: (item) => `
                <div style="flex:2"><label>Link (YouTube ou Instagram)</label><input data-campo="l" value="${esc(item.l)}"></div>
                <div><label>Descrição curta</label><input data-campo="d" value="${esc(item.d)}"></div>`,
        },
        redes: {
            el: '#lista-redes', vazio: () => '',
            molde: (item) => `
                <div><label>URL da rede social</label><input data-campo="_" value="${esc(item)}"></div>`,
            simples: true, // lista de strings, não de objetos
        },
    };

    function renderizarLista(nome) {
        const cfg = LISTAS[nome];
        const container = $(cfg.el);
        const itens = estado[nome] || [];
        container.innerHTML = itens.map((item, i) => `
            <div class="item-dinamico" data-indice="${i}">
                ${cfg.molde(item)}
                <button type="button" class="btn-remover" title="Remover"><i class="fas fa-trash"></i></button>
            </div>`).join('');

        // Inputs → estado (edição ao vivo, sem botão "ok" por item)
        container.querySelectorAll('.item-dinamico').forEach(linha => {
            const i = +linha.dataset.indice;
            linha.querySelectorAll('input').forEach(inp => {
                inp.addEventListener('input', () => {
                    if (cfg.simples) estado[nome][i] = inp.value;
                    else estado[nome][i][inp.dataset.campo] = inp.value;
                });
            });
            linha.querySelector('.btn-remover').addEventListener('click', () => {
                estado[nome].splice(i, 1);
                renderizarLista(nome);
            });
        });
    }

    function ligarListas() {
        Object.keys(LISTAS).forEach(renderizarLista);
        document.querySelectorAll('[data-add]').forEach(btn => {
            btn.addEventListener('click', () => {
                const nome = btn.dataset.add;
                estado[nome] = estado[nome] || [];
                estado[nome].push(LISTAS[nome].vazio());
                renderizarLista(nome);
            });
        });
    }

    /* ==================================================================== */
    /* 6) LAYOUT BUILDER — Drag & Drop nativo (HTML5)                       */
    /* ==================================================================== */
    function renderizarLayout() {
        const lista = $('#lista-layout');
        lista.innerHTML = estado.layout.map(sec => {
            const meta = CATALOGO_SECOES.find(c => c.id === sec.id);
            if (!meta) return '';
            return `
            <li data-id="${sec.id}" draggable="${!meta.fixa}" class="${meta.fixa ? 'fixa' : ''}">
                <i class="fas fa-grip-vertical alca"></i>
                <i class="fas ${meta.icone} icone-secao"></i>
                <span class="nome-secao">${meta.nome}</span>
                ${meta.fixa
                    ? '<span class="etiqueta-fixa">Fixa</span>'
                    : `<label class="interruptor chave-visivel" title="Exibir/ocultar no site">
                         <input type="checkbox" data-visivel ${sec.visivel !== false ? 'checked' : ''}><span></span>
                       </label>`}
            </li>`;
        }).join('');

        let arrastado = null;

        lista.querySelectorAll('li:not(.fixa)').forEach(li => {
            li.addEventListener('dragstart', () => { arrastado = li; li.classList.add('arrastando'); });
            li.addEventListener('dragend', () => { li.classList.remove('arrastando'); arrastado = null; sincronizarOrdem(); });
            li.addEventListener('dragover', (e) => {
                e.preventDefault(); // habilita o drop
                if (!arrastado || arrastado === li) return;
                // Insere antes ou depois conforme a metade do item sob o cursor
                const caixa = li.getBoundingClientRect();
                const depois = e.clientY > caixa.top + caixa.height / 2;
                li.parentNode.insertBefore(arrastado, depois ? li.nextSibling : li);
            });

            // Interruptor de visibilidade
            const chk = li.querySelector('[data-visivel]');
            if (chk) chk.addEventListener('change', () => {
                const sec = estado.layout.find(s => s.id === li.dataset.id);
                if (sec) sec.visivel = chk.checked;
            });
        });

        // Lê a ordem final do DOM de volta para o estado
        function sincronizarOrdem() {
            const novaOrdem = [...lista.querySelectorAll('li')].map(li => li.dataset.id);
            estado.layout.sort((a, b) => novaOrdem.indexOf(a.id) - novaOrdem.indexOf(b.id));
        }
    }

    /* ==================================================================== */
    /* 7) APARÊNCIA — galeria de temas + cores livres + preview ao vivo     */
    /* ==================================================================== */
    function renderizarTemas() {
        const galeria = $('#galeria-temas');
        galeria.innerHTML = ThemeEngine.categorias().map(cat => `
            <p class="cat-temas">${cat}</p>
            <div class="grade-temas">
                ${ThemeEngine.listar().filter(t => t.cat === cat).map(t => `
                    <div class="tema-card ${estado.aparencia.tema === t.id ? 'selecionado' : ''}" data-tema="${t.id}">
                        <div class="amostra" style="background:${t.grad || t.primary}; color:${t.grad ? '#0b0b0b' : t.accent}"><i class="fas ${t.icone}"></i></div>
                        <div class="nome">${t.nome}</div>
                    </div>`).join('')}
            </div>`).join('');

        galeria.querySelectorAll('.tema-card').forEach(card => {
            card.addEventListener('click', () => {
                estado.aparencia.tema = card.dataset.tema;
                galeria.querySelectorAll('.tema-card').forEach(c => c.classList.remove('selecionado'));
                card.classList.add('selecionado');
                // Pickers passam a refletir as cores do tema escolhido
                const t = ThemeEngine.get(card.dataset.tema);
                $('#picker-primary').value = t.primary;
                $('#picker-accent').value = t.accent;
                aplicarPreview();
            });
        });

        // Cores personalizadas
        $('#chk-custom').checked = !!estado.aparencia.custom;
        if (estado.aparencia.custom) {
            $('#picker-primary').value = estado.aparencia.custom.primary;
            $('#picker-accent').value = estado.aparencia.custom.accent;
        }
        ['chk-custom', 'picker-primary', 'picker-accent'].forEach(id =>
            $('#' + id).addEventListener('input', () => {
                estado.aparencia.custom = $('#chk-custom').checked
                    ? { primary: $('#picker-primary').value, accent: $('#picker-accent').value }
                    : null;
                aplicarPreview();
            }));
    }

    // O painel É a pré-visualização: aplicar aqui mostra na hora como fica
    const aplicarPreview = () => ThemeEngine.aplicar(estado.aparencia);

    /* ==================================================================== */
    /* 8) MOTOR DE ÁUDIO — controles do Admin                               */
    /* ==================================================================== */
    function ligarAudio() {
        const select = $('#select-pacote');
        select.innerHTML = `<option value="auto">Automático (segue o tema)</option>` +
            AudioEngine.listarPacotes().map(p => `<option value="${p.id}">${p.nome}</option>`).join('');

        $('#chk-audio').checked = estado.audio?.ativo === true;
        select.value = estado.audio?.pacote || 'auto';
        AudioEngine.configurar(estado.audio);
        AudioEngine.ligarNoDom(); // o próprio painel demonstra os sons

        $('#chk-audio').addEventListener('change', (e) => {
            estado.audio.ativo = e.target.checked;
            AudioEngine.setAtivo(e.target.checked);
        });
        select.addEventListener('change', () => {
            estado.audio.pacote = select.value;
            AudioEngine.configurar(estado.audio);
            aplicarPreview(); // re-sincroniza pacote 'auto' com o tema atual
        });
        $('#btn-testar-som').addEventListener('click', () => {
            // Teste força o som mesmo com interruptor desligado (UX de loja)
            const estava = AudioEngine.getEstado().ativo;
            AudioEngine.setAtivo(true);
            AudioEngine.tocar('click');
            setTimeout(() => AudioEngine.setAtivo(estava), 300);
        });
    }

    /* ==================================================================== */
    /* 9) LEADS — leitura protegida por RLS (só logado enxerga)             */
    /* ==================================================================== */
    async function carregarLeads() {
        const corpo = $('#corpo-leads');
        corpo.innerHTML = `<tr><td colspan="6" class="vazio-leads"><span class="skeleton" style="display:inline-block;width:200px">&nbsp;</span></td></tr>`;
        const { data, error } = await db.from('site_leads')
            .select('*').order('created_at', { ascending: false }).limit(200);

        if (error) { corpo.innerHTML = `<tr><td colspan="6" class="vazio-leads">Erro ao carregar: ${esc(error.message)}</td></tr>`; return; }
        if (!data.length) { corpo.innerHTML = `<tr><td colspan="6" class="vazio-leads">Nenhuma mensagem ainda. Quando o formulário do site for enviado, aparece aqui.</td></tr>`; return; }

        corpo.innerHTML = data.map(l => `
            <tr>
                <td>${new Date(l.created_at).toLocaleDateString('pt-BR')}<br><small>${new Date(l.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></td>
                <td><strong>${esc(l.nome)}</strong></td>
                <td>${esc(l.email || '')}<br><small>${esc(l.whatsapp || '')}</small></td>
                <td>${esc(l.assunto || '')}</td>
                <td class="msg">${esc(l.mensagem || '')}</td>
                <td><button type="button" class="btn-remover" data-lead="${l.id}" title="Apagar"><i class="fas fa-trash"></i></button></td>
            </tr>`).join('');

        corpo.querySelectorAll('[data-lead]').forEach(btn => btn.addEventListener('click', async () => {
            if (!confirm('Apagar este lead definitivamente?')) return;
            await db.from('site_leads').delete().eq('id', btn.dataset.lead);
            carregarLeads();
        }));
    }
    $('#btn-recarregar-leads').addEventListener('click', carregarLeads);

    /* ==================================================================== */
    /* 10) SALVAR E PUBLICAR                                                */
    /* ==================================================================== */
    async function salvar() {
        const btn = $('#btn-salvar');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publicando...';

        coletarCampos();
        const { error } = await db.from('site_config').upsert({ id: 1, ...estado });

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Salvar e Publicar';
        if (error) toast('Erro ao salvar: ' + error.message, 'erro');
        else toast('Site publicado com sucesso! ✔', 'sucesso');
    }
    $('#btn-salvar').addEventListener('click', salvar);

    // Atalho profissional: Ctrl+S / Cmd+S salva
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); salvar(); }
    });

    /* ==================================================================== */
    /* 11) NAVEGAÇÃO DE ABAS + CONTA + TOAST                                */
    /* ==================================================================== */
    $('#menu-abas').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-aba]');
        if (!btn) return;
        document.querySelectorAll('.menu-abas button').forEach(b => b.classList.remove('ativa'));
        document.querySelectorAll('.aba').forEach(a => a.classList.remove('ativa'));
        btn.classList.add('ativa');
        $('#' + btn.dataset.aba).classList.add('ativa');
        if (btn.dataset.aba === 'aba-leads') carregarLeads();
    });

    $('#btn-sair').addEventListener('click', () => Auth.logout());

    $('#btn-trocar-senha').addEventListener('click', async () => {
        const s1 = $('#conta-senha').value, s2 = $('#conta-confirma').value;
        if (s1 !== s2) return toast('As senhas não coincidem.', 'erro');
        const r = await Auth.redefinirSenha(s1);
        toast(r.ok ? 'Senha atualizada!' : r.erro, r.ok ? 'sucesso' : 'erro');
        if (r.ok) { $('#conta-senha').value = ''; $('#conta-confirma').value = ''; }
    });
    $('#conta-info').textContent = `Logado como ${usuario.email}. Sessão protegida por JWT com renovação automática.`;

    let timerToast = null;
    function toast(texto, tipo) {
        const el = $('#toast');
        el.textContent = texto;
        el.className = `toast visivel ${tipo}`;
        clearTimeout(timerToast);
        timerToast = setTimeout(() => el.classList.remove('visivel'), 3200);
    }

    /* ==================================================================== */
    /* INICIALIZAÇÃO                                                        */
    /* ==================================================================== */
    await carregar();

    // Cada passo roda isolado: se um falhar, loga o aviso e o RESTO do painel
    // continua funcionando (nada de listas sumindo em bloco).
    const passo = (nome, fn) => {
        try { fn(); } catch (erro) { console.warn(`[admin] Passo "${nome}" falhou:`, erro); }
    };
    passo('campos', preencherCampos);
    passo('uploads', preencherUploads);
    passo('uploads-eventos', ligarUploads);
    passo('galeria-espaco', renderizarGaleriaEspaco);
    passo('galeria-espaco-eventos', ligarGaleriaEspaco);
    passo('listas-dinamicas', ligarListas);
    passo('layout-builder', renderizarLayout);
    passo('galeria-temas', renderizarTemas);
    passo('audio', ligarAudio);
    passo('preview-tema', aplicarPreview);   // painel abre já com o tema do cliente
})();

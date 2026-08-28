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
        $('#cfg-google-nota').value = estado.integracao?.googleNota || '';
        $('#cfg-google-qtd').value = estado.integracao?.googleQtd || '';
        $('#cfg-google-link-avaliacoes').value = estado.integracao?.googleLinkAvaliacoes || '';
        $('#cfg-google-link-mapa').value = estado.integracao?.googleLinkMapa || '';
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
            googleNota: $('#cfg-google-nota').value.trim(),
            googleQtd: $('#cfg-google-qtd').value.trim(),
            googleLinkAvaliacoes: $('#cfg-google-link-avaliacoes').value.trim(),
            googleLinkMapa: $('#cfg-google-link-mapa').value.trim(),
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

    // Liga cada slider à sua caixinha numérica vizinha (id "rng-x" <-> "num-x").
    // Funciona nos dois sentidos: mexeu na barra, o número acompanha; digitou
    // o número, a barra pula pra lá e dispara o mesmo evento de sempre —
    // então nenhuma lógica de slider precisou ser duplicada ou alterada.
    function ligarParesSliderNumero() {
        document.querySelectorAll('.controle-slider input[type=range]').forEach(range => {
            const numId = 'num-' + range.id.replace(/^(rng-|slider-)/, '');
            const numero = document.getElementById(numId);
            if (!numero) return;

            // Só reescreve a caixinha quando a mudança veio da BARRINHA — se o
            // foco está na própria caixinha (usuário digitando), não mexe nela,
            // senão cada tecla digitada "briga" com o cursor e trava a digitação.
            range.addEventListener('input', () => {
                if (document.activeElement !== numero) numero.value = range.value;
            });

            numero.addEventListener('input', () => {
                if (numero.value === '' || numero.value === '-') return; // digitando ainda
                const v = Math.min(Number(range.max), Math.max(Number(range.min), Number(numero.value)));
                if (Number.isNaN(v)) return;
                range.value = v;
                range.dispatchEvent(new Event('input', { bubbles: true }));
            });

            // Ao sair do campo (Tab/clique fora/Enter), corrige o número exibido
            // para o valor final e válido — sem interferir enquanto digita.
            numero.addEventListener('change', () => { numero.value = range.value; });
        });
    }

    // Chamada sempre que um slider tem seu valor definido PELO CÓDIGO (não
    // pelo usuário) — abrir a popup, resetar, aplicar preset — para a
    // caixinha numérica nunca ficar dessincronizada da barrinha.
    function sincronizarTodosNumeros() {
        document.querySelectorAll('.controle-slider input[type=range]').forEach(range => {
            const numero = document.getElementById('num-' + range.id.replace(/^(rng-|slider-)/, ''));
            if (numero) numero.value = range.value;
        });
    }

    function ligarUploads() {
        const inputArquivo = $('#input-upload');

        // Molduras fixas da Identidade Visual (logo, perfil, fundo)
        document.querySelectorAll('.upload-item[data-chave]').forEach(item => {
            item.querySelector('.moldura').addEventListener('click', () => {
                const chave = item.dataset.chave;
                // Fundo do hero merece mais resolução; logos podem ser menores
                const largura = chave === 'identidade.fundo' || chave === 'identidade.fundoCorpo' || chave === 'identidade.heroFundoAlt' ? 1600
                              : chave === 'identidade.favicon' ? 400
                              : chave === 'identidade.heroPessoaAlt' ? 1000 : 1280;
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

        // Fundo do Corpo: opacidade ajustável por slider (0-100%) + interruptor liga/desliga
        const sliderOpacidade = $('#slider-fundo-corpo-opacidade');
        if (sliderOpacidade) {
            sliderOpacidade.addEventListener('input', () => {
                estado.identidade = estado.identidade || {};
                estado.identidade.fundoCorpoOpacidade = Number(sliderOpacidade.value);
                $('#label-fundo-corpo-opacidade').textContent = sliderOpacidade.value + '%';
            });
        }
        const chkFundoCorpo = $('#chk-fundo-corpo');
        if (chkFundoCorpo) {
            chkFundoCorpo.addEventListener('change', () => {
                estado.identidade = estado.identidade || {};
                estado.identidade.fundoCorpoAtivo = chkFundoCorpo.checked;
            });
        }
        const chkHeroAlt = $('#chk-hero-alt');
        if (chkHeroAlt) {
            chkHeroAlt.addEventListener('change', () => {
                estado.identidade = estado.identidade || {};
                estado.identidade.heroModeloAlt = chkHeroAlt.checked;
            });
        }
    }

    function preencherUploads() {
        document.querySelectorAll('.upload-item[data-chave]').forEach(item => {
            const src = getCaminho(item.dataset.chave);
            const img = item.querySelector('img');
            img.src = src;
            item.querySelector('.vazio').style.display = src ? 'none' : '';
        });

        const sliderOpacidade = $('#slider-fundo-corpo-opacidade');
        if (sliderOpacidade) {
            const valor = estado.identidade?.fundoCorpoOpacidade ?? 40;
            sliderOpacidade.value = valor;
            sincronizarTodosNumeros();
            $('#label-fundo-corpo-opacidade').textContent = valor + '%';
        }
        const chkFundoCorpo = $('#chk-fundo-corpo');
        if (chkFundoCorpo) {
            // Padrão: se já existe imagem salva e a flag nunca foi definida, considera ativo
            chkFundoCorpo.checked = estado.identidade?.fundoCorpoAtivo ?? !!estado.identidade?.fundoCorpo;
        }
        const chkHeroAlt = $('#chk-hero-alt');
        if (chkHeroAlt) {
            chkHeroAlt.checked = estado.identidade?.heroModeloAlt ?? false;
        }
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

        // Fonte personalizada (opcional, independente do tema)
        const selectFonte = $('#select-fonte');
        if (selectFonte) {
            selectFonte.innerHTML = '<option value="">Padrão do tema</option>' +
                ThemeEngine.listarFontes().map(f => `<option value="${f.id}" style="font-family:${f.fontDisplay}">${f.nome}</option>`).join('');
            selectFonte.value = estado.aparencia.fontePersonalizada || '';
            selectFonte.addEventListener('change', () => {
                estado.aparencia.fontePersonalizada = selectFonte.value || null;
                aplicarPreview();
            });
        }
    }

    // O painel É a pré-visualização: aplicar aqui mostra na hora como fica
    const aplicarPreview = () => ThemeEngine.aplicar(estado.aparencia);

    /* ==================================================================== */
    /* 7b) EDITOR VISUAL DO HERO — posição do texto/foto + degradê          */
    /* ==================================================================== */
    // Valores padrão idênticos aos já fixados no CSS público (style.css), para
    // que "nunca ter aberto o editor" continue produzindo o visual de sempre.
    const HERO_AJUSTES_PADRAO = {
        textoX: 0, textoY: 0, fotoX: 0, fotoEscala: 100,
        gradInicio: 92, gradFim: 20, gradPontoA: 42, gradPontoB: 88,
        elementos: {
            titulo: { rotacao: 0, tamanho: 34, fonte: '' },
            oab: { rotacao: 0, tamanho: 17, fonte: '' },
            slogan: { rotacao: 0, tamanho: 20, fonte: '' },
        },
    };

    // Mapa único: cada elemento de texto do Hero, seu campo em `estado`, e os
    // ids dos controles na popup. Evita repetir a mesma lógica 3 vezes.
    const ELEMENTOS_HERO = [
        { id: 'titulo', chaveEstado: 'nome', seletorPreview: '#preview-nome', prefixo: 'titulo' },
        { id: 'oab', chaveEstado: 'oab', seletorPreview: '#preview-oab', prefixo: 'oab' },
        { id: 'slogan', chaveEstado: 'slogan', seletorPreview: '#preview-slogan', prefixo: 'slogan' },
    ];

    function ligarEditorHero() {
        const btnAbrir = $('#btn-abrir-editor-hero');
        const modal = $('#modal-hero-editor');
        if (!btnAbrir || !modal) return;

        const camposNumericos = {
            textoX: $('#rng-texto-x'), textoY: $('#rng-texto-y'),
            fotoX: $('#rng-foto-x'), fotoEscala: $('#rng-foto-escala'),
            gradInicio: $('#rng-grad-inicio'), gradFim: $('#rng-grad-fim'),
            gradPontoA: $('#rng-grad-pa'), gradPontoB: $('#rng-grad-pb'),
        };
        const chkPopup = $('#chk-hero-alt-popup');
        const chkExterno = $('#chk-hero-alt');
        const btnResetar = $('#btn-resetar-hero');
        const btnUltimoPreset = $('#btn-ultimo-preset');

        // Controles de cada elemento de texto (título, oab, slogan) — montados
        // uma vez, reaproveitando o catálogo ELEMENTOS_HERO.
        const opcoesFontes = ThemeEngine.listarFontes()
            .map(f => `<option value="${f.id}" style="font-family:${f.fontDisplay}">${f.nome}</option>`).join('');
        ELEMENTOS_HERO.forEach(el => {
            el.$texto = $(`#pop-${el.prefixo === 'titulo' ? 'nome' : el.prefixo}`);
            el.$tamanho = $(`#rng-${el.prefixo}-tamanho`);
            el.$rotacao = $(`#rng-${el.prefixo}-rotacao`);
            el.$fonte = $(`#select-${el.prefixo}-fonte`);
            el.$lblTamanho = $(`#lbl-${el.prefixo}-tamanho`);
            el.$lblRotacao = $(`#lbl-${el.prefixo}-rotacao`);
            el.$preview = $(el.seletorPreview);
            el.$fonte.innerHTML = '<option value="">Padrão do tema</option>' + opcoesFontes;
        });

        function marcarComoAlterado() { btnResetar.disabled = false; }

        function calcularEscalaPreview() {
            const largura = $('#hero-preview').offsetWidth || 700;
            return largura / (window.innerWidth || 1400);
        }

        function atualizarPreview() {
            const aj = estado.identidade.heroAltAjustes;
            const escala = calcularEscalaPreview();

            const conteudo = $('#preview-content');
            conteudo.style.marginLeft = aj.textoX + '%';
            conteudo.style.marginTop = aj.textoY + '%';

            ELEMENTOS_HERO.forEach(el => {
                const cfg = aj.elementos[el.id];
                // innerText (não textContent!) interpreta \n como quebra de linha real
                el.$preview.innerText = estado[el.chaveEstado] || '';
                el.$preview.style.transform = `rotate(${cfg.rotacao}deg)`;
                el.$preview.style.fontSize = Math.max(8, cfg.tamanho * escala) + 'px';
                const fonteEscolhida = cfg.fonte && ThemeEngine.listarFontes().find(f => f.id === cfg.fonte);
                el.$preview.style.fontFamily = fonteEscolhida ? fonteEscolhida.fontDisplay : '';
                el.$lblTamanho.textContent = cfg.tamanho + 'px';
                el.$lblRotacao.textContent = cfg.rotacao + '°';
            });

            const foto = $('#preview-foto-pessoa');
            foto.style.transform = `translateX(${aj.fotoX}%) scale(${aj.fotoEscala / 100})`;

            $('#preview-overlay').style.background = `linear-gradient(to right,
                color-mix(in srgb, var(--primary) ${aj.gradInicio}%, transparent) 0%,
                color-mix(in srgb, var(--primary) ${aj.gradInicio}%, transparent) ${aj.gradPontoA}%,
                color-mix(in srgb, var(--primary) ${aj.gradFim}%, transparent) ${aj.gradPontoB}%,
                color-mix(in srgb, var(--primary) ${aj.gradFim}%, transparent) 100%)`;

            $('#lbl-grad-inicio').textContent = aj.gradInicio + '%';
            $('#lbl-grad-fim').textContent = aj.gradFim + '%';
            $('#lbl-grad-pa').textContent = aj.gradPontoA + '%';
            $('#lbl-grad-pb').textContent = aj.gradPontoB + '%';
        }

        btnAbrir.addEventListener('click', () => {
            estado.identidade = estado.identidade || {};
            const base = JSON.parse(JSON.stringify(HERO_AJUSTES_PADRAO));
            estado.identidade.heroAltAjustes = { ...base, ...(estado.identidade.heroAltAjustes || {}) };
            estado.identidade.heroAltAjustes.elementos = {
                ...base.elementos, ...(estado.identidade.heroAltAjustes.elementos || {}),
            };
            Object.entries(camposNumericos).forEach(([chave, el]) => { el.value = estado.identidade.heroAltAjustes[chave]; });

            ELEMENTOS_HERO.forEach(el => {
                const cfg = estado.identidade.heroAltAjustes.elementos[el.id];
                el.$texto.value = estado[el.chaveEstado] || '';
                el.$tamanho.value = cfg.tamanho;
                el.$rotacao.value = cfg.rotacao;
                el.$fonte.value = cfg.fonte || '';
            });

            chkPopup.checked = !!estado.identidade.heroModeloAlt;
            btnResetar.disabled = true; // só reativa quando o usuário mexer em algo NESTA sessão
            btnUltimoPreset.disabled = !estado.identidade.heroAltUltimoPreset;

            const foto = $('#preview-foto-pessoa');
            foto.src = estado.identidade.heroPessoaAlt || '';
            const fundo = estado.identidade.heroFundoAlt || estado.identidade.fundo || '';
            $('#hero-preview').style.backgroundImage = fundo ? `url('${fundo}')` : 'none';

            sincronizarTodosNumeros();
            atualizarPreview();
            modal.classList.add('aberto');
        });

        $('#fechar-editor-hero').addEventListener('click', () => modal.classList.remove('aberto'));
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('aberto'); });

        Object.entries(camposNumericos).forEach(([chave, el]) => {
            el.addEventListener('input', () => {
                estado.identidade.heroAltAjustes[chave] = Number(el.value);
                marcarComoAlterado();
                atualizarPreview();
            });
        });

        ELEMENTOS_HERO.forEach(el => {
            el.$texto.addEventListener('input', () => {
                estado[el.chaveEstado] = el.$texto.value;
                // mantém a aba Conteúdo sincronizada (input de linha única lá,
                // então quebras de linha só aparecem visualmente aqui na popup)
                const campoConteudo = { titulo: '#cfg-nome', oab: '#cfg-oab', slogan: '#cfg-slogan' }[el.id];
                if ($(campoConteudo)) $(campoConteudo).value = el.$texto.value;
                marcarComoAlterado();
                atualizarPreview();
            });
            el.$tamanho.addEventListener('input', () => {
                estado.identidade.heroAltAjustes.elementos[el.id].tamanho = Number(el.$tamanho.value);
                marcarComoAlterado();
                atualizarPreview();
            });
            el.$rotacao.addEventListener('input', () => {
                estado.identidade.heroAltAjustes.elementos[el.id].rotacao = Number(el.$rotacao.value);
                marcarComoAlterado();
                atualizarPreview();
            });
            el.$fonte.addEventListener('change', () => {
                estado.identidade.heroAltAjustes.elementos[el.id].fonte = el.$fonte.value;
                marcarComoAlterado();
                atualizarPreview();
            });
        });

        // Interruptor duplicado (dentro e fora da popup) — mantém os dois em sincronia
        function alternarHeroAlt(ativo) {
            estado.identidade.heroModeloAlt = ativo;
            chkPopup.checked = ativo;
            if (chkExterno) chkExterno.checked = ativo;
            marcarComoAlterado();
        }
        chkPopup.addEventListener('change', () => alternarHeroAlt(chkPopup.checked));
        if (chkExterno) chkExterno.addEventListener('change', () => alternarHeroAlt(chkExterno.checked));

        function aplicarConjunto(conjunto) {
            estado.identidade.heroAltAjustes = JSON.parse(JSON.stringify(conjunto));
            Object.entries(camposNumericos).forEach(([chave, el]) => { el.value = estado.identidade.heroAltAjustes[chave]; });
            ELEMENTOS_HERO.forEach(el => {
                const cfg = estado.identidade.heroAltAjustes.elementos[el.id];
                el.$tamanho.value = cfg.tamanho;
                el.$rotacao.value = cfg.rotacao;
                el.$fonte.value = cfg.fonte || '';
            });
            sincronizarTodosNumeros();
            atualizarPreview();
        }

        btnResetar.addEventListener('click', () => {
            if (btnResetar.disabled) return;
            aplicarConjunto(HERO_AJUSTES_PADRAO);
        });

        btnUltimoPreset.addEventListener('click', () => {
            if (btnUltimoPreset.disabled) return;
            const preset = estado.identidade.heroAltUltimoPreset;
            aplicarConjunto({
                ...HERO_AJUSTES_PADRAO, ...preset,
                elementos: { ...HERO_AJUSTES_PADRAO.elementos, ...(preset.elementos || {}) },
            });
            marcarComoAlterado();
        });
    }

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
    const NOMES_STATUS_LEAD = { novo: 'Novo', andamento: 'Em andamento', concluido: 'Concluído' };

    async function carregarLeads() {
        const corpo = $('#corpo-leads');
        corpo.innerHTML = `<tr><td colspan="7" class="vazio-leads"><span class="skeleton" style="display:inline-block;width:200px">&nbsp;</span></td></tr>`;
        const { data, error } = await db.from('site_leads')
            .select('*').order('created_at', { ascending: false }).limit(200);

        if (error) { corpo.innerHTML = `<tr><td colspan="7" class="vazio-leads">Erro ao carregar: ${esc(error.message)}</td></tr>`; return; }
        if (!data.length) {
            corpo.innerHTML = `<tr><td colspan="7" class="vazio-leads">Nenhuma mensagem ainda. Quando o formulário do site for enviado, aparece aqui.</td></tr>`;
            atualizarBadgeLeads(0);
            return;
        }

        corpo.innerHTML = data.map(l => {
            const status = l.status || 'novo';
            return `
            <tr>
                <td>
                    <select class="select-status-lead ${status}" data-lead-status="${l.id}">
                        ${Object.entries(NOMES_STATUS_LEAD).map(([v, n]) => `<option value="${v}" ${v === status ? 'selected' : ''}>${n}</option>`).join('')}
                    </select>
                </td>
                <td>${new Date(l.created_at).toLocaleDateString('pt-BR')}<br><small>${new Date(l.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></td>
                <td><strong>${esc(l.nome)}</strong></td>
                <td>${esc(l.email || '')}<br><small>${esc(l.whatsapp || '')}</small></td>
                <td>${esc(l.assunto || '')}</td>
                <td class="msg">${esc(l.mensagem || '')}</td>
                <td><button type="button" class="btn-remover" data-lead="${l.id}" title="Apagar"><i class="fas fa-trash"></i></button></td>
            </tr>`;
        }).join('');

        atualizarBadgeLeads(data.filter(l => (l.status || 'novo') === 'novo').length);

        corpo.querySelectorAll('[data-lead-status]').forEach(select => select.addEventListener('change', async () => {
            select.className = `select-status-lead ${select.value}`;
            await db.from('site_leads').update({ status: select.value }).eq('id', select.dataset.leadStatus);
            const novos = corpo.querySelectorAll('.select-status-lead.novo').length;
            atualizarBadgeLeads(novos);
        }));

        corpo.querySelectorAll('[data-lead]').forEach(btn => btn.addEventListener('click', async () => {
            if (!confirm('Apagar este lead definitivamente?')) return;
            await db.from('site_leads').delete().eq('id', btn.dataset.lead);
            carregarLeads();
        }));
    }

    function atualizarBadgeLeads(qtd) {
        const badge = $('#badge-leads');
        if (!badge) return;
        badge.textContent = qtd;
        badge.style.display = qtd > 0 ? 'inline-block' : 'none';
    }
    $('#btn-recarregar-leads').addEventListener('click', carregarLeads);

    /* ==================================================================== */
    /* 9b) ESTATÍSTICAS — cliques rastreados + leads, por período           */
    /* ==================================================================== */
    const NOMES_EVENTOS = {
        cta_consultoria: 'Botão "Solicitar Consultoria"',
        cta_whatsapp_hero: 'WhatsApp (topo do site)',
        cta_whatsapp_flutuante: 'WhatsApp (botão flutuante)',
        pub_click: 'Cliques em publicações/vídeos',
        rede_social: 'Cliques em redes sociais',
    };

    async function carregarEstatisticas() {
        const select = $('#select-periodo-stats');
        const resumo = $('#stats-resumo');
        const barras = $('#stats-barras');
        if (!select || !resumo || !barras) return;

        resumo.innerHTML = '<div class="stats-card"><span class="skeleton" style="display:inline-block;width:80px">&nbsp;</span></div>';
        barras.innerHTML = '';

        const dias = Number(select.value);
        const desde = dias > 0 ? new Date(Date.now() - dias * 86400000).toISOString() : '1970-01-01T00:00:00Z';

        const [leadsResp, eventosResp, visitasResp] = await Promise.all([
            db.from('site_leads').select('id', { count: 'exact', head: true }).gte('created_at', desde),
            db.from('site_eventos').select('evento').neq('evento', 'visita_site').gte('created_at', desde),
            db.from('site_eventos').select('id', { count: 'exact', head: true }).eq('evento', 'visita_site').gte('created_at', desde),
        ]);

        const totalLeads = leadsResp.count ?? 0;
        const eventos = eventosResp.data || [];
        const totalVisitas = visitasResp.count ?? 0;

        resumo.innerHTML = `
            <div class="stats-card"><strong>${totalVisitas}</strong><span>Visitas ao site</span></div>
            <div class="stats-card"><strong>${totalLeads}</strong><span>Leads recebidos</span></div>
            <div class="stats-card"><strong>${eventos.length}</strong><span>Cliques rastreados</span></div>
        `;

        const contagem = {};
        eventos.forEach(e => { contagem[e.evento] = (contagem[e.evento] || 0) + 1; });
        const linhas = Object.entries(contagem).sort((a, b) => b[1] - a[1]);

        if (!linhas.length) {
            barras.innerHTML = '<p class="dica">Nenhum clique registrado nesse período ainda.</p>';
            return;
        }

        const max = linhas[0][1];
        barras.innerHTML = linhas.map(([evento, qtd]) => `
            <div class="stats-linha">
                <span class="stats-nome">${esc(NOMES_EVENTOS[evento] || evento)}</span>
                <div class="stats-barra-fundo"><div class="stats-barra" style="width:${(qtd / max) * 100}%"></div></div>
                <span class="stats-qtd">${qtd}</span>
            </div>`).join('');

        // Detalhamento: quais publicações (por tema) e quais redes sociais
        // específicas mais recebem cliques — não só o total por tipo.
        const [{ data: pubEventos }, { data: redeEventos }] = await Promise.all([
            db.from('site_eventos').select('texto_botao').eq('evento', 'pub_click').gte('created_at', desde),
            db.from('site_eventos').select('destino').eq('evento', 'rede_social').gte('created_at', desde),
        ]);
        renderizarBarrasDetalhe('#stats-publicacoes', pubEventos, 'texto_botao', t => t || '(sem tema cadastrado)');
        renderizarBarrasDetalhe('#stats-redes', redeEventos, 'destino', nomeRedeSocial);
    }

    // Identifica a plataforma pela URL, reaproveitando a mesma lógica usada
    // no site público para os ícones das redes sociais.
    function nomeRedeSocial(url) {
        const u = (url || '').toLowerCase();
        if (u.includes('instagram')) return 'Instagram';
        if (u.includes('youtube') || u.includes('youtu.be')) return 'YouTube';
        if (u.includes('whatsapp') || u.includes('wa.me')) return 'WhatsApp';
        if (u.includes('linkedin')) return 'LinkedIn';
        if (u.includes('facebook')) return 'Facebook';
        if (u.includes('tiktok')) return 'TikTok';
        if (u.includes('t.me') || u.includes('telegram')) return 'Telegram';
        if (u.includes('threads')) return 'Threads';
        if (u.includes('x.com') || u.includes('twitter')) return 'X (Twitter)';
        return url || '(link desconhecido)';
    }

    // Genérico: agrupa uma lista de linhas por um campo, conta e desenha barras
    // — reaproveitado tanto pelas publicações quanto pelas redes sociais.
    function renderizarBarrasDetalhe(seletor, linhasBrutas, campo, formatar) {
        const container = $(seletor);
        if (!container) return;
        const contagem = {};
        (linhasBrutas || []).forEach(l => {
            const chave = formatar(l[campo]);
            contagem[chave] = (contagem[chave] || 0) + 1;
        });
        const linhas = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
        if (!linhas.length) {
            container.innerHTML = '<p class="dica">Nenhum clique registrado nesse período ainda.</p>';
            return;
        }
        const max = linhas[0][1];
        container.innerHTML = linhas.map(([nome, qtd]) => `
            <div class="stats-linha">
                <span class="stats-nome">${esc(nome)}</span>
                <div class="stats-barra-fundo"><div class="stats-barra" style="width:${(qtd / max) * 100}%"></div></div>
                <span class="stats-qtd">${qtd}</span>
            </div>`).join('');
    }
    if ($('#btn-recarregar-stats')) {
        $('#btn-recarregar-stats').addEventListener('click', carregarEstatisticas);
        $('#select-periodo-stats').addEventListener('change', carregarEstatisticas);
    }

    /* ==================================================================== */
    /* 10) SALVAR E PUBLICAR                                                */
    /* ==================================================================== */
    async function salvar() {
        const btn = $('#btn-salvar');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publicando...';

        coletarCampos();
        // Guarda o estado atual do Hero como "último preset" — é o que o botão
        // "Aplicar Último Preset" vai restaurar depois, sempre a versão mais
        // recente que de fato foi ao ar (não qualquer rascunho não salvo).
        if (estado.identidade?.heroAltAjustes) {
            estado.identidade.heroAltUltimoPreset = { ...estado.identidade.heroAltAjustes };
        }
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
        if (btn.dataset.aba === 'aba-estatisticas') carregarEstatisticas();
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
    /* MODERAÇÃO DE AVALIAÇÕES PÚBLICAS                                     */
    /* ==================================================================== */
    async function carregarAvaliacoesPendentes() {
        const container = $('#lista-avaliacoes-pendentes');
        if (!container) return;

        const { data, error } = await db
            .from('avaliacoes')
            .select('id, nome, texto, nota, created_at')
            .eq('aprovado', false)
            .order('created_at', { ascending: true });

        const badge = $('#badge-avaliacoes');

        if (error || !data?.length) {
            container.innerHTML = '<p class="dica">Nenhuma avaliação pendente no momento.</p>';
            if (badge) badge.style.display = 'none';
            return;
        }

        if (badge) {
            badge.textContent = data.length;
            badge.style.display = 'inline-block';
        }

        container.innerHTML = data.map(av => `
            <div class="item-dinamico" data-id="${av.id}">
                <div style="flex:1">
                    <strong>${esc(av.nome)}</strong> — ${'⭐'.repeat(av.nota)}
                    <p style="margin:6px 0 0">${esc(av.texto)}</p>
                </div>
                <button type="button" class="btn-aprovar-avaliacao" data-id="${av.id}">Aprovar</button>
                <button type="button" class="btn-rejeitar-avaliacao" data-id="${av.id}">Rejeitar</button>
            </div>`).join('');

        container.querySelectorAll('.btn-aprovar-avaliacao').forEach(btn =>
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                await db.from('avaliacoes').update({ aprovado: true }).eq('id', btn.dataset.id);
                carregarAvaliacoesPendentes();
            }));

        container.querySelectorAll('.btn-rejeitar-avaliacao').forEach(btn =>
            btn.addEventListener('click', async () => {
                if (!confirm('Rejeitar (e apagar) esta avaliação?')) return;
                btn.disabled = true;
                await db.from('avaliacoes').delete().eq('id', btn.dataset.id);
                carregarAvaliacoesPendentes();
            }));
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
    passo('editor-hero', ligarEditorHero);
    passo('pares-slider-numero', ligarParesSliderNumero);
    passo('audio', ligarAudio);
    passo('preview-tema', aplicarPreview);   // painel abre já com o tema do cliente
    passo('avaliacoes-pendentes', carregarAvaliacoesPendentes);
    passo('leads-badge', carregarLeads); // carrega já na abertura, para o badge aparecer sem precisar clicar na aba
})();

/* ============================================================================
 * APP.JS — Motor do Site Público (Fase 3 · Final)
 * ============================================================================
 * Responsabilidades:
 *   1. HÍBRIDO OFFLINE-FIRST: busca a config no Supabase; se a nuvem falhar,
 *      usa o cache local da última visita (o site nunca abre "quebrado").
 *   2. LAYOUT DINÂMICO: reordena as <section> do index.html conforme o
 *      Drag & Drop do Admin e oculta as desligadas no interruptor.
 *   3. MOTORES: aplica ThemeEngine (cores/fontes) + AudioEngine (sons).
 *   4. CONTEÚDO: injeta textos, imagens (lazy), áreas, depoimentos,
 *      publicações e redes sociais.
 *   5. n8n: formulário e CTAs disparam POST invisível com payload rico.
 *   6. UX: scroll-reveal com IntersectionObserver, zero dependências.
 * ========================================================================== */

(() => {
    'use strict';

    const cfgApp = window.SUPABASE_CONFIG;
    // 🔒 CRÍTICO: sem "db: { schema }" o client cai no padrão "public" —
    // mesmo bug que existia no auth.js. O site público precisa ler do
    // MESMO schema onde o admin salva, senão "salva mas não aparece".
    const schemaCliente = cfgApp.cliente.schema;
    const db = supabase.createClient(cfgApp.url, cfgApp.anonKey, {
        db: { schema: schemaCliente },
    });
    console.log(`🔒 [App] Site público lendo do schema: "${schemaCliente}"`);
    const $ = (sel) => document.querySelector(sel);

    let config = null; // espelho do site_config

    /* ==================================================================== */
    /* 1) CARGA HÍBRIDA — nuvem primeiro, cache como rede de segurança      */
    /* ==================================================================== */
    const CHAVE_CACHE = 'siteConfigCache';

    async function carregarConfig() {
        try {
            const { data, error } = await db.from('site_config').select('*').eq('id', 1).single();
            if (error || !data) throw error;
            config = data;
            // Cache best-effort: imagens base64 grandes podem estourar a quota
            // do localStorage (~5MB) — se estourar, seguimos sem cache mesmo.
            try { localStorage.setItem(CHAVE_CACHE, JSON.stringify(data)); } catch { /* quota */ }
        } catch {
            try { config = JSON.parse(localStorage.getItem(CHAVE_CACHE)); } catch { config = null; }
        }
        return config;
    }

    /* ==================================================================== */
    /* 2) LAYOUT DINÂMICO — a ordem do Admin vira a ordem do DOM            */
    /* ==================================================================== */
    function aplicarLayout(layout) {
        if (!Array.isArray(layout) || !layout.length) return;
        const mapa = $('#mapa-secoes');

        layout.forEach(item => {
            const secao = document.getElementById(item.id);
            if (!secao) return;                    // seção desconhecida: ignora
            mapa.appendChild(secao);               // appendChild MOVE o nó →
                                                   // percorrer na ordem salva
                                                   // reconstrói a sequência exata
            secao.style.display = item.visivel === false ? 'none' : '';
        });

        // Fundos alternados (branco/cinza) recalculados pela NOVA ordem,
        // para o ritmo visual continuar elegante em qualquer arranjo
        let visivelIndex = 0;
        layout.forEach(item => {
            const secao = document.getElementById(item.id);
            if (!secao || item.visivel === false || item.id === 'hero') return;
            secao.classList.toggle('gray-bg', visivelIndex % 2 === 0);
            visivelIndex++;
        });
    }

    /* ==================================================================== */
    /* 3) INJEÇÃO DE CONTEÚDO                                               */
    /* ==================================================================== */
    const setTexto = (id, valor) => { const el = document.getElementById(id); if (el && valor) el.innerText = valor; };
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

    // Executa um bloco de renderização isoladamente: se um falhar, loga no
    // console e SEGUE para o próximo (redes sociais nunca morrem por culpa
    // de uma publicação com dado estranho, por exemplo).
    function blindado(nomeBloco, fn) {
        try { fn(); } catch (erro) {
            console.warn(`[app.js] Bloco "${nomeBloco}" falhou e foi pulado:`, erro);
        }
    }

    function aplicarConteudo(d) {
        /* --- Textos base --- */
        setTexto('edit-nome', d.nome);
        setTexto('edit-header-nome', d.nome);
        setTexto('edit-oab', d.oab);
        setTexto('edit-slogan', d.slogan);
        setTexto('edit-sobre-texto', d.sobre);
        setTexto('edit-endereco', d.endereco);

        /* --- Google Meu Negócio: mapa embutido, rotas e selo de avaliações --- */
        blindado('google business', () => {
            const integ = d.integracao || {};

            // Mapa embutido: usa o próprio endereço já cadastrado, sem precisar
            // de chave de API nem custo — funciona para qualquer cliente do template.
            if (d.endereco) {
                const iframe = $('#iframe-mapa-endereco');
                if (iframe) {
                    iframe.src = `https://www.google.com/maps?q=${encodeURIComponent(d.endereco)}&z=16&output=embed`;
                    $('#mapa-endereco-embed').style.display = '';
                }
            }

            // Botão "Ver rotas": usa o link exato configurado no Admin (mais preciso
            // que reconstruir a partir do texto do endereço).
            if (integ.googleLinkMapa) {
                const btnRotas = $('#btn-rotas-google');
                btnRotas.href = integ.googleLinkMapa;
                btnRotas.style.display = '';
            }

            // Selo de avaliações do Google (nota/quantidade atualizadas manualmente
            // no Admin — puxar isso ao vivo exigiria a API paga do Google Places).
            if (integ.googleNota && integ.googleLinkAvaliacoes) {
                setTexto('google-badge-nota', integ.googleNota);
                setTexto('google-badge-qtd', integ.googleQtd || '');
                $('#google-badge-link').href = integ.googleLinkAvaliacoes;
                $('#google-badge').style.display = '';
            }
        });
        setTexto('edit-telefone', d.tel);
        setTexto('edit-email', d.email);
        setTexto('edit-horario', d.horario);
        setTexto('edit-copyright', d.copy);
        if (d.endereco) setTexto('footer-endereco-texto', '📍 ' + d.endereco.replace(/\n/g, ' '));
        if (d.tel) setTexto('footer-fone-texto', '📞 ' + d.tel);
        if (d.nome) document.title = `${d.nome} | ${d.oab || 'Site Oficial'}`;

        /* --- Identidade visual --- */
        const idv = d.identidade || {};
        if (idv.perfil) $('#edit-perfil-foto').src = idv.perfil;
        if (idv.favicon) { $('#edit-logo').src = idv.favicon; $('#site-favicon').href = idv.favicon; }
        if (idv.fundo) $('#hero').style.backgroundImage = `url('${idv.fundo}')`;

        // Modelo alternativo do Hero: foto da pessoa recortada à direita,
        // texto alinhado à esquerda, com gradiente automático da esquerda
        // (escura) para a direita (clara). Some sozinho se desativado ou
        // sem a foto da pessoa enviada — o modelo padrão nunca é afetado.
        blindado('hero modelo alternativo', () => {
            const hero = $('#hero');
            const ativo = !!(idv.heroModeloAlt && idv.heroPessoaAlt);
            hero.classList.toggle('hero-alt', ativo);
            if (!ativo) return;

            if (idv.heroFundoAlt) hero.style.backgroundImage = `url('${idv.heroFundoAlt}')`;
            $('#hero-pessoa-alt').src = idv.heroPessoaAlt;

            // Ajustes finos feitos no editor visual do Admin (posição do texto/
            // foto + degradê). Sem ajustes salvos, usa os mesmos valores padrão
            // já fixados no CSS — comportamento idêntico a antes.
            const aj = idv.heroAltAjustes || {};
            const textoX = aj.textoX ?? 0, textoY = aj.textoY ?? 0;
            const fotoX = aj.fotoX ?? 0, fotoEscala = (aj.fotoEscala ?? 100) / 100;
            const gi = aj.gradInicio ?? 92, gf = aj.gradFim ?? 20;
            const pa = aj.gradPontoA ?? 42, pb = aj.gradPontoB ?? 88;

            // margin (não transform!) no texto — evita conflito com a animação
            // de entrada do hero, que já usa "transform" nos próprios keyframes.
            const conteudo = hero.querySelector('.hero-content');
            if (conteudo) { conteudo.style.marginLeft = textoX + '%'; conteudo.style.marginTop = textoY + '%'; }

            const foto = $('#hero-pessoa-alt');
            foto.style.transform = `translateX(${fotoX}%) scale(${fotoEscala})`;

            const overlay = hero.querySelector('.hero-overlay');
            if (overlay) overlay.style.background = `linear-gradient(to right,
                color-mix(in srgb, var(--primary) ${gi}%, transparent) 0%,
                color-mix(in srgb, var(--primary) ${gi}%, transparent) ${pa}%,
                color-mix(in srgb, var(--primary) ${gf}%, transparent) ${pb}%,
                color-mix(in srgb, var(--primary) ${gf}%, transparent) 100%)`;

            // Rotação, tamanho e fonte de cada texto do hero (título, OAB, slogan)
            // — sem afetar o resto do site. Fonte reaproveita o mesmo catálogo do
            // seletor "Fonte Personalizada" (Aparência), mas escolhida à parte.
            const elementosTexto = {
                titulo: hero.querySelector('h1'),
                oab: hero.querySelector('.oab'),
                slogan: hero.querySelector('.slogan'),
            };
            Object.entries(elementosTexto).forEach(([id, el]) => {
                if (!el) return;
                const cfg = aj.elementos?.[id] || {};
                el.style.transform = `rotate(${cfg.rotacao ?? 0}deg)`;
                if (cfg.tamanho) el.style.fontSize = cfg.tamanho + 'px';
                const fonteEscolhida = cfg.fonte && window.ThemeEngine
                    && ThemeEngine.listarFontes().find(f => f.id === cfg.fonte);
                el.style.fontFamily = fonteEscolhida ? fonteEscolhida.fontDisplay : '';
            });
        });

        // Fundo do Corpo: imagem opcional com opacidade ajustável, aplicada por
        // trás de todas as seções (exceto Hero, header e rodapé). Sem imagem
        // configurada, o site segue 100% igual ao padrão de sempre.
        blindado('fundo do corpo', () => {
            // A imagem fica guardada mesmo desativada — só o interruptor
            // 'fundoCorpoAtivo' decide se o efeito aparece no site público.
            if (idv.fundoCorpo && idv.fundoCorpoAtivo) {
                document.body.style.setProperty('--fundo-corpo-img', `url('${idv.fundoCorpo}')`);
                document.body.style.setProperty('--fundo-corpo-opacidade', (idv.fundoCorpoOpacidade ?? 40) / 100);
                document.body.classList.add('tem-fundo-corpo');
            } else {
                document.body.classList.remove('tem-fundo-corpo');
            }
        });

        /* --- Fotos do espaço: galeria ILIMITADA (retrocompatível com f1..f3) --- */
        blindado('fotos do espaço', () => {
            const fotos = Array.isArray(d.fotos?.lista) && d.fotos.lista.length
                ? d.fotos.lista
                : ['f1', 'f2', 'f3'].map(k => d.fotos?.[k]).filter(Boolean);
            if (fotos.length) {
                $('#container-fotos-espaco').innerHTML = fotos.map(src => `
                    <div class="office-photo" data-fullsrc="${esc(src)}">
                        <div class="office-photo-bg" style="background-image:url('${esc(src)}')"></div>
                        <img src="${esc(src)}" alt="Nosso espaço" loading="lazy"></div>`).join('');
            } else {
                $('#nosso-espaco').style.display = 'none'; // sem fotos → seção some
            }
        });

        /* --- Áreas de atuação --- */
        blindado('áreas', () => {
            if (d.areas?.length) {
                const numWhats = d.whats ? d.whats.replace(/\D/g, '') : '';
                $('#container-servicos').innerHTML = d.areas.map((a, i) => {
                    const botaoWhats = numWhats ? `
                        <a class="card-whats-btn" target="_blank" rel="noopener"
                           data-evento="cta_whatsapp_area" data-titulo="${esc(a.t)}"
                           href="https://wa.me/${numWhats}?text=${encodeURIComponent('Olá! Gostaria de mais informações sobre ' + a.t + '.')}">
                            <i class="fab fa-whatsapp"></i> Falar sobre isso
                        </a>` : '';
                    return `
                    <div class="card" style="--i:${i}">
                        <i class="${esc(a.i)} gold-3d"></i>
                        <h3>${esc(a.t)}</h3>
                        <p>${esc(a.d)}</p>
                        ${botaoWhats}
                    </div>`;
                }).join('');
            }
        });

        /* --- Depoimentos (curados no Admin + avaliações públicas aprovadas) --- */
        blindado('depoimentos', async () => {
            const contDep = $('#container-depoimentos');
            const curados = (d.depoimentos || []).map(dep => ({ n: dep.n, t: dep.t, nota: 5 }));

            let publicas = [];
            try {
                const { data: avals } = await db
                    .from('avaliacoes')
                    .select('nome, texto, nota, created_at')
                    .eq('aprovado', true)
                    .order('created_at', { ascending: false });
                publicas = (avals || []).map(a => ({ n: a.nome, t: a.texto, nota: a.nota }));
            } catch (erro) {
                console.warn('[app.js] Avaliações públicas indisponíveis:', erro);
            }

            const todas = [...publicas, ...curados];

            const wrapper = $('.testimonial-wrapper');
            if (todas.length) {
                contDep.innerHTML = todas.map(dep => {
                    const primeiroNome = (dep.n || '').trim().split(/\s+/)[0] || dep.n;
                    return `
                    <div class="review-card">
                        <span class="client-name">${esc(primeiroNome)}</span>
                        <div class="stars">${'⭐'.repeat(dep.nota)}${'☆'.repeat(5 - dep.nota)}</div>
                        <p>"${esc(dep.t)}"</p>
                    </div>`;
                }).join('');
                wrapper.style.display = '';
            } else {
                // Sem depoimentos ainda → some só o carrossel, NUNCA a seção inteira
                // (o formulário de avaliação pública mora aqui e precisa continuar visível
                // para que a primeira avaliação possa ser enviada).
                wrapper.style.display = 'none';
            }
        });

        /* --- Publicações (YouTube com thumb automática / Instagram Real) --- */
        blindado('publicações', () => {
            const contPub = $('#container-publicacoes');
            const pubs = (d.pubs || []).filter(p => p.l?.trim());
            if (pubs.length) {
                contPub.innerHTML = pubs.map(p => {
                    let thumb;
                    if (p.l.includes('instagram.com')) {
                        const urlLimpa = p.l.split('?')[0];
                        thumb = `<div class="insta-container-media">
                                    <img src="${urlLimpa}media/?size=m" alt="Publicação Instagram" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\'insta-placeholder\'><i class=\'fab fa-instagram\'></i> Ver Vídeo no Instagram</div>'">
                                    <div class="play-overlay"><i class="fab fa-instagram"></i></div>
                                 </div>`;
                    } else {
                        const id = (p.l.match(/(?:shorts\/|v=|youtu\.be\/)([\w-]{6,})/) || [])[1] || '';
                        thumb = `<img src="https://img.youtube.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy">
                                 <div class="play-overlay"><i class="fab fa-youtube"></i></div>`;
                    }
                    return `<div class="pub-container">
                                <p class="pub-desc">${esc(p.d)}</p>
                                <div class="pub-item"><a href="${esc(p.l)}" target="_blank" rel="noopener" data-evento="pub_click" data-titulo="${esc((p.d || '').slice(0, 60))}">${thumb}</a></div>
                            </div>`;
                }).join('');
            } else {
                $('#publicacoes').style.display = 'none';
            }
        });

        /* --- Redes sociais (ícone detectado pela URL) --- */
        blindado('redes sociais', () => {
            const icone = (u) => u.includes('instagram') ? 'fab fa-instagram'
                : (u.includes('youtube') || u.includes('youtu.be')) ? 'fab fa-youtube'
                : (u.includes('whatsapp') || u.includes('wa.me')) ? 'fab fa-whatsapp'
                : u.includes('linkedin') ? 'fab fa-linkedin'
                : u.includes('facebook') ? 'fab fa-facebook'
                : u.includes('tiktok') ? 'fab fa-tiktok'
                : (u.includes('t.me') || u.includes('telegram')) ? 'fab fa-telegram'
                : u.includes('threads') ? 'fab fa-threads'
                : u.includes('kwai') ? 'fas fa-video'
                : (u.includes('x.com') || u.includes('twitter')) ? 'fab fa-x-twitter'
                : 'fas fa-link';

            const redes = (d.redes || []).filter(u => u?.trim());
            if (redes.length) {
                const html = redes.map(u =>
                    `<a href="${esc(u)}" target="_blank" rel="noopener" data-evento="rede_social"><i class="${icone(u)}"></i></a>`).join('');
                $('#edit-redes-sociais-icones').innerHTML = html;
                $('#edit-social-links-footer').innerHTML = html;
            }
        });

        /* --- WhatsApp: todos os elementos [data-whats] apontam pro número --- */
        if (d.whats) {
            const num = d.whats.replace(/\D/g, '');
            document.querySelectorAll('[data-whats]').forEach(a => { a.href = `https://wa.me/${num}`; a.target = '_blank'; });
        }
    }

    /* ==================================================================== */
    /* 4) INTEGRAÇÃO n8n — disparos invisíveis com payload rico             */
    /* ==================================================================== */
    // Monta o "envelope" comum a todos os eventos: quem, onde e quando.
    function payloadBase(evento) {
        return {
            evento,
            cliente: cfgApp.cliente,                        // { id, nome, marca }
            pagina: { url: location.href, titulo: document.title, referrer: document.referrer || null },
            dispositivo: { userAgent: navigator.userAgent, idioma: navigator.language, largura: innerWidth },
            timestamp: new Date().toISOString(),
        };
    }

    // Dispara sem travar a página. sendBeacon é ideal para cliques que
    // navegam para fora (WhatsApp/redes): o POST sobrevive à saída da página.
    function dispararWebhook(url, payload) {
        if (!url) return; // webhook não configurado no Admin → silêncio total
        try {
            const corpo = JSON.stringify(payload);
            if (navigator.sendBeacon) {
                navigator.sendBeacon(url, new Blob([corpo], { type: 'application/json' }));
            } else {
                fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo, keepalive: true });
            }
        } catch { /* automação nunca pode derrubar o site */ }
    }

    // Contabiliza cada carregamento da página como uma visita — dispara e
    // esquece, nunca atrasa nem trava a primeira pintura do site.
    function registrarVisita() {
        db.from('site_eventos').insert([{
            evento: 'visita_site',
            pagina_url: location.pathname,
        }]).then(() => {}, () => {});
    }

    // CTAs: um listener delegado cobre botões estáticos E gerados dinamicamente
    function ligarRastreioDeCliques() {
        document.addEventListener('click', (e) => {
            const alvo = e.target.closest('[data-evento]');
            if (!alvo) return;
            // Publicações não têm texto visível (só a miniatura) — usamos a
            // descrição/tema cadastrada no Admin via data-titulo, se existir.
            const textoBotao = alvo.dataset.titulo || alvo.innerText.trim().slice(0, 60);
            const destino = alvo.href || null;

            dispararWebhook(config?.integracao?.webhookEventos, {
                ...payloadBase(alvo.dataset.evento),
                botao: { texto: textoBotao, destino },
            });

            // Persiste no banco também (além do webhook), para o painel de
            // estatísticas do Admin poder consultar depois. Dispara e esquece —
            // nunca atrasa nem trava o clique do visitante.
            db.from('site_eventos').insert([{
                evento: alvo.dataset.evento,
                texto_botao: textoBotao,
                destino,
                pagina_url: location.pathname,
            }]).then(() => {}, () => {});
        });
    }

    /* ==================================================================== */
    /* 5) FORMULÁRIO DE CONTATO — Supabase + n8n em paralelo                */
    /* ==================================================================== */
    function ligarFormulario() {
        const form = $('#leadForm');
        const feedback = $('#form-feedback');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = form.querySelector('button');
            const lead = {
                nome: $('#nome').value.trim(),
                email: $('#email').value.trim(),
                whatsapp: $('#telefone').value.trim(),
                assunto: $('#titulo').value.trim(),
                mensagem: $('#mensagem').value.trim(),
                origem: 'site',
            };
            if (!lead.nome || !lead.mensagem) {
                return mostrarFeedback('Preencha ao menos o nome e a mensagem.', 'erro');
            }

            const btnWhats = $('#whats-pos-lead');
            if (btnWhats) btnWhats.style.display = 'none'; // esconde de uma tentativa anterior, se houver

            btn.disabled = true;
            const textoOriginal = btn.innerText;
            btn.innerText = 'Enviando...';

            // Fonte da verdade: o banco (RLS permite INSERT anônimo)
            const { error } = await db.from('site_leads').insert([lead]);

            if (!error) {
                // Automação: n8n recebe o lead completo (notificação, CRM, funil...)
                dispararWebhook(config?.integracao?.webhookLeads, {
                    ...payloadBase('novo_lead'),
                    lead,
                });

                // Ponte pro WhatsApp: leva a mensagem que a pessoa já escreveu,
                // sem precisar digitar tudo de novo lá.
                if (btnWhats && config?.whats) {
                    const numero = config.whats.replace(/\D/g, '');
                    const texto = `Olá, meu nome é ${lead.nome}. Assunto: ${lead.assunto}. ${lead.mensagem}`;
                    btnWhats.href = `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
                    btnWhats.style.display = 'inline-flex';
                }

                form.reset();
                mostrarFeedback('Mensagem enviada com sucesso! Retornaremos em breve. ✔', 'sucesso');
            } else {
                mostrarFeedback('Não foi possível enviar agora. Fale conosco pelo WhatsApp.', 'erro');
            }
            btn.disabled = false;
            btn.innerText = textoOriginal;
        });

        function mostrarFeedback(texto, tipo) {
            feedback.textContent = texto;
            feedback.className = `form-feedback visivel ${tipo}`;
            setTimeout(() => feedback.classList.remove('visivel'), 6000);
        }
    }

    /* ==================================================================== */
    /* 5b) FORMULÁRIO DE AVALIAÇÃO PÚBLICA (entra pendente de aprovação)    */
    /* ==================================================================== */
    function ligarAvaliacoes() {
        const form = $('#form-avaliacao');
        if (!form) return; // seção pode não existir em versões antigas do template

        const estrelasEl = $('#av-estrelas');
        const feedback = $('#av-feedback');

        estrelasEl.addEventListener('click', (e) => {
            const valor = e.target.dataset.valor;
            if (!valor) return;
            estrelasEl.dataset.nota = valor;
            [...estrelasEl.children].forEach((star, i) => {
                star.classList.toggle('ativa', i < valor);
            });
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nota = Number(estrelasEl.dataset.nota || 0);
            const nome = $('#av-nome').value.trim();
            const texto = $('#av-texto').value.trim();

            if (!nome || !texto || nota < 1) {
                return mostrarFeedback('Preencha seu nome, o texto e escolha uma nota.', 'erro');
            }

            const btn = form.querySelector('button');
            btn.disabled = true;

            const { error } = await db.from('avaliacoes').insert([{ nome, texto, nota }]);

            if (!error) {
                form.reset();
                estrelasEl.dataset.nota = '0';
                [...estrelasEl.children].forEach(s => s.classList.remove('ativa'));
                mostrarFeedback('Obrigado! Sua avaliação foi enviada e aparecerá após aprovação. ✔', 'sucesso');
            } else {
                mostrarFeedback('Não foi possível enviar agora. Tente novamente em instantes.', 'erro');
            }
            btn.disabled = false;
        });

        function mostrarFeedback(texto, tipo) {
            feedback.textContent = texto;
            feedback.className = `av-feedback visivel ${tipo}`;
            setTimeout(() => feedback.classList.remove('visivel'), 6000);
        }
    }

    /* ==================================================================== */
    /* 6) SCROLL REVEAL — seções entram suavemente ao rolar                 */
    /* ==================================================================== */
    function ligarReveal() {
        const observador = new IntersectionObserver((entradas) => {
            entradas.forEach(ent => {
                if (ent.isIntersecting) {
                    ent.target.classList.add('visivel');
                    observador.unobserve(ent.target); // anima uma vez só
                }
            });
        }, { threshold: 0.12 });

        document.querySelectorAll('.reveal').forEach(el => observador.observe(el));

        // Cascata: numera os filhos das grades p/ o CSS escalonar os delays
        document.querySelectorAll('.cards-grid, .carrossel-trilha, .info-grid').forEach(grade => {
            [...grade.children].forEach((filho, i) => filho.style.setProperty('--i', i));
        });
    }

    /* ==================================================================== */
    /* 7) CARROSSEL — setas + rolagem suave para Espaço e Publicações       */
    /* ==================================================================== */
    function ligarCarrosseis() {
        document.querySelectorAll('[data-carrossel]').forEach(carrossel => {
            const trilha = carrossel.querySelector('.carrossel-trilha');
            const esq = carrossel.querySelector('.esquerda');
            const dir = carrossel.querySelector('.direita');

            // Passo = largura de 1 item + gap (rola de card em card)
            const passo = () => {
                const item = trilha.firstElementChild;
                return item ? item.getBoundingClientRect().width + 20 : 320;
            };
            esq.addEventListener('click', () => trilha.scrollBy({ left: -passo(), behavior: 'smooth' }));
            dir.addEventListener('click', () => trilha.scrollBy({ left: passo(), behavior: 'smooth' }));

            // Setas só existem se houver overflow; desabilitam nas pontas
            const atualizar = () => {
                const temOverflow = trilha.scrollWidth > trilha.clientWidth + 4;
                carrossel.classList.toggle('tem-overflow', temOverflow);
                esq.disabled = trilha.scrollLeft <= 4;
                dir.disabled = trilha.scrollLeft + trilha.clientWidth >= trilha.scrollWidth - 4;
            };
            trilha.addEventListener('scroll', atualizar, { passive: true });
            window.addEventListener('resize', atualizar);
            // Conteúdo chega dinamicamente (config da nuvem) → reavalia sozinho
            new MutationObserver(atualizar).observe(trilha, { childList: true });
            atualizar();
        });
    }

    /* ==================================================================== */
    /* INICIALIZAÇÃO                                                        */
    /* ==================================================================== */
    async function iniciar() {
        await carregarConfig();

        if (config) {
            ThemeEngine.aplicar(config.aparencia);   // cores + fontes do Admin
            AudioEngine.configurar(config.audio);    // liga/desliga + pacote
            aplicarConteudo(config);
            aplicarLayout(config.layout);
        } else {
            ThemeEngine.aplicar(null);               // sem nuvem e sem cache: tema padrão
        }

        AudioEngine.ligarNoDom();                    // sons (se ativos no Admin)
        registrarVisita();                           // contabiliza a visita, sem travar nada
        ligarRastreioDeCliques();
        ligarFormulario();
        ligarAvaliacoes();
        ligarReveal();
        ligarCarrosseis();

        document.body.classList.remove('carregando'); // "acende" o hero
    }

    // DOM pronto basta (não espera imagens) → primeira pintura mais rápida
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }

    /* --- Lightbox de fotos (clique para ampliar) --- */
    (() => {
        const overlay = document.createElement('div');
        overlay.className = 'lightbox-overlay';
        overlay.innerHTML = `<button type="button" class="lightbox-fechar" aria-label="Fechar">&times;</button>
            <img class="lightbox-img" alt="">`;
        document.body.appendChild(overlay);
        const imgEl = overlay.querySelector('.lightbox-img');

        function abrir(src, alt) {
            imgEl.src = src;
            imgEl.alt = alt || '';
            overlay.classList.add('ativo');
            document.body.style.overflow = 'hidden';
        }
        function fechar() {
            overlay.classList.remove('ativo');
            document.body.style.overflow = '';
        }

        document.addEventListener('click', (e) => {
            const alvo = e.target.closest('[data-fullsrc]');
            if (alvo) { abrir(alvo.dataset.fullsrc, alvo.querySelector('img')?.alt); return; }
            if (e.target === overlay || e.target.closest('.lightbox-fechar')) fechar();
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
    })();
})();

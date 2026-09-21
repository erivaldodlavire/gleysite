/* ============================================================================
 * PWA.JS — registro do service worker + botão "Instalar app" (mesmo p/ todos)
 * ============================================================================
 * Usado por index.html (site) e admin.html (painel). Qualquer elemento com o
 * atributo `data-pwa-instalar` (e `hidden`) vira o botão de instalar:
 *   - Chrome/Edge/Android: aparece quando o navegador diz que dá para instalar
 *     (evento beforeinstallprompt) e abre a janela de instalação ao clicar.
 *   - iPhone/iPad (Safari não tem esse evento): aparece e mostra a dica
 *     "Compartilhar → Adicionar à Tela de Início".
 *   - Já instalado / rodando como app: o botão nunca aparece.
 * ========================================================================== */
(function () {
    'use strict';

    // ---------- 1) Service worker ----------
    // Só existe em HTTPS (ou localhost). updateViaCache:'none' = o navegador
    // sempre confere se o sw.js mudou (não fica preso numa versão velha).
    const ambienteSeguro = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
    if ('serviceWorker' in navigator && ambienteSeguro) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
                .catch((erro) => console.warn('[PWA] service worker não registrado:', erro));
        });
    }

    // ---------- 2) Cor da barra do app = cor principal do tema ----------
    // O tema (theme-engine) troca --primary via style no <html>; acompanhamos.
    let metaCor = document.querySelector('meta[name="theme-color"]');
    if (!metaCor) {
        metaCor = document.createElement('meta');
        metaCor.name = 'theme-color';
        document.head.appendChild(metaCor);
    }
    const sincronizarCor = () => {
        const cor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
        if (cor) metaCor.content = cor;
    };
    sincronizarCor();
    new MutationObserver(sincronizarCor).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

    // ---------- 3) Botão "Instalar app" ----------
    const jaInstalado = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let eventoInstalar = null;

    const botoes = () => document.querySelectorAll('[data-pwa-instalar]');
    const mostrar = (visivel) => botoes().forEach((b) => { b.hidden = !visivel; });

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();          // guarda o evento para abrir só no clique do usuário
        eventoInstalar = e;
        if (!jaInstalado) mostrar(true);
    });
    window.addEventListener('appinstalled', () => { eventoInstalar = null; mostrar(false); });
    document.addEventListener('DOMContentLoaded', () => { if (ehIOS && !jaInstalado) mostrar(true); });

    // Cartão simples com a instrução do iPhone (estilo próprio: funciona em qualquer página).
    function dicaIOS() {
        if (document.getElementById('pwa-dica-ios')) return;
        const estilo = document.createElement('style');
        estilo.textContent = `
            #pwa-dica-ios { position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 5000;
                background: #fff; color: #1c2733; border-radius: 14px; padding: 16px 44px 16px 16px;
                box-shadow: 0 10px 40px rgba(0,0,0,.35); font: 500 0.92rem/1.5 system-ui, sans-serif; }
            #pwa-dica-ios strong { display: block; margin-bottom: 4px; }
            #pwa-dica-ios button { position: absolute; top: 4px; right: 4px; width: 44px; height: 44px;
                border: 0; background: none; font-size: 1.6rem; line-height: 1; cursor: pointer; color: #5a6472; }`;
        const caixa = document.createElement('div');
        caixa.id = 'pwa-dica-ios';
        caixa.setAttribute('role', 'dialog');
        caixa.setAttribute('aria-label', 'Como instalar o app');
        caixa.innerHTML = `<strong>Instalar no iPhone</strong>
            Toque em <b>Compartilhar</b> (o quadrado com a seta para cima) e depois em <b>“Adicionar à Tela de Início”</b>.
            <button type="button" aria-label="Fechar">&times;</button>`;
        caixa.querySelector('button').addEventListener('click', () => { caixa.remove(); estilo.remove(); });
        document.head.appendChild(estilo);
        document.body.appendChild(caixa);
    }

    document.addEventListener('click', async (e) => {
        if (!e.target.closest('[data-pwa-instalar]')) return;
        e.preventDefault();
        if (eventoInstalar) {
            eventoInstalar.prompt();
            const { outcome } = await eventoInstalar.userChoice;
            eventoInstalar = null;
            if (outcome === 'accepted') mostrar(false);
        } else if (ehIOS) {
            dicaIOS();
        }
    });

    // O atributo hidden perde para regras de display do CSS do site; garantimos.
    const regra = document.createElement('style');
    regra.textContent = '[data-pwa-instalar][hidden]{display:none!important}';
    document.head.appendChild(regra);
})();

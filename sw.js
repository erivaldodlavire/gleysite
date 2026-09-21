/* ============================================================================
 * SW.JS — Service Worker do PWA (mesmo arquivo para todos os clientes)
 * ============================================================================
 * Objetivo: permitir instalar o site/painel como app SEM criar os problemas
 * clássicos de service worker (site preso em versão velha, dados desatualizados).
 *
 * REGRAS DE SEGURANÇA (não remover):
 *  1. Só mexe em requisições GET do MESMO domínio. Supabase (dados e login),
 *     CDNs, Google Fonts etc. são de outro domínio: passam direto, NUNCA são
 *     guardados aqui. Nenhum dado de cliente/lead/sessão entra em cache.
 *  2. HTML/CSS/JS/manifest usam REDE PRIMEIRO: sempre busca a versão nova no
 *     servidor; o cache só serve se estiver sem internet. Assim uma publicação
 *     nova aparece na hora (o Nginx já manda no-cache — isto respeita).
 *  3. Imagens/fontes usam "velho e atualiza": abre rápido e se renova sozinho.
 *  4. Respostas com Cache-Control: no-store nunca são guardadas.
 *
 * PARA FORÇAR LIMPEZA GERAL: troque VERSAO abaixo. No próximo acesso o worker
 * novo apaga todos os caches antigos.
 * ========================================================================== */
'use strict';

const VERSAO = 'v1';
const CACHE_PAGINAS = `pwa-paginas-${VERSAO}`;
const CACHE_ASSETS = `pwa-assets-${VERSAO}`;
const MAX_ASSETS = 60;
const URL_OFFLINE = new URL('offline.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
    // Guarda só a página "sem conexão". cache:'reload' ignora cache HTTP velho.
    event.waitUntil(
        caches.open(CACHE_PAGINAS)
            .then((cache) => cache.add(new Request(URL_OFFLINE, { cache: 'reload' })))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // Apaga caches de versões anteriores deste worker.
        for (const nome of await caches.keys()) {
            if (nome.startsWith('pwa-') && nome !== CACHE_PAGINAS && nome !== CACHE_ASSETS) {
                await caches.delete(nome);
            }
        }
        await self.clients.claim();
    })());
});

// Só respostas normais, completas e sem "no-store" podem ser guardadas.
function guardavel(resp) {
    return resp && resp.status === 200 && resp.type === 'basic'
        && !/no-store/i.test(resp.headers.get('Cache-Control') || '');
}

async function redePrimeiro(req) {
    const cache = await caches.open(CACHE_PAGINAS);
    try {
        const resp = await fetch(req);
        if (guardavel(resp)) cache.put(req, resp.clone());
        return resp;
    } catch (erro) {
        // Sem internet: usa a cópia guardada (ignora ?voltar=... nas páginas).
        const guardada = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
        if (guardada) return guardada;
        if (req.mode === 'navigate') {
            const offline = await cache.match(URL_OFFLINE);
            if (offline) return offline;
        }
        throw erro;
    }
}

async function limitar(cache, max) {
    const chaves = await cache.keys();
    for (let i = 0; i < chaves.length - max; i++) await cache.delete(chaves[i]);
}

function velhoEAtualiza(event) {
    const req = event.request;
    const resposta = (async () => {
        const cache = await caches.open(CACHE_ASSETS);
        const guardada = await cache.match(req);
        const rede = fetch(req).then(async (resp) => {
            if (guardavel(resp)) { await cache.put(req, resp.clone()); await limitar(cache, MAX_ASSETS); }
            return resp;
        }).catch(() => null);
        if (guardada) { event.waitUntil(rede); return guardada; }
        return (await rede) || Response.error();
    })();
    return resposta;
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || req.headers.has('range')) return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;          // regra 1: só o próprio domínio
    if (url.pathname.endsWith('/sw.js')) return;             // o navegador cuida da atualização do worker

    const tipo = req.destination;
    const ehPagina = req.mode === 'navigate'
        || ['document', 'script', 'style', 'manifest'].includes(tipo)
        || /\.(html|js|css|webmanifest|json)$/i.test(url.pathname);

    if (ehPagina) { event.respondWith(redePrimeiro(req)); return; }
    if (['image', 'font'].includes(tipo)) { event.respondWith(velhoEAtualiza(event)); }
});

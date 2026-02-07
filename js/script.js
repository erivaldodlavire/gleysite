window.onload = function() {
    const data = JSON.parse(localStorage.getItem('siteData'));
    if (!data) return;

    // 1. Geral
    document.body.className = data.tema;
    if(data.nome) {
        document.getElementById('edit-nome').innerText = data.nome;
        document.getElementById('edit-header-nome').innerText = data.nome;
    }
    if(data.sobre) document.getElementById('edit-sobre-texto').innerText = data.sobre;
    if(data.endereco) document.getElementById('edit-endereco').innerText = data.endereco;

    // 2. Fotos do Espaço
    for(let i=1; i<=3; i++) {
        const img = document.getElementById(`img-espaco-${i}`);
        if(img && data.fotos[`f${i}`]) img.src = data.fotos[`f${i}`];
    }

    // 3. Áreas de Atuação Dinâmicas
    if(data.areas && data.areas.length > 0) {
        const container = document.getElementById('container-servicos');
        if(container) {
            container.innerHTML = data.areas.map(a => `
                <div class="card">
                    <i class="${a.icone} gold-3d"></i>
                    <h3>${a.titulo}</h3>
                    <p>${a.desc}</p>
                </div>
            `).join('');
        }
    }

    // 4. Redes Sociais Automáticas (Lógica de Ícone)
    const getIcon = (u) => {
        if(u.includes('instagram')) return 'fab fa-instagram';
        if(u.includes('youtube')) return 'fab fa-youtube';
        if(u.includes('whatsapp') || u.includes('wa.me')) return 'fab fa-whatsapp';
        if(u.includes('facebook')) return 'fab fa-facebook';
        return 'fas fa-link';
    };

    // Divide os 10 links: 5 para contato, 5 para rodapé
    const contatoArea = document.getElementById('edit-redes-sociais-icones');
    if(contatoArea) {
        contatoArea.innerHTML = data.redes.slice(0,5).filter(l => l !== '').map(l => `
            <a href="${l}" target="_blank" class="icon-3d"><i class="${getIcon(l)}"></i></a>
        `).join('');
    }

    // 5. Publicações (YouTube e Instagram)
    const pubArea = document.getElementById('container-publicacoes');
    if(pubArea && data.pubs) {
        pubArea.innerHTML = data.pubs.filter(p => p.link !== '').map(p => `
            <div class="pub-container">
                <p class="pub-desc">${p.desc}</p>
                <div class="pub-item">
                    <a href="${p.link}" target="_blank">
                        ${p.link.includes('instagram') 
                            ? `<div class="insta-placeholder"><i class="fab fa-instagram"></i> Ver no Instagram</div>`
                            : `<img src="https://img.youtube.com/vi/${p.link.split('v=')[1]}/hqdefault.jpg"><div class="play-overlay"><i class="fab fa-youtube"></i></div>`}
                    </a>
                </div>
            </div>
        `).join('');
    }
};
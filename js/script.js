window.onload = function() {
    const data = JSON.parse(localStorage.getItem('siteData'));
    if (!data) return;

    // 1. Aplicar Tema e Cabeçalho
    document.body.className = data.tema;
    if(data.nome) {
        document.getElementById('edit-nome').innerText = data.nome;
        document.getElementById('edit-header-nome').innerText = data.nome;
    }
    if(data.oab) document.getElementById('edit-oab').innerText = data.oab;
    if(data.slogan) document.getElementById('edit-slogan').innerText = data.slogan;
    if(data.sobre) document.getElementById('edit-sobre-texto').innerText = data.sobre;

    // 2. Aplicar Contatos e Rodapé
    if(data.endereco) document.getElementById('edit-endereco').innerText = data.endereco;
    if(data.tel) document.getElementById('edit-telefone').innerText = data.tel;
    if(data.email) document.getElementById('edit-email').innerText = data.email;
    if(data.horario) document.getElementById('edit-horario').innerText = data.horario;
    if(data.copy) document.getElementById('edit-copyright').innerText = data.copy;

    // 3. Fotos com Suporte a PNG (Base64)
    for(let i=1; i<=3; i++) {
        const img = document.getElementById(`img-espaco-${i}`);
        if(img && data.fotos[`f${i}`]) img.src = data.fotos[`f${i}`];
    }

    // 4. Áreas de Atuação Dinâmicas (Espelho do Padrão)
    if(data.areas && data.areas.length > 0) {
        const container = document.getElementById('container-servicos');
        if(container) {
            container.innerHTML = data.areas.map(a => `
                <div class="card">
                    <i class="${a.i} gold-3d"></i>
                    <h3>${a.t}</h3>
                    <p>${a.d}</p>
                </div>`).join('');
        }
    }

    // 5. Redes Sociais e Publicações (Auto-Icone)
    const getIcon = (u) => {
        if(u.includes('instagram')) return 'fab fa-instagram';
        if(u.includes('youtube')) return 'fab fa-youtube';
        if(u.includes('whatsapp') || u.includes('wa.me')) return 'fab fa-whatsapp';
        if(u.includes('linkedin')) return 'fab fa-linkedin';
        return 'fas fa-link';
    };

    const redesArea = document.getElementById('edit-redes-sociais-icones');
    const footerRedes = document.getElementById('edit-social-links-footer');
    
    const redesHTML = data.redes.filter(l => l !== '').map(l => `
        <a href="${l}" target="_blank" class="icon-3d"><i class="${getIcon(l)}"></i></a>`).join('');
    
    if(redesArea) redesArea.innerHTML = redesHTML;
    if(footerRedes) footerRedes.innerHTML = redesHTML;

    // Publicações YT/Insta
    const pubArea = document.getElementById('container-publicacoes');
    if(pubArea) {
        pubArea.innerHTML = data.pubs.filter(p => p.l !== '').map(p => `
            <div class="pub-container">
                <p class="pub-desc">${p.d}</p>
                <div class="pub-item">
                    <a href="${p.l}" target="_blank">
                        ${p.l.includes('instagram') 
                            ? `<div class="insta-placeholder"><i class="fab fa-instagram"></i> Ver no Instagram</div>`
                            : `<img src="https://img.youtube.com/vi/${p.l.split('v=')[1]}/hqdefault.jpg"><div class="play-overlay"><i class="fab fa-youtube"></i></div>`}
                    </a>
                </div>
            </div>`).join('');
    }
};
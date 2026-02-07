window.onload = function() {
    const data = JSON.parse(localStorage.getItem('siteData'));
    if (!data) return;

    // 1. Tema e Sobre Mim
    document.body.className = data.tema;
    if(data.sobre) document.getElementById('edit-sobre-texto').innerText = data.sobre;

    // 2. Fotos do Espaço (Upload Local)
    if(data.fotos.f1) document.getElementById('img-espaco-1').src = data.fotos.f1;
    if(data.fotos.f2) document.getElementById('img-espaco-2').src = data.fotos.f2;
    if(data.fotos.f3) document.getElementById('img-espaco-3').src = data.fotos.f3;

    // 3. Contatos e Rodapé
    if(data.email) document.getElementById('edit-email').innerText = data.email;
    if(data.horario) document.getElementById('edit-horario').innerText = data.horario;
    if(data.endereco) document.getElementById('edit-endereco').innerText = data.endereco;
    if(data.copy) document.getElementById('edit-copyright').innerText = data.copy;

    // 4. Áreas de Atuação Dinâmicas
    if(data.areas && data.areas.length > 0) {
        const container = document.getElementById('container-servicos');
        container.innerHTML = data.areas.map(a => `
            <div class="card">
                <i class="${a.icone} gold-3d"></i>
                <h3>${a.titulo}</h3>
            </div>
        `).join('');
    }

    // 5. Publicações Dinâmicas (YouTube/Instagram)
    if(data.pubs && data.pubs.length > 0) {
        const pubContainer = document.getElementById('container-publicacoes');
        pubContainer.innerHTML = data.pubs.map(p => {
            const isInsta = p.link.includes('instagram');
            return `
                <div class="pub-container">
                    <p class="pub-desc">${p.desc}</p>
                    <div class="pub-item">
                        <a href="${p.link}" target="_blank">
                            ${isInsta ? `<div class="insta-placeholder"><i class="fab fa-instagram"></i> Ver no Instagram</div>` 
                                      : `<img src="https://img.youtube.com/vi/${p.link.split('v=')[1]}/hqdefault.jpg">
                                         <div class="play-overlay"><i class="fab fa-youtube"></i></div>`}
                        </a>
                    </div>
                </div>`;
        }).join('');
    }
};
window.onload = function() {
    const data = JSON.parse(localStorage.getItem('siteData'));
    if (!data) return;

    // 1. Identidade e Textos
    document.body.className = data.tema;
    if(data.nome) {
        document.getElementById('edit-nome').innerText = data.nome;
        document.getElementById('edit-header-nome').innerText = data.nome;
    }
    if(data.oab) document.getElementById('edit-oab').innerText = data.oab;
    if(data.slogan) document.getElementById('edit-slogan').innerText = data.slogan;
    if(data.sobre) document.getElementById('edit-sobre-texto').innerText = data.sobre;
    
    // Contatos Individuais
    if(data.endereco) document.getElementById('edit-endereco').innerText = data.endereco;
    if(data.tel) document.getElementById('edit-telefone').innerText = data.tel;
    if(data.email) document.getElementById('edit-email').innerText = data.email;
    if(data.horario) document.getElementById('edit-horario').innerText = data.horario;
    if(data.copy) document.getElementById('edit-copyright').innerText = data.copy;

    // 2. Fotos do Espaço (Garante suporte a PNG/JPG)
    for(let i=1; i<=3; i++) {
        const img = document.getElementById(`img-espaco-${i}`);
        if(img && data.fotos[`f${i}`]) img.src = data.fotos[`f${i}`];
    }

    // 3. Gerador Automático de Ícones Sociais
    const getIcon = (url) => {
        if(url.includes('wa.me') || url.includes('api.whatsapp')) return 'fab fa-whatsapp';
        if(url.includes('instagram')) return 'fab fa-instagram';
        if(url.includes('facebook')) return 'fab fa-facebook';
        if(url.includes('youtube')) return 'fab fa-youtube';
        if(url.includes('linkedin')) return 'fab fa-linkedin';
        if(url.includes('x.com')) return 'fab fa-x-twitter';
        return 'fas fa-link';
    };

    // Aplicar nas Redes Sociais do Contato
    const contatoArea = document.getElementById('edit-redes-sociais-icones');
    if(contatoArea && data.redesContato) {
        contatoArea.innerHTML = data.redesContato.filter(link => link !== '').map(link => `
            <a href="${link}" target="_blank" class="icon-3d"><i class="${getIcon(link)}"></i></a>
        `).join('');
    }

    // Aplicar nas Redes Sociais do Rodapé
    const footerArea = document.getElementById('edit-social-links-footer');
    if(footerArea && data.redesFooter) {
        footerArea.innerHTML = data.redesFooter.filter(link => link !== '').map(link => `
            <a href="${link}" target="_blank" class="icon-3d"><i class="${getIcon(link)}"></i></a>
        `).join('');
    }
};
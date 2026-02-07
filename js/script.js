window.onload = function() {
    const data = JSON.parse(localStorage.getItem('siteData'));
    if (!data) return;

    // 1. Aplica o Tema e Textos
    document.body.className = data.tema;
    if(data.nome) {
        document.getElementById('edit-nome').innerText = data.nome;
        document.getElementById('edit-header-nome').innerText = data.nome;
    }
    if(data.sobre) document.getElementById('edit-sobre-texto').innerText = data.sobre;
    if(data.email) document.getElementById('edit-email').innerText = data.email;

    // 2. Fotos do Espaço (Upload Local)
    if(data.fotos.f1) document.getElementById('img-espaco-1').src = data.fotos.f1;
    if(data.fotos.f2) document.getElementById('img-espaco-2').src = data.fotos.f2;
    if(data.fotos.f3) document.getElementById('img-espaco-3').src = data.fotos.f3;

    // 3. WhatsApp Dinâmico
    if(data.whatsapp) {
        const link = `https://api.whatsapp.com/send/?phone=${data.whatsapp}`;
        document.getElementById('edit-link-whatsapp').href = link;
    }
};
// FUNÇÃO QUE APLICA AS MUDANÇAS DO ADMIN AO CARREGAR O SITE
window.onload = function() {
    const savedData = JSON.parse(localStorage.getItem('siteData'));

    if (savedData) {
        // 1. Aplica o Tema (Muda a classe do body)
        document.body.className = savedData.tema;

        // 2. Aplica os Textos Principais
        if(savedData.nome) {
            document.getElementById('edit-nome').innerText = savedData.nome;
            document.getElementById('edit-header-nome').innerText = savedData.nome;
        }
        if(savedData.oab) document.getElementById('edit-oab').innerText = savedData.oab;
        if(savedData.slogan) document.getElementById('edit-slogan').innerText = savedData.slogan;
        
        // 3. Aplica Links de Contato
        if(savedData.whatsapp) {
            const waLink = `https://api.whatsapp.com/send/?phone=${savedData.whatsapp}`;
            document.getElementById('edit-link-whatsapp').href = waLink;
        }
        
        // 4. Aplica Endereço
        if(savedData.endereco) {
            document.getElementById('edit-endereco').innerHTML = savedData.endereco;
        }
    }
};

// FUNÇÃO PARA ENVIAR LEAD (OPCIONAL)
function enviarLead(event) {
    event.preventDefault();
    alert('Mensagem enviada com sucesso! Em breve entraremos em contato.');
}
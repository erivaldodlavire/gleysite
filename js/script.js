// 1. Aplica o tema salvo no Admin
document.addEventListener('DOMContentLoaded', () => {
    const temaSalvo = localStorage.getItem('temaEscolhido') || 'advogado';
    document.documentElement.setAttribute('data-theme', temaSalvo);
});

// 2. Integração com n8n (Industrial Automation Style)
async function enviarParaN8N(event) {
    event.preventDefault();
    const dados = {
        nome: document.getElementById('nome').value,
        email: document.getElementById('email').value,
        mensagem: document.getElementById('mensagem').value,
        data: new Date().toISOString()
    };

    try {
        const response = await fetch('SUA_URL_WEBHOOK_N8N', {
            method: 'POST',
            body: JSON.stringify(dados),
            headers: {'Content-Type': 'application/json'}
        });
        if(response.ok) alert('Dra. Gleyciane recebeu sua mensagem!');
    } catch (error) {
        console.error('Erro ao conectar com n8n/SQL', error);
    }
}
function enviarLead(event) {
    event.preventDefault();
    
    const nome = document.getElementById('nome').value;
    const email = document.getElementById('email').value;
    const telefone = document.getElementById('telefone').value;
    const titulo = document.getElementById('titulo').value;
    const mensagem = document.getElementById('mensagem').value;

    // Formata a mensagem para o WhatsApp
    const textoParaWhats = `Olá Dra. Gleyciane! Me chamo ${nome}.%0A%0A*Assunto:* ${titulo}%0A*Telefone:* ${telefone}%0A*E-mail:* ${email}%0A%0A*Mensagem:* ${mensagem}`;
    
    // Abre o WhatsApp da advogada com a mensagem preenchida
    const linkZap = `https://api.whatsapp.com/send?phone=5519971284797&text=${textoParaWhats}`;
    
    window.open(linkZap, '_blank');
    
    // Aqui no futuro adicionamos a chamada fetch('SEU_WEBHOOK_N8N') para enviar ao SQL e E-mail
    alert('Redirecionando para o WhatsApp para concluir o atendimento!');
}
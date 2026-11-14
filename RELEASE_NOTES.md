## Novidades

**App do Windows**
- **Instalador e versão portátil:** novo `PokeIdleManager-Setup.exe` na Release, que instala sem pedir administrador, e um `PokeIdleManager-portatil.zip` para usar sem instalar. Os dois já trazem tudo: não precisa de Git, Python nem Node.
- **Bandeja do sistema:** o bot roda com um ícone perto do relógio, com "Abrir o painel" e "Sair". Dá para iniciar junto com o Windows.
- **Atualização com um clique:** o painel avisa quando sai versão nova, baixa o instalador, confere o arquivo e atualiza sozinho. Suas contas ficam em `%LOCALAPPDATA%\PokeIdleManager` e não são tocadas.
- **Acesso de longe:** o app escuta na rede, então funciona direto pelo IP do Tailscale (ou da sua rede local). O painel pede senha, e quem está no próprio PC cria a senha sem código. Para deixar só neste PC, use `TELEMETRY_HOST=127.0.0.1` no `.env` da pasta do app.

**Contas**
- **Entrar com o jogo:** em Configurações, Adicionar conta, a nova aba "Entrar com o jogo" abre o jogo numa janela. Você entra na conta como de costume (e-mail, Discord ou Google) e o painel lê a sessão sozinho, sem copiar token. Disponível no app do Windows; na VPS e no navegador continua o favorito.
- **Token fora do painel:** a sessão lida pela janela fica só no servidor do bot e nunca volta para a tela.

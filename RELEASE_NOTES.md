## Novidades

**Melhor hunt voltou a funcionar**
- **O site da calculadora mudou de endereço:** a "Melhor hunt" da aba Mapa dava erro ("Failed to fetch dynamically imported module") porque o PokéIdle Hub saiu de `pokeidle-gg.pages.dev` e agora vive em `pokeidleguide.io`. O painel já aponta para o endereço novo.

**Menos bateria e menos dados (importante para quem roda no celular/Termux)**
- **O painel só recebe o que mudou:** antes o bot mandava o estado completo das contas (~11 KB) a cada segundo, mesmo sem mudança. Agora vai só o que mudou e, parado, uma batida de ~100 bytes a cada 4 s. O indicador "Ao vivo" continua igual.
- **Aba oculta, painel quase em repouso:** com a tela apagada ou o app em segundo plano, o bot manda uma atualização a cada 5 s e o painel para os relógios e as consultas (Mercado, Configurações, Mapa, PVP, Atualização). Ao voltar, tudo se atualiza na hora.
- **O bot dorme quando não há o que fazer:** a fila de hunt e o PVP deixaram de acordar o processo várias vezes por segundo (eram ~22 vezes por segundo com 4 contas paradas). Agora acordam só quando há trabalho.
- **Catálogo de hunts:** só consulta de novo a cada minuto depois de carregado, em vez de a cada 6 segundos.
- **Medição:** o log de status (a cada 30 s) agora mostra `frames=X/s`, o ritmo de mensagens que o jogo manda por conta.

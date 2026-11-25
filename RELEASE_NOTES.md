## Novidades

**Melhor hunt voltou a funcionar**
- **O site da calculadora mudou de endereço:** a "Melhor hunt" da aba Mapa dava erro ("Failed to fetch dynamically imported module") porque o PokéIdle Hub saiu de `pokeidle-gg.pages.dev` e agora vive em `pokeidleguide.io`. O painel já aponta para o endereço novo.

**Novo: Modo economia (menos bateria e menos dados, ideal para celular/Termux)**
- **Opcional e desligado por padrão:** em Configurações > Bateria e dados, marque "Modo economia". Desligado, o painel e o bot funcionam exatamente como antes.
- **O painel só recebe o que mudou:** em vez do estado completo das contas (~11 KB) a cada segundo, vai só o que mudou e, parado, uma batida de ~100 bytes a cada 4 s. O indicador "Ao vivo" continua igual.
- **Aba oculta, painel em repouso:** com a tela apagada ou o app em segundo plano, o bot manda uma atualização a cada 5 s e o painel para os relógios e as consultas (Mercado, Configurações, Mapa, PVP, Atualização). Ao voltar, tudo se atualiza na hora.
- **O bot dorme quando não há o que fazer:** a fila de hunt e o PVP deixam de acordar o processo várias vezes por segundo (eram ~22 vezes por segundo com 4 contas paradas). O catálogo de hunts só é consultado de novo a cada minuto.
- **Liga e desliga na hora,** sem reiniciar o bot.

**Medição**
- O log de status (a cada 30 s) agora mostra `frames=X/s`, o ritmo de mensagens que o jogo manda por conta.

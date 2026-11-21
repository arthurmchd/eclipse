---
tipo: decisão
status: aceita
data: 2026-11-21
tags: [adr, segurança, rede, distribuição]
---

# ADR-045 Atualização pelo GitHub

## Contexto

Pedido do usuário: deixar o Eclipse pronto para muita gente usar. Hoje cada versão nova só chega a quem baixa o Setup de novo pelo GitHub. Quando a Riot muda a tela de login, quem não atualiza fica com o login quebrado, e o aviso do [[riotVersion]] só diz para procurar uma atualização. Sem um caminho de atualização, uma correção leva semanas para chegar a todos.

Atualizar sozinho também é perigoso: um Setup trocado no caminho, ou num GitHub invadido, rodaria código de outra pessoa no PC de cada usuário, com acesso às contas salvas.

## Decisão

O Eclipse usa o `tauri-plugin-updater` com os releases do GitHub do projeto (`arthurmchd/eclipse`):

- **Pergunta.** Um minuto depois de abrir e depois a cada 12 horas, o Eclipse baixa `https://github.com/arthurmchd/eclipse/releases/latest/download/latest.json`. O GitHub recebe o IP e o pedido do arquivo; nada de conta, Riot ID ou versão vai junto.
- **Aviso.** Se o arquivo diz que há versão mais nova, aparece um balão do Windows e um item "Atualizar para a versão X" na bandeja. A versão só é mostrada se tiver o formato `número.número.número`.
- **Só com clique.** O Eclipse nunca instala sozinho. Só o clique no item da bandeja baixa e roda o Setup novo, com a barra de progresso do instalador e sem perguntas, e o Eclipse reabre na versão nova. Com um login em andamento, o clique é recusado com um aviso.
- **Assinatura obrigatória.** Cada Setup publicado leva uma assinatura feita com uma chave privada que fica só no PC do usuário (`%USERPROFILE%\.tauri\eclipse-updater.key`), fora do repositório. A chave pública vai no `tauri.conf.json`. O plugin recusa um Setup cuja assinatura não confere com ela, mesmo vindo do endereço certo.
- **Desligável.** "Procurar atualizações" na bandeja, ligado por padrão, guardado nas configurações (`updateChecks`). Desligado, o Eclipse não fala com o GitHub.
- **Saída limpa.** Antes de rodar o Setup, o Eclipse para os serviços como no "Sair" da bandeja, para o observador devolver a animação da Riot e o armazenamento não ficar no meio de uma gravação.

## Alternativas consideradas

- **Instalar sozinho em segundo plano:** atualiza todos mais rápido, mas fecharia o Eclipse sem aviso, talvez no meio de um login, e tira do usuário a escolha.
- **Só avisar e abrir a página do release:** sem chave para guardar, mas cada usuário teria de baixar e passar pelo aviso do SmartScreen de novo, e a maioria não atualiza.
- **Servidor próprio de atualização:** mais controle, mas custo e mais um serviço para manter. Os releases do GitHub já são onde o Setup é publicado.
- **Sem assinatura, só HTTPS:** protege o caminho, mas não um release trocado no GitHub.

## Consequências

- Uma correção publicada chega a todos que clicarem no aviso, sem baixar nada à mão.
- **A chave privada vira um ponto único.** Perdida, nenhum Eclipse instalado aceita atualizações novas, e todos teriam de baixar o Setup à mão uma vez. Vazada, alguém poderia assinar um Setup falso. O usuário guarda uma cópia fora do PC e nunca a põe no repositório.
- **Publicar muda.** O `cargo tauri build` passa a gerar também o `.sig` do Setup, e precisa da chave nas variáveis `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. O release leva o Setup, o `.sig` e o `latest.json`, gerado por `scripts/release/latest-json.js` ([[Publicar no GitHub]]).
- **Mais um serviço externo.** O GitHub vê o IP de quem usa o Eclipse a cada 12 horas, e só com a opção ligada ([[Segurança e privacidade]]).
- A resposta do GitHub é tratada como não confiável: o plugin confere a assinatura antes de rodar qualquer coisa, e o Eclipse só mostra a versão se tiver o formato esperado.
- O Setup ainda não tem assinatura de código da Microsoft, então o SmartScreen continua avisando no primeiro download. A atualização pelo plugin não passa pelo navegador e não mostra esse aviso.

## Relacionado

- [[updates]]
- [[appUpdater]]
- [[Segurança e privacidade]]
- [[Publicar no GitHub]]
- [[ADR-030 Eclipse instalado por um Setup próprio]]

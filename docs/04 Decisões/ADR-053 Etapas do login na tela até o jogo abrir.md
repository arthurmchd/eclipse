---
tipo: decisão
status: aceita
data: 2026-11-25
tags: [adr, interface, login, janelas]
---

# ADR-053 Etapas do login na tela até o jogo abrir

Revisa [[ADR-024 Coluna de login coberta durante o login]] e [[ADR-012 Sobreposição presa à janela do Riot]].

## Contexto

Pedido do usuário em 2026-11-25, depois de comparar com o Tariolle/LeagueAccounts:

> teria como fazer que o eclipse sempre estivesse na tela ate o jogo abrir? tipo eu cliquei para abrir o lol com x conta ai a barra lateral de login tem aquele icone de carregando né? ai ao inves de ter esse icone carregando teriamos uma lista de coisas que esta acontecendo

> ai eu so conseguiria entrar realmente na interface da riot se eu fechasse o eclipse ou fizesse login na riot

Hoje, durante um login pelo Eclipse:

- **Antes de a conta entrar**, a coluna de login fica coberta pelo [[overlayCover]], com um anel girando e nada mais.
- **Depois que a conta entra** (`signedIn`), a sobreposição inteira some e a tela inicial da Riot fica à mostra até o jogo abrir. Pelo [[Laboratório de velocidade do login]], são uns 20 s: cerca de 13 s até o pedido do jogo responder e 10,5 s até a janela do League aparecer.
- **Com sessão salva**, o [[signInFlow]] fecha a Riot com a saída normal e sobe só os serviços, sem janela. A sobreposição perde a janela dona e some logo no começo do login. O mesmo acontece no login visível quando outra conta está conectada: a Riot fecha e reabre, e os cartões somem nesse intervalo.

O fluxo já anuncia cada etapa por um texto de status, que chega aos cartões pela operação do [[signInService]]. Esses textos não aparecem na tela, e são texto livre, não etapas.

O LeagueAccounts mostra a lista de etapas do login até o jogo abrir. O jeito dele de entrar (uma janela da Riot com depurador) não foi adotado; o motivo está em [[Estudo - Gerenciadores no GitHub]].

## Decisão

### Lista de etapas no lugar do anel

A coluna de login coberta mostra quatro etapas fixas e o jogo pedido:

1. **Preparar a Riot**: fechar a outra conta, subir os serviços ou abrir o formulário.
2. **Entrar na conta**: sessão salva, API local ou formulário.
3. **Conferir a conta**: o Riot ID e a sessão do jogador.
4. **Abrir o jogo**: "Abrir o League of Legends", "Abrir o TFT" etc. Com o ícone da Riot, vira "Abrir a Riot".

Cada etapa aparece como feita, atual (com o anel) ou por vir. A etapa atual pode ter uma linha de detalhe, como "com a sessão salva", "Conclua a verificação na Riot" ou "O jogo está atualizando ou demorando para abrir". Uma etapa que o fluxo pula, como na conta já conectada, aparece como feita. A lista nunca anda para trás: quando a sessão salva é recusada e o fluxo volta a preparar o formulário, a etapa continua "Entrar na conta".

- **O fluxo manda a etapa, não só o texto.** Cada status do [[signInFlow]] passa a levar um código de uma lista fechada (`prepare`, `sign_in`, `verify`, `launch`, `done`). A operação do [[signInService]] leva esse código junto com o texto, que continua igual no `sign-in.log`.
- **A cobertura ganha JavaScript só para receber.** Desde a [[ADR-024 Coluna de login coberta durante o login]], ela roda com JavaScript desligado. Agora segue o modelo da caixa do [[overlayToggle]]: um script de início expõe só ouvintes, e o Rust entrega o idioma e o estado da lista por `eval`.
  - A cobertura não tem nenhum comando: nenhum `invoke` é aceito dela, e a página não chama nenhum.
  - Ela recebe só o código da etapa, o jogo e o detalhe já traduzido. Nada de conta, Riot ID, usuário ou senha.
  - Os textos entram por `textContent`. A CSP passa a permitir só o script local, além da folha de estilo.
- **Os rótulos das etapas ficam na página da cobertura**, em português e inglês, como os textos da caixa.

### O Eclipse fica na tela até o jogo abrir

- **Conta conectada não esconde mais a sobreposição durante uma operação.** Enquanto a operação está `running`, sem `needsAttention` e sem a etapa `done`, a sobreposição fica à vista sobre a janela da Riot: a lista na coluna e os cartões à direita. A tela inicial da Riot fica coberta. A regra antiga ("`signedIn` esconde tudo") continua valendo sem operação, ou seja, no login feito direto na Riot.
- **Sem janela da Riot, a sobreposição fica onde estava.** Se a janela da Riot some durante uma operação (sessão salva, troca de conta), a sobreposição continua na última posição e tamanho conhecidos, sem dono. Quando uma janela da Riot volta, o [[riotWindowObserver]] a prende de novo e ela segue a Riot como sempre. Nesse intervalo:
  - ela não é `alwaysOnTop`, então outros programas podem cobri-la;
  - não há arraste nem as cópias de minimizar e fechar da Riot ([[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]), porque não há janela da Riot para mover ou fechar;
  - cancelar continua pelo cartão da conta.
- **A sobreposição sai quando o jogo abre.** A etapa `done` chega com a janela do jogo à vista ("Game opened"), antes de o fluxo guardar a sessão e fechar a janela da Riot. Ali a sobreposição volta às regras normais.
- **Com o ícone da Riot** (só entrar, sem jogo), a operação termina com a Riot aberta e conectada, e a sobreposição some como hoje. É o único fim em que a interface da Riot aparece.

### O que continua tirando o Eclipse da frente

- **2FA, CAPTCHA e qualquer `needsAttention`** tiram a cobertura na hora, como na [[ADR-024 Coluna de login coberta durante o login]]. A regra da [[ADR-003 Sem contornar CAPTCHA ou 2FA]] não muda. Depois que a conta entra, um pedido da sessão do jogador (termos, Riot ID, região) também é `needsAttention` e também mostra a Riot.
- **Jogo recusado pela Riot** (acrescentado na 2.30.1). Quando a Riot recusa o pedido do jogo, por exemplo com os termos do jogo por aceitar (HTTP 464 `eula_not_accepted`), o fluxo manda `needsAttention` na etapa `launch` e mostra a janela da Riot. Na 2.30.0 a Riot ficava coberta e o usuário não via o pedido; o login só falhava depois de 180 s. Desde a 2.32.2, a recusa por termos é pedida de novo por até 20 s antes de mostrar a Riot, porque o log real mostrou que ela pode ser passageira logo depois do login ([[signInFlow]]).
- **Falha e cancelamento** encerram a operação. A sobreposição volta às regras normais, e o erro aparece nos cartões, como hoje.
- **Jogo demorando deixa de ser `needsAttention`.** O aviso "The game is taking longer to open or is updating" passa a ser o detalhe da etapa 4, com `signedIn`, sem tirar a cobertura. Antes ele revelava a Riot; o [[signInFlow]] já dizia que esse aviso não é desafio de autenticação.

### Escurecimento da Riot depois do login

O [[riotWindowObserver]] lê um ponto da coluna de login (`PANEL`) para saber se um aviso da Riot escureceu a tela ([[ADR-017 Cartões cedem a vez aos avisos da Riot]]), e a cobertura deixa um furo de 11 × 11 DIP nesse ponto. Na tela inicial da Riot, esse ponto não é o painel claro de login: o furo mostraria um quadradinho da Riot, e uma cor escura ali seria lida como aviso e esconderia o Eclipse.

- **Depois que a conta entra, o furo fecha.** Com `signedIn` na operação, a cobertura ocupa a coluna inteira, e o ponto lido passa a ser o fundo do próprio Eclipse.
- **Depois que a conta entra, os pedidos da Riot vêm do fluxo.** O que precisa do usuário nessa fase chega como `needsAttention` pela sessão do jogador. Um aviso desconhecido da Riot fica coberto até o prazo do fluxo acabar; aí a operação falha e a Riot aparece.

### Linha do tempo e logo da Riot (acrescentado na 2.31.0)

O usuário escolheu, entre seis opções desenhadas, a linha do tempo: etapas numeradas ligadas por uma linha, a feita com um resumo ("Riot pronta", "Conta conectada", "Riot ID conferido"), a atual com o texto do status em vermelho e a borda pulsando, e as próximas em cinza. Também pediu o logo da Riot "exatamente no mesmo lugar e tamanho" do Riot Client. O logo vem da instalação da própria Riot ([[riotLogo]]), nunca do Setup, e fica no ponto que o CSS da Riot dá à coluna de login (143,5 × 64, 113 × 32 numa coluna de 400).

### Cartões indisponíveis durante o login (acrescentado na 2.32.0)

Entre cinco exemplos (véu claro com aviso, desfoque escuro, tudo cinza com a conta em uso colorida, só a conta em uso, faixa no topo), o usuário escolheu o cinza com a conta em uso colorida. Os cartões já recusavam cliques durante o login; agora parecem indisponíveis, e o da conta em login fica destacado com o selo "Entrando…" ([[cards]]).

## Alternativas consideradas

- **Manter o anel e só mostrar o texto do status.** Os textos são livres, em inglês e mudam com o fluxo. Uma lista fixa diz onde o login está e quanto falta.
- **Desenhar a lista na página dos cartões.** Rejeitado pelo mesmo motivo da [[ADR-024 Coluna de login coberta durante o login]]: a página dos cartões começa em `cardsLeft`, e esticá-la para a coluna mistura a geometria da Riot com a dos cartões. A página dos cartões também recebe dados de conta, que a lista não precisa.
- **Uma janela de carregamento separada, fora da sobreposição.** Seria uma quarta janela com posição e escala próprias, e a lista pularia de lugar quando a Riot voltasse. Manter a sobreposição sem dono reaproveita o tamanho, a escala e os cantos que ela já tem.
- **Esconder a janela da Riot (`SW_HIDE`) em vez de cobrir.** O [[loginForm]] precisa da janela renderizando, e 2FA ou CAPTCHA precisam dela à vista. Já rejeitado na [[ADR-024 Coluna de login coberta durante o login]].
- **Sobreposição `alwaysOnTop` sem a Riot.** Ficaria acima de todos os programas, o que a [[ADR-012 Sobreposição presa à janela do Riot]] descartou.
- **Um botão Cancelar na lista.** Daria um comando à cobertura, que hoje não tem nenhum. Cancelar já existe no cartão da conta.

## Consequências

- O usuário vê onde o login está do clique até o jogo, inclusive com sessão salva, quando hoje a Riot fecha e não fica nada na tela.
- Durante um login pelo Eclipse, a interface da Riot só aparece quando a Riot precisa do usuário, no fim do login sem jogo ou quando o Eclipse fecha. Clicar na tela inicial da Riot deixa de ser possível nesse intervalo.
- A cobertura deixa de ser uma página sem script. Continua sem comandos e sem dados de conta, mas a [[Segurança e privacidade]] precisa registrar a mudança.
- Um aviso da Riot depois do login, que o fluxo não conhece, fica coberto até o prazo acabar (até 180 s para o jogo, 20 min com atualização).
- Sem janela da Riot, a sobreposição não se move nem minimiza. Se o usuário mexer em outros programas, ela pode ficar atrás deles até a Riot voltar.
- A barra de atualização da Riot fica coberta enquanto o jogo atualiza. A porcentagem da atualização (`/patch-proxy`, como no LeagueAccounts) entra depois, como detalhe da etapa 4.
- Precisa de conferência na Riot real: a sobreposição sem dono durante a sessão salva, o furo fechado sobre a tela inicial e o fim na janela do jogo.

## Relacionado

- [[overlayCover]] · [[riotOverlay]] · [[riotWindowObserver]] · [[signInFlow]] · [[signInService]] · [[cards]]
- [[Fluxo de login]] · [[Integração com o Riot Client]] · [[Segurança e privacidade]]

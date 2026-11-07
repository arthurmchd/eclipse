---
tipo: decisão
status: aceita
data: 2026-11-06
tags: [adr, interface, janelas]
---

# ADR-024 Coluna de login coberta durante o login

Revisa [[ADR-013 Caixa para ocultar as contas na coluna de login]] e complementa [[ADR-010 Login visível com progresso]].

Revisada em 2026-11-06 por [[ADR-025 Caixa some junto com o formulário da Riot]]: quando a cobertura sai, a caixa "Ocultar contas" só volta se a caixa "Stay signed in" da Riot estiver na tela. No login manual, ela também some quando o formulário da Riot some.

## Contexto

Pedido do usuário em 2026-11-06:

> agora faça com que enquanto o login esta sendo o realizado tudo na area do login (area da esquerda) some e fica apenas um icone carregado, porem a caixa de esconder as contas ainda fica la sozinha

A primeira versão manteve a caixa "Ocultar contas" à vista sobre a cobertura. Testando, o usuário mostrou a caixa ainda na coluna:

> o botao continuou ali... continua aparecendo

Durante o login, a caixa também precisa sumir.

No primeiro login de cada conta, o Eclipse preenche o formulário nativo da Riot ([[login.ps1]]), e o usuário via usuário e senha sendo digitados na coluna da esquerda. Até aqui, a sobreposição nunca pintava nessa coluna, fora a caixa "Ocultar contas" ([[ADR-013 Caixa para ocultar as contas na coluna de login]]).

Dois cuidados limitam a cobertura:

- **2FA e CAPTCHA precisam aparecer.** O Eclipse não contorna verificações da Riot ([[ADR-003 Sem contornar CAPTCHA ou 2FA]]); o usuário as resolve no formulário nativo.
- **O aviso de modal da Riot lê a tela.** O [[riotWindowObserver]] copia da tela um quadrado de 7 × 7 px no ponto `PANEL` (2,6% da largura, metade da altura), na coluna de login, para saber se um modal escureceu a Riot ([[ADR-017 Cartões cedem a vez aos avisos da Riot]]). Uma cobertura opaca nesse ponto esconderia o escurecimento.

## Decisão

- **Enquanto o login roda, a coluna fica coberta.** Uma terceira visualização na janela da sobreposição, o [[overlayCover]], ocupa a coluna de login inteira (de 0 até `cardsLeft`, de cima a baixo). Ela tem o fundo do painel da Riot (`#fcfcfc`) e só um carregamento, no centro da coluna.
- **Quando cobre.** Com a operação `running` e sem `needsAttention`. 2FA, CAPTCHA, aviso de demora ou qualquer outro pedido de atenção tira a cobertura na hora, e a coluna nativa volta a aparecer. Falha, cancelamento e sucesso também tiram. Depois que a conta entra (`signedIn`), a sobreposição inteira já some, como antes.
- **Um furo no ponto `PANEL`.** A região da cobertura deixa de fora um quadrado de 11 × 11 DIP centrado no ponto que o [[riotWindowObserver]] lê. Ali aparece o próprio painel da Riot, da mesma cor da cobertura. Com um modal da Riot, o escurecimento continua sendo lido e a sobreposição some, como antes.
- **Cantos da esquerda arredondados.** As primeiras e as últimas linhas da cobertura seguem o arredondado da janela da Riot, como os cartões fazem à direita ([[ADR-016 Riot sem animação de minimizar e cartões com os cantos dela]]).
- **A caixa "Ocultar contas" some junto.** Enquanto a coluna está coberta, a visualização da caixa fica escondida e volta quando a cobertura sai. Se as contas estavam ocultas pela caixa, os cartões continuam ocultos durante o login, e a caixa volta marcada.

## Alternativas consideradas

- **Esconder a janela da Riot durante o login.** O [[login.ps1]] precisa da janela renderizando, e 2FA ou CAPTCHA precisam dela à vista. A cobertura não mexe na Riot.
- **Desenhar a cobertura na página dos cartões.** A visualização dos cartões começa em `cardsLeft`. Esticá-la para a coluna misturaria a geometria da Riot com a interface dos cartões.
- **Esticar a página da caixa.** A caixa usa unidades da própria largura para casar com a da Riot. Mudar o tamanho dela durante o login mudaria essas medidas.
- **Ler o escurecimento por `PrintWindow`, sem furo.** Mudaria o helper do observador, que hoje lê a tela a cada 180 ms, só para atender este caso.

## Consequências

- O usuário não vê mais usuário e senha sendo digitados nem os controles da Riot na coluna durante o login. Erros da Riot (senha errada, por exemplo) aparecem quando a operação termina e a cobertura sai.
- Durante o login, cliques na coluna não chegam à Riot, exceto no furo de 11 × 11 DIP. Também não dá para marcar ou desmarcar "Ocultar contas" até o login terminar. A digitação do [[login.ps1]] não é afetada, porque vai por mensagens direto à janela da Riot e lê a imagem da própria janela.
- O furo mostra o painel da Riot. Se a Riot mudar a cor do painel ou pôr algo nesse ponto, o furo pode aparecer como um quadradinho de outra cor durante o login.
- A cobertura depende de `needsAttention` chegar a tempo. Nos 12 s de tolerância da checagem automática da Riot ([[signInFlow]]), um CAPTCHA visível na coluna ficaria coberto até o aviso; depois ele aparece.

## Relacionado

- [[overlayCover]]
- [[riotOverlay]]
- [[overlayToggle]]
- [[riotWindowObserver]]

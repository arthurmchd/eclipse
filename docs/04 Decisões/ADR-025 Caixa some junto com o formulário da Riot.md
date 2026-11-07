---
tipo: decisão
status: aceita
data: 2026-11-06
tags: [adr, interface, janelas, privacidade]
---

# ADR-025 Caixa some junto com o formulário da Riot

Revisa [[ADR-024 Coluna de login coberta durante o login]] e [[ADR-013 Caixa para ocultar as contas na coluna de login]]. Amplia a leitura de tela de [[ADR-017 Cartões cedem a vez aos avisos da Riot]].

## Contexto

Pedido do usuário em 2026-11-06, depois de testar a [[ADR-024 Coluna de login coberta durante o login]]:

> ainda continua ali a caixa, de um jeito dela sumir apos eu clicar para entrar na conta seja manualmente ou pelo play do eclipse

O teste foi um login manual, com 2FA, no formulário da própria Riot: pelo log da Riot, não houve Jogar depois que o Eclipse reiniciou. A ADR-024 só esconde a caixa "Ocultar contas" durante uma operação do Eclipse.

No Riot Client v142 (lido na instalação, sem alterar nada), o clique em entrar troca o formulário inteiro (campos, botões sociais, "Stay signed in" e o botão) por um anel de carregamento no centro da coluna. Isso vale para os três caminhos de envio da tela de login, e com hCaptcha o carregamento entra antes do desafio. A caixa do Eclipse fica sozinha ao lado de um formulário que não existe mais.

O serviço local não ajuda a tempo: a autenticação continua `auth` desde o clique, durante o hCaptcha, até a Riot pedir 2FA ou entrar.

## Decisão

- **O observador olha a caixa "Stay signed in" da Riot.** A cada leitura (180 ms), depois do ponto `PANEL`, o [[riotWindowObserver]] copia da tela um quadrado de 7 × 7 px no centro dessa caixa (4,17% da largura, 50,23% da altura, o ponto que o [[login.ps1]] clica) e lê 9 pontos dele. Com pelo menos 3 pontos no cinza da caixa desmarcada ou no vermelho da marcada, e nenhum escuro, a caixa está lá. Com os 9 claros como o painel, ela sumiu. Qualquer outra mistura não muda nada.
- **Só depois de ver a caixa.** O helper só manda `formHidden: true` depois de ter visto a caixa da Riot naquela janela e de perdê-la. Se nunca a viu (outra versão, outro layout, leitura falhando), nada muda em relação a antes. Trocar de janela zera o estado. Com a Riot escurecida por um modal, a caixa não é lida.
- **A caixa do Eclipse acompanha a da Riot.** O [[riotOverlay]] mostra "Ocultar contas" só com a coluna descoberta e sem `formHidden`. Escondida, ela também sai da região de cliques. Se as contas estavam ocultas e a caixa some, não sobra nada para mostrar, e a janela da sobreposição fica escondida.
- **Pelo Jogar, a cobertura continua.** O Jogar já esconde a caixa ao cobrir a coluna. Sob a cobertura, o helper lê o painel do Eclipse no ponto da caixa e conclui que o formulário sumiu; quando a cobertura sai, "Ocultar contas" só volta quando a caixa da Riot reaparece.
- **Sai só um booleano.** Como no ponto `PANEL`, nenhuma cor sai do helper.

## Alternativas consideradas

- **Esperar o serviço local.** A autenticação só muda depois do hCaptcha e do envio. A caixa ficaria sozinha nesse tempo.
- **Ler a tela de login por UI Automation.** Ligaria a acessibilidade do Chromium dentro da Riot e leria a árvore da página, com textos e campos. Um quadrado sem texto lê menos.
- **Ouvir o clique do usuário.** Exigiria ganchos globais de mouse e teclado, e não pega o Enter de forma confiável.

## Consequências

- No login manual, a caixa some junto com o formulário da Riot, em até 180 ms, e volta com ele (senha errada, desafio cancelado).
- Pelo CSS da Riot, uma mensagem de erro desce o formulário 32 px. A caixa da Riot sai do ponto lido, e a do Eclipse continua escondida até o erro sumir (a Riot o apaga quando o campo de senha recebe o foco). Antes, a caixa do Eclipse ficava fora da linha "Stay signed in" nesse caso.
- O helper passa a ler dois quadrados de 7 × 7 px da coluna de login. Nenhum tem texto, campo ou credencial.
- Se a Riot mudar a cor ou a posição da caixa, o Eclipse deixa de reconhecê-la, e a caixa dele volta ao comportamento anterior.
- Os cartões não mudam: no login manual continuam à direita até a Riot entrar.

## Relacionado

- [[riotWindowObserver]]
- [[riotOverlay]]
- [[overlayToggle]]
- [[Segurança e privacidade]]

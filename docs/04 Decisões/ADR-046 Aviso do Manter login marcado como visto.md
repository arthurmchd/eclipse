---
tipo: decisão
status: aceita
data: 2026-11-23
tags: [adr, login, riot]
---

# ADR-046 Aviso do Manter login marcado como visto

## Contexto

Relato do usuário em 2026-11-23: na primeira vez que alguém usa o Eclipse, o Jogar fica carregando muito tempo, e depois aparece o aviso para conferir a tela da Riot. Na tela, a Riot mostra um aviso explicando como funciona o "Manter login".

Conferido na interface da Riot 143 (`RiotClientElectron/resources/app.asar`, só leitura):

- A caixa "Stay signed in" da tela de login, ao passar de desligada para ligada, abre o `StaySignedInModal` se `/data-store/v1/install-settings/stay-signed-in-modal-shown` não for `true`. Ao abrir, a própria Riot grava `true` nesse endereço, então o aviso aparece uma vez por instalação da Riot.
- O aviso é um modal com fundo escuro sobre a janela inteira e `shouldCloseOnOverlayClick: false`. Só o botão OK o fecha.

Numa instalação nova, a caixa começa desligada. Com "Manter login" ligado no Eclipse, o [[loginForm]] lê a caixa como `Off`, clica nela, a Riot abre o aviso e, 300 ms depois, o clique em entrar cai no fundo do aviso e não faz nada. A senha nunca é enviada. O [[signInFlow]] espera a autorização, e depois da tolerância de 12 s mostra "A Riot ainda não terminou o login", tira a cobertura e espera até 180 s. Os cartões também somem, porque o fundo escuro é o mesmo da [[ADR-017 Cartões cedem a vez aos avisos da Riot]].

## Decisão

Antes de abrir o formulário de login com "Manter login" ligado, o [[riotClient]] lê `stay-signed-in-modal-shown` pelo serviço local. Se não for `true`, grava `true`, exatamente o que a interface da Riot grava ao mostrar o aviso. Com isso, o clique na caixa não abre o aviso, e o envio acontece como nas outras vezes.

Falha na leitura ou na gravação não interrompe o login: o `sign-in.log` registra "could not mark the Riot stay signed in notice as seen" e o preenchimento segue como antes.

## Alternativas consideradas

- **Fechar o aviso depois que ele aparece:** exigiria achar o botão OK por posição ou por UI Automation (o texto muda com o idioma) e clicar nele. Mais frágil, e mais tempo em cada primeiro login.
- **Mandar Esc para a janela:** depende do foco dentro do modal e de a Riot fechar com Esc; não foi possível conferir sem a Riot real.
- **Não clicar na caixa:** o login funcionaria, mas sem o "Manter login" da Riot a conta não ganha sessão guardada ([[ADR-019 Sessão salva por conta no modo cartões]]).
- **Deixar como está:** todo usuário novo passa pela demora e pelo aviso de verificação no primeiro login, a primeira impressão do Eclipse.

## Consequências

- O primeiro login numa instalação nova da Riot segue direto, sem o aviso.
- O Eclipse passa a gravar uma configuração da Riot pelo serviço local, além do `RiotGamesPrivateSettings.yaml`. É uma marca de aviso já visto, sem dado de conta, e a própria Riot a grava ao mostrar o aviso. Ver [[Segurança e privacidade]].
- O usuário não lê o texto da Riot sobre o "Manter login". A escolha já foi feita na opção do Eclipse, e o texto só explica que a conta fica conectada no PC.
- Uma requisição a mais (às vezes duas) por login com senha e "Manter login" ligado.
- Se a Riot mudar o endereço ou a regra do aviso, ele volta a aparecer no primeiro login, e o log mostra a falha da gravação. Conferir ao seguir [[Atualização do Riot Client]].
- Não foi conferido com a Riot real numa instalação nova: a regra foi lida do código da interface 143.

## Relacionado

- [[riotClient]]
- [[loginForm]]
- [[signInFlow]]
- [[Fluxo de login]]

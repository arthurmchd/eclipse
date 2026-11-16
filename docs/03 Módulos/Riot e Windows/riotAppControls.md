---
tipo: módulo
arquivo: src-tauri/src/riot/riot_app_controls.rs
camada: riot
testes: src-tauri/tests/riot/riot_app_controls.rs
tags: [módulo]
---

# riotAppControls

> Fecha o Riot Client do mesmo jeito que o botão de fechar da própria Riot, para a cópia desse botão nos [[cards]].

## Responsabilidade

Repete a decisão do botão de fechar da Riot: mandar o cliente para o segundo plano ou sair de vez. Lê as mesmas configurações que a interface da Riot lê e faz o pedido correspondente ao serviço local, pelo [[riotTransport]]. Não fecha a janela; quando a Riot sairia de vez, o [[riotOverlay]] pede ao [[riotWindowObserver]] que feche a janela, como o `QuitUX` da Riot. Não minimiza e não mostra o aviso do app do Xbox. Decisão: [[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]].

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `RiotAppControls::new(api)` | construtor | Recebe a API local (trait `LocalApi` do [[riotTransport]]) |
| `close()` | método | Faz as seis leituras e envia um único POST. Devolve `CloseMode::Background` ou `Quit`. Falha se o serviço não responder ou recusar o POST |
| `close_mode(configurações)` | função | A decisão pura, sem rede, sobre um `CloseSettings` |
| `CLOSE_READS` | constante | Os seis caminhos lidos (`FLAG`, `PLAYER_CHOICE`, `COMMAND_LINE`, `FROM_XBOX`, `XBOX_RUNNING`, `XBOX_NOTICE_DISMISSED`) |
| `SWITCH_TO_BACKGROUND`, `QUIT` | constantes | `/riot-client-lifecycle/v1/quit/switch-background-mode` e `/riot-client-lifecycle/v1/quit` |

## Dependências

- Usa: só a API local recebida.
- Usado por: [[riotClient]] (`close_client`), que o [[main]] passa ao [[riotOverlay]].

## Invariantes e decisões

- **Mesma regra da Riot.** Tirada da interface da Riot (`AppControls` e `UxService.quit`, lidos só para consulta na cópia privada em 2026-11-04):
  1. Se o app do Xbox está aberto, o aviso dele não foi dispensado e o jogador não ligou "rodar em segundo plano", vai para o segundo plano. É o que o único botão do aviso da Riot faz.
  2. Se a flag `lifecycle.backgroundRunning` está desligada e o lançamento não veio do Xbox, sai.
  3. Se a opção do jogador `enable_run_in_background_set_by_player` está ligada (ou não é booleana, o padrão da Riot) ou a linha de comando tem `--launch-background-mode`, vai para o segundo plano.
  4. Se o lançamento veio do Xbox, vai para o segundo plano.
  5. Senão, sai.
- **Leitura que falha não decide.** Cada leitura com resposta fora de 2xx (por exemplo 404 de uma opção nunca salva) vale como ausente. Se o serviço local não responde, `close` falha antes de qualquer POST.
- **Um POST só.** Nada é repetido. Uma resposta fora de 2xx vira o erro fixo `The Riot Client did not accept the close request`. O [[riotOverlay]] trata qualquer falha fechando só a janela, como Alt+F4.
- **Não é o encerramento do Eclipse.** Parar um cliente travado durante o login continua com `/process-control/v1/process/quit` em [[riotClient]], que encerra mesmo com o segundo plano ligado. Este módulo só serve ao clique do usuário no X.
- **Leituras em sequência.** As seis leituras são feitas uma depois da outra; o Electron as fazia juntas. São pedidos locais e rápidos, e o fechamento só acontece num clique.

## Testes

`src-tauri/tests/riot/riot_app_controls.rs` confere a tabela de decisão (flag, opção do jogador e valores não booleanos, linha de comando, Xbox e aviso dispensado). Com transporte falso, confere que as seis leituras acontecem, que vai um POST para o segundo plano ou para sair, e que uma recusa ou um serviço inalcançável gera erro sem segundo POST. Não fala com a Riot real.

## Pontos de atenção

- Os caminhos e a regra vêm da versão da interface da Riot lida em 2026-11-04. Se uma atualização mudar o `UxService.quit`, a cópia pode divergir; confira ao seguir [[Atualização do Riot Client]].
- O fechamento completo não foi conferido com a Riot real aberta. Em 2026-11-14, só a leitura do sinalizador de segundo plano foi feita na Riot real ([[riotTransport]]).

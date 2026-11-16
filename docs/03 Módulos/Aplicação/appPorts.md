---
tipo: módulo
arquivo: src-tauri/src/application/app_ports.rs
camada: aplicação
testes: src-tauri/tests/application/app_ports.rs
tags: [módulo, tauri]
---

# appPorts

> As peças do [[main]] em Rust que dá para testar: as portas reais do [[managerService]] e o "guardar a sessão que a Riot deixou".

## Responsabilidade

- Implementar o `ManagerPorts` do [[managerService]] com o [[signInService]], o [[refresher]] e funções para jogos abertos, links e troca de idioma.
- Portar o `saveLeavingSession` do `main/index.js`.
- **Não** cria nada: o [[main]] monta as peças e as entrega prontas.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `AppPorts` | struct | As portas reais; `version` vem do Tauri |
| `running_games_json` | função | `{ lol, val, client, clientWindow }`, como no JS |
| `save_leaving_session(closed, Leaving)` | função | Guarda a sessão de quem saiu, se for de uma conta confirmada |
| `OPEN_FAILED`, `KEPT_OWNER`, `UNCONFIRMED`, `KEPT_PREVIOUS` | constantes | Textos fixos do erro de link e das linhas do `sign-in.log` |

## Dependências

- Usa: [[managerService]], [[signInService]], [[refresher]], [[rankApi]], [[store]], [[riotClient]].
- Usado por: [[main]].

## Invariantes e decisões

- **Um login recusado volta como conflito (409)**, com a mensagem do [[signInService]], que já não leva dados da conta.
- **Erro ao abrir um link é genérico.** O texto do sistema, que pode ter caminhos do usuário, não chega aos cartões.
- **A sessão que a Riot deixou vai para quem é dona dela, e só.** Primeiro o [[sessionKeeper]] tenta achar a dona; senão, ela vai para a conta atual, e só se o Riot ID da sessão for o da conta. Sem login lembrado, sem conta atual ou com Riot ID diferente, nada é gravado. As linhas do log são as mesmas do Electron.

## Testes

`src-tauri/tests/application/app_ports.rs` confere o contexto dos cartões, os jogos abertos, os links, a troca de idioma, a fila de atualização, o login recusado e os sete caminhos do `save_leaving_session`.

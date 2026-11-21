---
tipo: módulo
arquivo: src-tauri/src/riot/riot_version.rs
camada: riot
testes: src-tauri/tests/riot/riot_version.rs
tags: [módulo]
---

# riotVersion

> Diz qual versão do Riot Client está instalada e se ela é mais nova que a última conferida com o Eclipse, para o `sign-in.log` e para o aviso de falha do formulário.

## Responsabilidade

- Escreve a versão no `sign-in.log` a cada preenchimento do formulário.
- Troca a falha genérica do formulário por um aviso claro quando a Riot é mais nova que a última versão conferida.
- Não bloqueia nada: uma Riot mais nova continua sendo usada normalmente; só a mensagem de falha muda.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `RiotVersion([u32; 4])` | struct | A versão do arquivo; `major()`, `newer_than_tested()`, `text()` |
| `LAST_TESTED_MAJOR` | constante | `143`, a versão principal mais nova conferida na Riot real |
| `version_line(versão)` | função | A linha do log: `Riot Client 143.0.14.5311`, com `(newer than the last tested, 143)` quando é mais nova, ou `Riot Client version unknown` |
| `layout_failure(falha)` | função | `true` para as falhas que um desenho novo da tela explicaria: `form-not-ready`, `input-failed`, `window-script-failed` |
| `newer_riot_message(versão, falha)` | função | O aviso `NEWER_RIOT` com a versão principal, só para uma falha de desenho numa Riot mais nova |

## Dependências

- Usa: `FillFailure` do [[loginForm]].
- Usado por: [[riotClient]], que lê a versão do `RiotClientServices.exe` com `file_version` do [[win32]] e a passa ao `fill_login_form`. O texto do aviso é traduzido pelo [[language]].

## Invariantes e decisões

- **Pedido do usuário (2026-11-21): avisar quando a Riot atualizar.** O preenchimento depende do desenho da tela de login ([[loginForm]], [[Atualização do Riot Client]]). Quando a Riot muda o desenho, o usuário via só "A tela de login do Riot Client não carregou", sem saber que a causa era a atualização. Agora vê: "O Eclipse ainda não reconhece este Riot Client mais novo. Termine o login por lá e procure uma atualização do Eclipse. Riot Client 144".
- **Versão do arquivo, não da API.** Vem do recurso de versão do `RiotClientServices.exe` (`GetFileVersionInfoW`), que existe mesmo com a Riot fechada ou em segundo plano. Em 2026-11-21: 143.0.14.5311. O `Riot Client.exe` da interface também diz 143.
- **Só a versão principal decide.** As versões 141, 142 e 143 foram conferidas na Riot real (posições na v141, cores da caixa na v142, UI Automation na v143). Versões menores dentro da 143 mudam com frequência e não mudaram o desenho até hoje.
- **Só falhas de desenho.** "A janela não abriu", credenciais inválidas e cancelamento não têm a ver com o desenho e mantêm a mensagem de sempre. Numa Riot conferida, a mensagem também não muda.
- **Log só com números.** A linha leva só os quatro números da versão, que não identificam ninguém.
- **Atualizar a constante.** Depois de conferir uma Riot nova (guia [[Atualização do Riot Client]]), `LAST_TESTED_MAJOR` sobe junto com o teste dela.

## Testes

`src-tauri/tests/riot/riot_version.rs`: a linha do log nos três casos e o aviso só para as três falhas de desenho numa Riot mais nova. `tests/riot/riot_client.rs` confere que o `fill_login_form` escreve a linha antes de preencher e devolve o aviso; `tests/application/language.rs`, a tradução nos dois sentidos; `tests/platform/windows/win32.rs`, a leitura da versão de um arquivo do Windows e a ausência dela num arquivo sem versão.

## Pontos de atenção

- Uma Riot que muda o desenho sem mudar a versão principal não dispara o aviso; a falha continua com a mensagem de sempre.

---
tipo: módulo
arquivo: src/riot/riotProcess.js
camada: riot
testes: test/riot/riotProcess.test.js
tags: [módulo]
---

# riotProcess

> Inicia o `RiotClientServices.exe` desacoplado do app, em modo `--headless` por padrão.

## Responsabilidade

- Uma função: `launchClient`. Inicia o processo do Riot Client e resolve assim que o Windows confirma o `spawn`.
- Não espera o serviço ficar pronto. Quem espera é o [[signInFlow]] ou o [[riotClient]].
- Não pede jogo nem produto.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `launchClient(exe, options)` | função async | Inicia o cliente. Opções: `visible = false`, `spawn` (injetável). |

Modos:

| Chamada | Argumentos | `windowsHide` | Quem usa |
|---|---|---|---|
| padrão | `--headless` | `true` | Reinício no [[signInFlow]] |
| `visible: true` | nenhum | `false` | [[riotInterface]] (formulário nativo e `openClient`), `startClient` e o início visível do [[signInFlow]] |

Opções do `spawn`: `detached: true`, `stdio: 'ignore'`, `env: environmentForRiot()`. No evento `spawn`, chama `child.unref()` e resolve.

## Dependências

- Usa: [[windowsEnvironment]] (`environmentForRiot`).
- Usado por: [[riotClient]] (`launchProduct`) e [[riotInterface]] (interface para o formulário nativo).

## Invariantes e decisões

- **`--headless` é uma opção do `RiotClientServices`.** `windowsHide` sozinho não impede que o processo filho dele mostre a interface do cliente.
- **Produto só depois da verificação.** A escolha do jogo fica de propósito para depois de verificar a conta. Nenhum argumento de produto é passado aqui.
- **Processo independente.** `detached` + `unref`: o Riot continua rodando se o app fechar, e o app não espera o processo terminar.
- **Perfil do Windows certo.** O ambiente passa por `environmentForRiot`, que corrige o `LOCALAPPDATA` de um AppContainer temporário.
- **Interface só visível.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]) saiu `interfaceRequired`, que criava a interface com `windowsHide` para o monitor de janelas escondê-la. A interface só é pedida com `visible: true`; um `interfaceRequired` avulso é ignorado.
- **Erro sem detalhes do sistema.** Qualquer falha de `spawn` vira "Could not start the Riot Client. Check its path and Windows permissions".
- **Versão Rust (fase 2 da [[Migração para Tauri]]).** `src-tauri/src/riot/riot_process.rs`, testes em `src-tauri/tests/riot/riot_process.rs`. `plan` monta o início sem executar nada (argumentos, `DETACHED_PROCESS`, `CREATE_NEW_PROCESS_GROUP` e, escondido, `CREATE_NO_WINDOW`), e o processo recebe o ambiente do [[windowsEnvironment]] inteiro.

## Testes

`test/riot/riotProcess.test.js`:
- Modo padrão usa `--headless`, `windowsHide` e `stdio: 'ignore'`; só libera o processo após `spawn`.
- `visible: true` abre a interface oficial.
- `interfaceRequired` sozinho não cria interface: continua `--headless` e escondido.
- Falha de `spawn` não expõe a mensagem original.

## Pontos de atenção

- **Depende do `--headless`.** Se a opção deixar de existir ou mudar de efeito, o reinício pode mostrar a interface: [[Atualização do Riot Client]].
- **Só funciona com os serviços parados.** Se `RiotClientServices.exe` já roda em `--headless`, uma nova chamada com `visible` não cria interface. O [[riotInterface]] trata esse caso.
- **Resolve cedo.** `spawn` só confirma que o processo começou. Um cliente que fecha logo depois não é detectado aqui.

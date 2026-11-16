---
tipo: módulo
arquivo: src-tauri/src/riot/riot_process.rs
camada: riot
testes: src-tauri/tests/riot/riot_process.rs
tags: [módulo]
---

# riotProcess

> Inicia o `RiotClientServices.exe` desacoplado do app, em modo `--headless` por padrão.

## Responsabilidade

- Uma função: `launch_client`. Inicia o processo do Riot Client e volta assim que o Windows confirma o início.
- Não espera o serviço ficar pronto. Quem espera é o [[signInFlow]] ou o [[riotClient]].
- Não pede jogo nem produto.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `launch_client(exe, visível)` | função | Inicia o cliente desacoplado do Eclipse |
| `launch_with(exe, visível, início)` | função | O mesmo, com o início trocável para os testes |
| `plan(exe, visível, ambiente)` | função | Monta o `LaunchPlan` (argumentos, flags e ambiente) sem executar nada |
| `spawn_detached(plano)` | função | Executa um plano |

Modos:

| Chamada | Argumentos | Flags | Quem usa |
|---|---|---|---|
| escondido | `--headless` | `DETACHED_PROCESS`, `CREATE_NEW_PROCESS_GROUP`, `CREATE_NO_WINDOW` | Reinício no [[signInFlow]] |
| visível | nenhum | `DETACHED_PROCESS`, `CREATE_NEW_PROCESS_GROUP` | [[riotInterface]] (formulário nativo e abertura do cliente), `start_client` e o início visível do [[signInFlow]] |

O processo recebe o ambiente inteiro do [[windowsEnvironment]], sem entrada nem saída padrão.

## Dependências

- Usa: [[windowsEnvironment]] (`environment_for_riot`).
- Usado por: [[riotClient]] e [[riotInterface]] (interface para o formulário nativo).

## Invariantes e decisões

- **`--headless` é uma opção do `RiotClientServices`.** Esconder a janela do processo sozinho não impede que o processo filho dele mostre a interface do cliente.
- **Produto só depois da verificação.** A escolha do jogo fica de propósito para depois de verificar a conta. Nenhum argumento de produto é passado aqui.
- **Processo independente.** `detached` + `unref`: o Riot continua rodando se o app fechar, e o app não espera o processo terminar.
- **Perfil do Windows certo.** O ambiente passa por `environment_for_riot`, que corrige o `LOCALAPPDATA` de um AppContainer temporário.
- **Interface só visível.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]) saiu a opção que criava a interface escondida para o monitor de janelas. A interface só é pedida no modo visível.
- **Erro sem detalhes do sistema.** Qualquer falha de `spawn` vira "Could not start the Riot Client. Check its path and Windows permissions".

## Testes

`src-tauri/tests/riot/riot_process.rs`:
- O modo escondido usa `--headless` e não cria janela.
- O modo visível abre a interface oficial, nunca escondida.
- O processo recebe o `LOCALAPPDATA` que a Riot espera.
- Uma falha ao iniciar não expõe detalhes do comando do sistema.

## Pontos de atenção

- **Depende do `--headless`.** Se a opção deixar de existir ou mudar de efeito, o reinício pode mostrar a interface: [[Atualização do Riot Client]].
- **Só funciona com os serviços parados.** Se `RiotClientServices.exe` já roda em `--headless`, uma nova chamada visível não cria interface. O [[riotInterface]] trata esse caso.
- **Volta cedo.** O início só confirma que o processo começou. Um cliente que fecha logo depois não é detectado aqui.

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
| `launchClient(exe, options)` | função async | Inicia o cliente. Opções: `visible = false`, `interfaceRequired = visible`, `spawn` (injetável). |

Modos:

| Chamada | Argumentos | `windowsHide` | Quem usa |
|---|---|---|---|
| padrão | `--headless` | `true` | Reinício no [[signInFlow]], `ensureBackgroundClient` |
| `visible: true` | nenhum | `false` | `openClient` (Show Riot Client) |
| `interfaceRequired: true` | nenhum | `true`, salvo `visible` | `typeCredentials` (formulário nativo) |

Opções do `spawn`: `detached: true`, `stdio: 'ignore'`, `env: environmentForRiot()`. No evento `spawn`, chama `child.unref()` e resolve.

## Dependências

- Usa: [[windowsEnvironment]] (`environmentForRiot`).
- Usado por: [[riotClient]] (`launchProduct`) e [[riotInterface]] (interface para o formulário nativo).

## Invariantes e decisões

- **`--headless` é uma opção do `RiotClientServices`.** `windowsHide` sozinho não impede que o processo filho dele mostre a interface do cliente.
- **Produto só depois da verificação.** A escolha do jogo fica de propósito para depois de verificar a conta. Nenhum argumento de produto é passado aqui.
- **Processo independente.** `detached` + `unref`: o Riot continua rodando se o app fechar, e o app não espera o processo terminar.
- **Perfil do Windows certo.** O ambiente passa por `environmentForRiot`, que corrige o `LOCALAPPDATA` de um AppContainer temporário.
- **Erro sem detalhes do sistema.** Qualquer falha de `spawn` vira "Could not start the Riot Client. Check its path and Windows permissions".

## Testes

`test/riot/riotProcess.test.js`:
- Modo padrão usa `--headless`, `windowsHide` e `stdio: 'ignore'`; só libera o processo após `spawn`.
- `visible: true` abre a interface oficial.
- `interfaceRequired: true` pede a interface mas mantém `windowsHide`.
- Falha de `spawn` não expõe a mensagem original.

## Pontos de atenção

- **Depende do `--headless`.** Se a opção deixar de existir ou mudar de efeito, o reinício pode mostrar a interface: [[Atualização do Riot Client]].
- **Interface sem janela visível.** Com `interfaceRequired` e sem `visible`, a interface é criada. Quem a esconde é o [[windowGuard.ps1]].
- **Só funciona com os serviços parados.** Se `RiotClientServices.exe` já roda em `--headless`, uma nova chamada com `interfaceRequired` não cria interface. O [[riotInterface]] trata esse caso.
- **Resolve cedo.** `spawn` só confirma que o processo começou. Um cliente que fecha logo depois não é detectado aqui.
